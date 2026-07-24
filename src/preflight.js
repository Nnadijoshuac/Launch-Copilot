// x402 pre-flight checker — runs the same probes an OKX reviewer runs, then
// reports which rejection reasons the endpoint will hit and how to fix each.
//
// Pure HTTP + rules. No LLM call, no dependencies, and it NEVER signs or
// handles a real payment or key — mock headers only.
//
// Every check returns { id, title, severity, status, evidence, fix }.
//   status: "pass" | "fail" | "warn" | "unknown"   ("unknown" = could not probe;
//   never reported as green.)

import {
  ASSET_LIST_VERIFIED,
  BLOCKED_HOST_PATTERNS,
  UNVERIFIED_HOST_PATTERNS,
  UNREACHABLE_HOST_PATTERNS,
  EXPECTED_NETWORKS,
  NETWORK_ALIASES,
  ACCEPTED_ASSETS,
  KNOWN_WRONG_ASSETS,
  USDG_SYMBOLS,
  EXPECTED_X402_VERSION,
  PROBE_TIMEOUT_MS,
  REVIEWER_MAX_SECONDS,
  SLOW_RESPONSE_WARN_MS,
  USDT_DECIMALS,
} from "./preflight-config.js";

const MOCK_PAYMENT = "preflight-mock-not-a-real-payment";

function check(id, title, severity, status, evidence, fix) {
  return { id, title, severity, status, evidence, fix };
}

async function probe(url, { method = "POST", headers = {}, body, timeout = PROBE_TIMEOUT_MS } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: method === "GET" || method === "HEAD" ? undefined : body,
      signal: AbortSignal.timeout(timeout),
    });
    const text = await res.text();
    const hdrs = {};
    res.headers.forEach((v, k) => (hdrs[k.toLowerCase()] = v));
    return { ok: true, status: res.status, headers: hdrs, text, ms: Date.now() - started };
  } catch (err) {
    const timedOut = String(err?.name) === "TimeoutError" || /timeout|aborted/i.test(String(err));
    return { ok: false, timedOut, error: String(err?.message ?? err).slice(0, 200), ms: Date.now() - started };
  }
}

function b64decode(s) {
  try {
    const norm = s.replace(/-/g, "+").replace(/_/g, "/");
    return atob(norm);
  } catch {
    return null;
  }
}

function tryJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Decode an x402 challenge from wherever the server put it.
 * v2 → PAYMENT-REQUIRED header (base64 JSON). v1 → body JSON with x402Version.
 * Also tolerates www-authenticate and a base64 body.
 */
export function decodeChallenge(res) {
  if (!res?.ok) return null;
  const h = res.headers ?? {};

  for (const name of ["payment-required", "x-payment-required", "www-authenticate"]) {
    const raw = h[name];
    if (!raw) continue;
    const inner = name === "www-authenticate" ? (raw.match(/request="([^"]+)"/)?.[1] ?? null) : raw;
    if (!inner) continue;
    const decoded = b64decode(inner);
    const parsed = tryJson(decoded ?? "") ?? tryJson(inner);
    if (parsed) return { source: `${name} header`, challenge: parsed, transport: name === "www-authenticate" ? "www-authenticate" : "header" };
  }

  const bodyJson = tryJson(res.text ?? "");
  if (bodyJson) {
    // Direct, or wrapped inside a JSON-RPC error/result payload.
    const candidates = [bodyJson, bodyJson.error?.data, bodyJson.result, bodyJson.data];
    for (const c of candidates) {
      if (c && typeof c === "object" && (c.accepts || c.x402Version !== undefined)) {
        return { source: "response body", challenge: c, transport: "body" };
      }
    }
  }
  const bodyB64 = b64decode((res.text ?? "").trim());
  const parsedB64 = bodyB64 ? tryJson(bodyB64) : null;
  if (parsedB64) return { source: "base64 response body", challenge: parsedB64, transport: "body" };

  return null;
}

function acceptsOf(challenge) {
  const a = challenge?.accepts;
  return Array.isArray(a) ? a : [];
}

// v2 uses `amount`; v1 uses `maxAmountRequired`. Accept either.
function amountOf(entry) {
  return entry?.amount ?? entry?.maxAmountRequired ?? entry?.maxAmount ?? null;
}

function normHost(u) {
  try {
    return new URL(u).hostname;
  } catch {
    return null;
  }
}

/** A JSON-RPC error envelope (or an isError tool result) is NOT a deliverable. */
function isRpcError(text) {
  const j = tryJson(text ?? "");
  if (!j || typeof j !== "object") return false;
  if (j.error && (j.jsonrpc || j.id !== undefined)) return true;
  if (j.result?.isError === true) return true;
  return false;
}

/**
 * On an MCP server, a made-up tool name just yields a JSON-RPC "unknown tool"
 * error — it never reaches the paid path. Discover a tool that actually
 * challenges for payment by listing tools and probing each one unpaid.
 * Returns { toolName, body } for the first tool that answers 402, else null.
 */
async function discoverPaidTool(endpoint, business_body) {
  const listed = await probe(endpoint, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  if (!listed.ok) return null;
  const tools = tryJson(listed.text ?? "")?.result?.tools;
  if (!Array.isArray(tools)) return null;

  for (const t of tools.slice(0, 8)) {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: t.name, arguments: business_body ?? {} },
    });
    const r = await probe(endpoint, { method: "POST", body });
    if (r.ok && r.status === 402) return { toolName: t.name, body, probe: r };
  }
  return null;
}

/** Run every check. Returns { checks, meta }. */
export async function runPreflight(input) {
  const { endpoint, expected_fee_usdt, is_mcp = true, business_body } = input;
  const checks = [];
  const meta = { endpoint, probes: [] };

  // ---------- Check 2: host blocklist (pure string work, do it first) ----------
  const host = normHost(endpoint);
  if (!host) {
    checks.push(
      check("endpoint_url", "Endpoint URL", "blocker", "fail", `Could not parse "${endpoint}" as a URL.`,
        "Provide a full absolute URL including https:// — for example https://yourdomain.com/mcp")
    );
    return { checks, meta };
  }
  const scheme = new URL(endpoint).protocol;
  if (scheme !== "https:") {
    checks.push(
      check("https_required", "HTTPS required", "blocker", "fail",
        `Endpoint uses ${scheme.replace(":", "")}, not https.`,
        "Serve the endpoint over https. OKX will not register or call a plain-http endpoint, and it is permanent on-chain once registered.")
    );
  } else {
    checks.push(check("https_required", "HTTPS required", "blocker", "pass", "Endpoint is served over https.", null));
  }

  const unreachableHost = UNREACHABLE_HOST_PATTERNS.find((p) => p.pattern.test(host));
  const blocked = BLOCKED_HOST_PATTERNS.find((p) => p.pattern.test(host));
  const unverifiedHost = UNVERIFIED_HOST_PATTERNS.find((p) => p.pattern.test(host));

  if (unreachableHost) {
    checks.push(
      check("host_private", "Publicly reachable host", "blocker", "fail",
        `Host "${host}" is ${unreachableHost.label} — not reachable from outside your machine.`,
        "Deploy to a public https host. A reviewer runs from OKX's infrastructure and can never reach a private or loopback address.")
    );
  } else if (blocked) {
    checks.push(
      check("host_blocked", "Hosting domain", "blocker", "fail",
        `Host "${host}" matches ${blocked.label}.`,
        `OKX's buyer security plugin (SC_CDN_DEPLOY_TOOL) hard-blocks commands containing this host, so the reviewer literally cannot call your endpoint. Move to a custom domain. This is the single most avoidable rejection.`)
    );
  } else if (unverifiedHost) {
    checks.push(
      check("host_blocked", "Hosting domain", "blocker", "unknown",
        `Host "${host}" is on ${unverifiedHost.label}, which we could not confirm either way.`,
        `${unverifiedHost.note} If your listing is rejected with no other explanation, move to a custom domain and resubmit.`)
    );
  } else {
    checks.push(check("host_blocked", "Hosting domain", "blocker", "pass",
      `Host "${host}" is not on the known blocked-host list.`, null));
  }

  // ---------- Check 1: reachability + cold start ----------
  // On MCP, find a tool that actually challenges for payment — probing a
  // made-up tool name only ever returns a JSON-RPC "unknown tool" error.
  let paidTool = null;
  if (is_mcp) {
    paidTool = await discoverPaidTool(endpoint, business_body);
    if (paidTool) meta.paidToolProbed = paidTool.toolName;
  }
  const unpaidBody =
    paidTool?.body ??
    JSON.stringify(
      is_mcp
        ? { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "preflight_probe", arguments: business_body ?? {} } }
        : (business_body ?? {})
    );

  const first = await probe(endpoint, { method: "POST", body: unpaidBody });
  meta.probes.push({ label: "unpaid POST #1", status: first.status ?? "error", ms: first.ms });
  let second = null;
  if (!first.ok) {
    second = await probe(endpoint, { method: "POST", body: unpaidBody });
    meta.probes.push({ label: "unpaid POST #2 (cold-start retry)", status: second.status ?? "error", ms: second.ms });
  }
  const live = first.ok ? first : second?.ok ? second : null;

  if (!live) {
    const detail = first.timedOut ? `timed out after ${PROBE_TIMEOUT_MS / 1000}s` : first.error;
    checks.push(
      check("reachable", "Endpoint reachable", "blocker", "fail",
        `Two POST attempts both failed (${detail}).`,
        "Make the endpoint reachable and keep it running. A reviewer retries only once — if both attempts fail, the listing is rejected without any of the payment logic being examined.")
    );
    return { checks, meta }; // nothing further can be probed
  }

  if (!first.ok && second?.ok) {
    checks.push(
      check("reachable", "Endpoint reachable", "blocker", "warn",
        `First request failed (${first.timedOut ? "timeout" : first.error}); the retry succeeded in ${second.ms} ms.`,
        "Cold start detected — free-tier hosts (render/railway/fly free) sleep and drop the first request; reviewers retry only once. Keep it warm with a scheduled ping, or move to a host that does not sleep.")
    );
  } else {
    checks.push(check("reachable", "Endpoint reachable", "blocker", "pass",
      `Responded in ${live.ms} ms (HTTP ${live.status}).`, null));
  }

  if (live.ms > SLOW_RESPONSE_WARN_MS) {
    checks.push(
      check("latency", "Response time", "warning", "warn",
        `Responded in ${Math.round(live.ms / 1000)}s.`,
        `The reviewer's ceiling is ${REVIEWER_MAX_SECONDS}s per call. You are well inside it, but a slow endpoint plus a cold start can cross it. Cache or precompute the slow path.`)
    );
  }

  // ---------- Check 3: unpaid probe must return 402 ----------
  const getProbe = await probe(endpoint, { method: "GET" });
  meta.probes.push({ label: "unpaid GET", status: getProbe.status ?? "error", ms: getProbe.ms });

  const got402 = live.status === 402 || getProbe.status === 402;
  let challengeRes = live.status === 402 ? live : getProbe.status === 402 ? getProbe : null;

  if (got402) {
    checks.push(check("unpaid_402", "Unpaid request returns 402", "blocker", "pass",
      `Unpaid request returned HTTP 402 as required.`, null));
  } else {
    const seen = `POST → HTTP ${live.status}` + (getProbe.ok ? `, GET → HTTP ${getProbe.status}` : "");
    const returns200 = live.status === 200;
    checks.push(
      check("unpaid_402", "Unpaid request returns 402", "blocker", "fail",
        `${seen}. No 402 anywhere.` + (returns200 ? " The endpoint served a full response without asking for payment." : ""),
        returns200
          ? "Unpaid requests must return HTTP 402 with an accepts array BEFORE any business validation. You're returning 200 and giving the deliverable away — the reviewer records that your paid service never charges, and there is no payment flow to approve. Gate payment first, run the business logic second."
          : `Unpaid requests must return HTTP 402 with an accepts array BEFORE any business validation. You're returning ${live.status}. Gate payment first, validate the body second.`)
    );
  }

  // GET-specific advisory (MCP servers legitimately 405 GET, but reviewers probe it)
  if (is_mcp && getProbe.ok && getProbe.status !== 402 && got402) {
    checks.push(
      check("get_probe", "GET probe behaviour", "warning", "warn",
        `GET returned HTTP ${getProbe.status} while POST returned 402.`,
        "This is normal for a Streamable-HTTP MCP server, but a reviewer probing with GET sees a non-402. Returning the same 402 challenge on GET removes the ambiguity.")
    );
  }

  // ---------- Checks 4-8, 10: decode the challenge ----------
  const decoded = challengeRes ? decodeChallenge(challengeRes) : null;

  if (!got402) {
    for (const [id, title] of [
      ["accepts_present", "Payable options (accepts[])"],
      ["asset", "Settlement token"],
      ["network", "Settlement network"],
      ["price", "Price matches registration"],
      ["x402_version", "x402 protocol version"],
    ]) {
      checks.push(check(id, title, "blocker", "unknown",
        "Could not verify — the endpoint never returned a 402 challenge to inspect.",
        "Fix the 402 first, then re-run this check."));
    }
  } else if (!decoded) {
    checks.push(
      check("accepts_present", "Payable options (accepts[])", "blocker", "fail",
        `HTTP 402 returned, but no decodable x402 challenge was found in the PAYMENT-REQUIRED header, the WWW-Authenticate header, or the body.`,
        "Return the challenge either as a base64-encoded PAYMENT-REQUIRED header (x402 v2) or as a JSON body containing x402Version and accepts[] (v1). Right now a buyer's wallet has nothing to sign.")
    );
  } else {
    const ch = decoded.challenge;
    const accepts = acceptsOf(ch);

    // Check 4
    if (accepts.length === 0) {
      checks.push(
        check("accepts_present", "Payable options (accepts[])", "blocker", "fail",
          `402 challenge found in the ${decoded.source}, but accepts[] is ${ch.accepts === undefined ? "absent" : "empty"}.`,
          "Your 402 has no payable options. Populate accepts[] with {scheme, network, asset, amount/maxAmountRequired, payTo, maxTimeoutSeconds}.")
      );
    } else {
      checks.push(check("accepts_present", "Payable options (accepts[])", "blocker", "pass",
        `${accepts.length} payable option${accepts.length > 1 ? "s" : ""} advertised in the ${decoded.source}.`, null));

      // Check 5: asset
      const assets = accepts.map((a) => String(a.asset ?? "").toLowerCase()).filter(Boolean);
      const okAssets = ACCEPTED_ASSETS.map((a) => a.address.toLowerCase());
      const matched = assets.filter((a) => okAssets.includes(a));
      const symbolish = accepts.map((a) => String(a.extra?.name ?? a.symbol ?? "").toUpperCase());
      const usdg = symbolish.some((s) => USDG_SYMBOLS.includes(s));

      if (assets.length === 0) {
        checks.push(check("asset", "Settlement token", "blocker", "fail",
          "No asset address is present in any accepts entry.",
          "Each accepts entry needs an `asset` field with the ERC-20 contract address of the settlement token (USDT or USDG on X Layer)."));
      } else if (matched.length > 0 || usdg) {
        checks.push(check("asset", "Settlement token", "blocker", "pass",
          `Advertises ${matched[0] ?? "USDG"}${ASSET_LIST_VERIFIED ? "" : " (matched against the rejection taxonomy; the live facilitator requires an API key so this could not be re-confirmed against it)"}.`, null));
      } else {
        const known = KNOWN_WRONG_ASSETS.find((k) => assets.includes(k.address.toLowerCase()));
        checks.push(
          check("asset", "Settlement token", "blocker", "fail",
            `accepts advertises ${assets.join(", ")}${known ? ` — ${known.note}` : ""}.`,
            `The reviewer's task system only settles USDT/USDG on X Layer. Change asset to ${ACCEPTED_ASSETS[0].address} (USDT, 6 decimals) or a supported USDG address.`)
        );
      }

      // Check 6: network
      const nets = accepts.map((a) => String(a.network ?? "").toLowerCase()).filter(Boolean);
      const netOk = nets.some((n) => EXPECTED_NETWORKS.includes(n));
      const netAlias = nets.some((n) => NETWORK_ALIASES.includes(n));
      if (nets.length === 0) {
        checks.push(check("network", "Settlement network", "blocker", "fail",
          "No network field in accepts.",
          `Set network to "${EXPECTED_NETWORKS[0]}" (CAIP-2 for X Layer).`));
      } else if (netOk) {
        checks.push(check("network", "Settlement network", "blocker", "pass",
          `Advertises ${EXPECTED_NETWORKS[0]} (X Layer).`, null));
      } else if (netAlias) {
        checks.push(check("network", "Settlement network", "blocker", "warn",
          `Advertises "${nets.join(", ")}" instead of CAIP-2.`,
          `The chain is right but the identifier format is not. Buyer tooling matches on CAIP-2 — emit "${EXPECTED_NETWORKS[0]}" exactly.`));
      } else {
        checks.push(check("network", "Settlement network", "blocker", "fail",
          `Advertises network "${nets.join(", ")}".`,
          `Settlement must be on X Layer — set network to "${EXPECTED_NETWORKS[0]}".`));
      }

      // Check 7 + 8: price / zero-fee
      const amounts = accepts.map(amountOf).filter((v) => v !== null && v !== undefined);
      const zeroAdvertised = amounts.some((v) => String(v).trim() === "0" || Number(v) === 0);
      if (typeof expected_fee_usdt === "number") {
        const expectedMinimal = Math.round(expected_fee_usdt * 10 ** USDT_DECIMALS);
        const match = amounts.some((v) => Number(v) === expectedMinimal);
        if (amounts.length === 0) {
          checks.push(check("price", "Price matches registration", "blocker", "fail",
            "No amount/maxAmountRequired found in accepts.",
            `Set amount (x402 v2) or maxAmountRequired (v1) to ${expectedMinimal} minimal units for ${expected_fee_usdt} USDT.`));
        } else if (match) {
          checks.push(check("price", "Price matches registration", "blocker", "pass",
            `402 charges ${expectedMinimal} minimal units = ${expected_fee_usdt} USDT, matching what you registered.`, null));
        } else {
          const shown = amounts.map((v) => `${v} (${Number(v) / 10 ** USDT_DECIMALS} USDT)`).join(", ");
          checks.push(check("price", "Price matches registration", "blocker", "fail",
            `402 charges ${shown} but you registered ${expected_fee_usdt} USDT (${expectedMinimal} minimal units).`,
            "x402 has no negotiation — buyers with a budget cap will bounce. Align the 402 amount with your registered fee. Remember USDT has 6 decimals: 1 USDT = 1000000."));
        }
      } else {
        checks.push(check("price", "Price matches registration", "blocker", "unknown",
          `402 advertises ${amounts.length ? amounts.join(", ") + " minimal units" : "no amount"}; you did not tell us the registered fee.`,
          "Re-run with expected_fee_usdt set to the fee on your listing so we can confirm they match."));
      }

      if (zeroAdvertised || expected_fee_usdt === 0) {
        checks.push(
          check("zero_fee", "Zero-fee trap", "warning", "warn",
            zeroAdvertised ? "The 402 advertises an amount of 0." : "You registered a fee of 0 USDT.",
            "Zero-fee breaks the buyer's task-402-pay amount check ('expected 0 USDT ≈ ? minimal units'). Set a small non-zero fee like 0.01 USDT, or serve the deliverable via a genuine free path (200 with the result, no 402 at all) rather than a 0-amount 402.")
        );
      }

      // Check 10: version
      const ver = ch.x402Version;
      if (ver === undefined) {
        checks.push(check("x402_version", "x402 protocol version", "warning", "warn",
          "No x402Version field in the challenge.",
          `Declare x402Version: ${EXPECTED_X402_VERSION} so buyer tooling knows how to sign.`));
      } else if (Number(ver) === EXPECTED_X402_VERSION) {
        checks.push(check("x402_version", "x402 protocol version", "warning", "pass",
          `Challenge declares x402Version ${ver}.`, null));
      } else {
        checks.push(check("x402_version", "x402 protocol version", "warning", "warn",
          `Challenge declares x402Version ${ver}.`,
          `OKX's facilitator/CLI operates on x402 v${EXPECTED_X402_VERSION} (EIP-3009 exact scheme). A v${ver} challenge won't accept the v${EXPECTED_X402_VERSION} signed payment — the buyer signs, replays, and gets rejected. Align to v${EXPECTED_X402_VERSION}: emit the challenge as a base64 PAYMENT-REQUIRED header and accept the signed PAYMENT-SIGNATURE header.`));
      }

      // payTo sanity
      const payTos = accepts.map((a) => a.payTo).filter(Boolean);
      if (payTos.length === 0) {
        checks.push(check("pay_to", "Payout address", "blocker", "fail",
          "No payTo address in accepts.",
          "Set payTo to the address that should receive the USDT."));
      } else if (payTos.some((p) => /^0x0{40}$/i.test(String(p)))) {
        checks.push(check("pay_to", "Payout address", "blocker", "fail",
          `payTo is the zero address (${payTos[0]}).`,
          "Payments to 0x000…000 are burned. Set payTo to your real receiving address before you list."));
      } else {
        checks.push(check("pay_to", "Payout address", "blocker", "pass", `Pays out to ${payTos[0]}.`, null));
      }
    }
  }

  // ---------- Check 9: MCP Accept header ----------
  if (is_mcp) {
    const jsonOnly = await probe(endpoint, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list" }),
    });
    meta.probes.push({ label: "POST Accept: application/json only", status: jsonOnly.status ?? "error", ms: jsonOnly.ms });
    if (!jsonOnly.ok) {
      checks.push(check("mcp_accept", "MCP Accept header", "blocker", "unknown",
        `Could not probe (${jsonOnly.error}).`, "Re-run when the endpoint is stable."));
    } else if (jsonOnly.status === 406) {
      checks.push(
        check("mcp_accept", "MCP Accept header", "blocker", "fail",
          "POST with Accept: application/json returned HTTP 406.",
          "Your MCP server 406s unless Accept includes text/event-stream, but the x402 buyer replay sends a single JSON POST. Support Accept: application/json alone, or return the paid result as plain JSON (non-SSE).")
      );
    } else {
      checks.push(check("mcp_accept", "MCP Accept header", "blocker", "pass",
        `Accepts a plain JSON POST (HTTP ${jsonOnly.status}) without demanding text/event-stream.`, null));
    }
  }

  // ---------- Check 11: paid-replay document check (mock header, never a real payment) ----------
  const paidHeaderName = decoded?.challenge?.x402Version === 1 ? "X-PAYMENT" : "PAYMENT-SIGNATURE";
  const paid = await probe(endpoint, {
    method: "POST",
    headers: { [paidHeaderName]: MOCK_PAYMENT, "X-PAYMENT": MOCK_PAYMENT },
    body: unpaidBody,
  });
  meta.probes.push({ label: `POST with mock ${paidHeaderName}`, status: paid.status ?? "error", ms: paid.ms });

  if (!paid.ok) {
    checks.push(check("paid_path", "Paid path behaviour", "blocker", "unknown",
      `Could not probe the paid path (${paid.error}).`, "Re-run when the endpoint is stable."));
  } else if (paid.status === 402) {
    // Correct for a mock header (it must reject an invalid payment) — but we
    // cannot distinguish "correctly rejected the fake" from "always re-challenges".
    checks.push(
      check("paid_path", "Paid path behaviour", "blocker", "unknown",
        `Returned 402 again when a ${paidHeaderName} header was present. With a mock payment that is the correct, safe response, so this is not a failure — but it also means we could not observe your real paid path.`,
        "Verify by hand with a real signed payment: after a valid payment header, verify it and return the deliverable. If your server re-issues 402 even for a valid payment, that is the #1 rejection — a reviewer pays, gets re-challenged, and rejects the listing.")
    );
  } else if (paid.status === 200 && isRpcError(paid.text)) {
    // JSON-RPC reports protocol/tool errors at HTTP 200 — that is an error
    // envelope, not a deliverable handed out for free.
    checks.push(
      check("paid_path", "Paid path behaviour", "blocker", "unknown",
        `Returned an error response (HTTP 200 with a JSON-RPC error) for the mock payment, so no deliverable was leaked — but we could not observe the real paid path.`,
        "Verify by hand with a real signed payment: after a valid payment header, verify it and return the deliverable inline. Re-issuing 402 to a paying buyer, or returning an empty/pending stub, are the two most common rejections.")
    );
  } else if (paid.status === 200) {
    const body = paid.text ?? "";
    const json = tryJson(body);
    const stub = /"?(status)"?\s*:\s*"(pending|processing|queued|accepted)"/i.test(body);
    const empty = body.trim().length < 40 || (json && Object.keys(json).length === 0);
    if (stub || empty) {
      checks.push(
        check("paid_path", "Paid path behaviour", "blocker", "fail",
          stub ? `Returned 200 with an async stub body: ${body.slice(0, 160)}` : `Returned 200 with an empty/near-empty body (${body.trim().length} bytes).`,
          "Return the finished deliverable inline in the paid 200 response. Reviewers see 'accepted' but an empty deliverable-list and reject. No async 'status: pending' stubs — if the work is slow, do it before responding.")
      );
    } else {
      checks.push(
        check("paid_path", "Paid path behaviour", "blocker", "fail",
          `Returned 200 with a full ${body.trim().length}-byte deliverable even though the payment header was the literal string "${MOCK_PAYMENT}".`,
          "You are not verifying the payment — any caller can send a junk header and get the paid result for free. Verify the payment with the facilitator before doing the work, and return 402 when verification fails.")
      );
    }
  } else {
    checks.push(
      check("paid_path", "Paid path behaviour", "warning", "warn",
        `Returned HTTP ${paid.status} when a payment header was present.`,
        "With an invalid payment the correct response is 402 (or a 4xx naming the verification failure). Make sure a *valid* payment returns 200 with the deliverable inline.")
    );
  }

  // Always-on advisories — not probeable from outside, but each one silently
  // breaks real payments, so every report carries them.
  checks.push(
    check("settle_on_success", "Settle only on success", "warning", "warn",
      "Not probeable from outside — listed because it is a recurring rejection reason.",
      "Never settle payment when the result is an error — several rejections were 'charged on error'. Verify before doing the work, and only settle after you have a successful result to return.")
  );

  checks.push(
    check("cli_payload_extra_fields", "Buyer CLI sends a field the facilitator rejects", "warning", "warn",
      "Not probeable from outside — found by running a real payment end to end, and it will hit you the first time a buyer actually pays.",
      "OKX's buyer CLI adds a top-level \"resource\" field to the payment header it sends you. OKX's own facilitator then rejects any payment containing that field with \"30001 invalid params\", so every real payment fails while unpaid probes still look perfectly healthy. The error reads like a signature problem, which sends you hunting in the wrong place. Before you forward the buyer's payment to the facilitator's verify and settle endpoints, keep only these five top-level fields and drop everything else: x402Version, scheme, network, accepted, payload. Do it for both endpoints, and log whatever you drop, so you notice if the buyer tooling starts sending something new that you actually need.")
  );

  return { checks, meta };
}

// ---------------------------------------------------------------- report ----

const SEV_ORDER = { blocker: 0, warning: 1 };

export function buildReport(input, { checks, meta }) {
  const blocking = checks.filter((c) => c.status === "fail" && c.severity === "blocker");
  const warnings = checks.filter((c) => c.status === "warn" || (c.status === "fail" && c.severity === "warning"));
  const unknown = checks.filter((c) => c.status === "unknown");
  const passed = checks.filter((c) => c.status === "pass");

  const verdict =
    blocking.length > 0 ? "WILL BE REJECTED" : warnings.length > 0 || unknown.length > 0 ? "RISKY" : "READY TO SUBMIT";

  const L = [];
  L.push(`## Preflight Verdict`);
  L.push(`**${verdict}** — ${input.endpoint}`);
  L.push(
    `${blocking.length} blocking issue${blocking.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}, ${unknown.length} could not verify, ${passed.length} passed.`
  );
  L.push("");
  L.push(
    verdict === "WILL BE REJECTED"
      ? "Submitting as-is will fail OKX review. Every blocking issue below has an exact fix."
      : verdict === "RISKY"
        ? "Nothing is outright broken, but the items below are patterns reviewers flag. Clear them before submitting."
        : "Every check we can run from outside your endpoint passed."
  );
  L.push("");

  L.push(`## Blocking Issues`);
  if (blocking.length === 0) {
    L.push("None.");
  } else {
    blocking
      .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
      .forEach((c, i) => {
        L.push(`**${i + 1}. ${c.title}**`);
        L.push(`- What we saw: ${c.evidence}`);
        L.push(`- Fix: ${c.fix}`);
        L.push("");
      });
  }
  L.push("");

  L.push(`## Warnings`);
  if (warnings.length === 0 && unknown.length === 0) {
    L.push("None.");
  } else {
    warnings.forEach((c) => {
      L.push(`- **${c.title}** — ${c.evidence}`);
      L.push(`  - Fix: ${c.fix}`);
    });
    unknown.forEach((c) => {
      L.push(`- **${c.title}** (could not verify) — ${c.evidence}`);
      if (c.fix) L.push(`  - Next: ${c.fix}`);
    });
  }
  L.push("");

  L.push(`## Passed`);
  if (passed.length === 0) {
    L.push("Nothing passed cleanly yet.");
  } else {
    passed.forEach((c) => L.push(`- **${c.title}** — ${c.evidence}`));
  }
  L.push("");

  L.push(`## Before you submit`);
  const steps = [];
  blocking.forEach((c) => steps.push(c.title));
  if (steps.length === 0) {
    steps.push("Re-check that your endpoint stays up and warm through the whole review window");
    steps.push("Confirm your registered fee still matches the 402 amount");
  }
  steps.forEach((s, i) => L.push(`${i + 1}. ${s}`));
  L.push(`${steps.length + 1}. Re-run preflight_x402 and confirm the verdict is READY TO SUBMIT`);
  L.push("");
  if (!ASSET_LIST_VERIFIED) {
    L.push(
      `> Note: token and network constants come from the OKX rejection taxonomy. The facilitator's /supported endpoint requires an API key, so they could not be re-confirmed against the live API at report time.`
    );
    L.push("");
  }
  L.push(
    `Fix these, then run preflight_x402 again — or get your full listing done with Launch Kit Generator.`
  );

  return L.join("\n");
}

export async function preflight(input) {
  const result = await runPreflight(input);
  return { text: buildReport(input, result), meta: result.meta, checks: result.checks };
}
