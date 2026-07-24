// x402 paywall middleware — OKX Payment API facilitator (verify/settle).
//
// ┌─ WHAT IS REAL vs STUBBED (read before the spike) ──────────────────────┐
// │ REAL today:                                                            │
// │   • The 402 challenge. Unpaid requests to a paid tool get a genuine     │
// │     x402 v2 challenge: PAYMENT-REQUIRED header (base64 of              │
// │     {x402Version, resource, accepts}) + the same JSON in the body.     │
// │     Asset/network/amount/payTo are the real registered values.          │
// │   • The gate itself. A paid tool NEVER runs without passing this file. │
// │                                                                        │
// │   • Facilitator auth. /supported, /verify and /settle are HMAC-SHA256   │
// │     signed per OKX's spec (src/okx-auth.js).                            │
// │   • The live path: verify BEFORE the LLM runs, settle only AFTER a      │
// │     successful result. Wired and callable.                              │
// │                                                                        │
// │ NOT YET EXERCISED:                                                     │
// │   • A real end-to-end paid call (needs a funded wallet). Until that     │
// │     runs, treat /verify and /settle response-shape handling as          │
// │     unproven against production data.                                   │
// │                                                                        │
// │ MODES (X402_MODE):                                                      │
// │   "stubbed" — emit the real 402, but never call the facilitator. A      │
// │     payment header gets HTTP 503 "verification not live". Never a free  │
// │     deliverable, never a second 402.                                    │
// │   "live"    — full verify → execute → settle.                           │
// │                                                                        │
// │ SAFETY INVARIANT: a 402 is only ever returned when the BUYER is at      │
// │   fault (no payment, or the facilitator says the payment is invalid).   │
// │   Every OUR-side failure — stubbed mode, missing credentials,           │
// │   facilitator unreachable, non-200 from /verify — returns 503 instead,  │
// │   because re-challenging someone who already paid is the single most    │
// │   common review rejection.                                              │
// └────────────────────────────────────────────────────────────────────────┘

import { CORS_HEADERS } from "./mcp.js";
import { okxRequest, hasOkxCredentials } from "./okx-auth.js";
import { activeChain, chainConfigError } from "./chains.js";

// x402 v2 — the version OKX's facilitator/CLI operates on (EIP-3009 exact
// scheme). v1 challenges are rejected by v2 buyer tooling.
const X402_VERSION = 2;

// Header names differ by version: v2 signs into PAYMENT-SIGNATURE, v1 used
// X-PAYMENT. We read both so a v1-era buyer is not silently ignored.
const PAID_HEADERS = ["payment-signature", "x-payment"];

// btoa() only accepts Latin1. Challenge/receipt JSON can contain any UTF-8
// (our tool descriptions use an em-dash), so encode to UTF-8 bytes first.
function b64utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function isLive(env) {
  return String(env.X402_MODE ?? "stubbed").toLowerCase() === "live";
}

export function buildPaymentRequirements(env, tool, resourceUrl) {
  const chain = activeChain(env);
  return {
    scheme: "exact",
    network: chain.network, // CAIP-2, from the active chain profile
    asset: chain.asset ?? "",
    amount: tool.priceAtomic, // v2 field name (v1 called this maxAmountRequired)
    payTo: env.PAY_TO_ADDRESS || "",
    maxTimeoutSeconds: 120,
    resource: resourceUrl,
    description: `${tool.name} — ${tool.priceLabel}`,
    mimeType: "application/json",
    extra: chain.extra, // EIP-712 domain for transferWithAuthorization
  };
}

/**
 * Everything that must be true before we can honestly advertise a price.
 * Returns a human-readable reason, or null when the config is sound.
 * Covers the settlement asset (via the chain profile) AND the payout address —
 * a 402 quoting `payTo: ""` or the zero address is worse than no 402 at all,
 * because a buyer may sign against it and lose the funds.
 */
export function paymentConfigError(env) {
  const chainErr = chainConfigError(activeChain(env));
  if (chainErr) return chainErr;

  const payTo = env.PAY_TO_ADDRESS || "";
  if (!payTo) {
    return "No payout address configured (PAY_TO_ADDRESS). Set it with `wrangler secret put PAY_TO_ADDRESS`.";
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(payTo)) {
    return `Payout address "${payTo}" is not a valid 20-byte address.`;
  }
  if (/^0x0{40}$/i.test(payTo)) {
    return "Payout address is the zero address — payments to 0x000…000 are burned.";
  }
  return null;
}

function challengeBody(env, tool, resourceUrl) {
  return {
    x402Version: X402_VERSION,
    resource: resourceUrl,
    accepts: [buildPaymentRequirements(env, tool, resourceUrl)],
  };
}

/** HTTP 402 with the challenge in BOTH the v2 header and the body (v1-compatible readers). */
export function paymentRequiredResponse(env, tool, resourceUrl, errorMsg, extraBody = {}) {
  const body = { ...challengeBody(env, tool, resourceUrl), ...extraBody };
  if (errorMsg) body.error = errorMsg;
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": b64utf8(JSON.stringify(challengeBody(env, tool, resourceUrl))),
      ...CORS_HEADERS,
    },
  });
}

/**
 * HTTP 503 — we could not verify the payment for a reason that is OUR fault,
 * not the buyer's. Never a 402 (that would re-challenge a payer).
 *
 * `cause` MUST distinguish the real reason. These states look identical to a
 * buyer but need completely different fixes, and a single generic message
 * previously sent debugging down the wrong path.
 */
const PENDING_CAUSES = {
  mode_stubbed: "This endpoint is running with payment verification switched off (X402_MODE is not \"live\").",
  missing_credentials:
    "This endpoint is in live mode but its payment-provider credentials are not configured, so verification could not be attempted.",
  facilitator_unreachable: "The payment facilitator could not be reached.",
  facilitator_error: "The payment facilitator returned an error instead of a verification result.",
};

function verificationPendingResponse(env, tool, resourceUrl, cause = "mode_stubbed", detail = null) {
  return new Response(
    JSON.stringify({
      error: "payment_verification_unavailable",
      cause, // machine-readable: which of the four states this is
      message:
        `${PENDING_CAUSES[cause] ?? PENDING_CAUSES.mode_stubbed} ` +
        "Your payment has NOT been verified, charged, or settled, and no deliverable was returned. " +
        "Nothing was billed. This is a provider-side problem, not a problem with your payment.",
      facilitator_detail: detail ? String(detail).slice(0, 300) : null,
      x402Version: X402_VERSION,
      resource: resourceUrl,
      tool: tool.name,
    }),
    {
      status: 503,
      headers: { "Content-Type": "application/json", "Retry-After": "3600", ...CORS_HEADERS },
    }
  );
}

/**
 * Top-level keys the OKX facilitator accepts inside `paymentPayload`.
 *
 * WHY THIS EXISTS (diagnosed 2026-07-22, reproduced against the live API):
 * OKX's own buyer CLI writes a top-level `resource` field into the
 * PAYMENT-SIGNATURE header, and OKX's own facilitator then rejects any payload
 * containing it with `{"code":30001,"error_message":"invalid params"}`. The
 * failure reads like a signature problem but is purely shape. Proof, same
 * signature, three calls: payload as-is → 30001; payload with `resource`
 * removed → {"isValid":true,"payer":"0x8b91…ee97"}.
 *
 * A whitelist (not a `delete payload.resource`) is deliberate: a future CLI
 * build could add another stray field, and dropping an unknown key is safer
 * than forwarding one. The trade-off is that a genuinely NEW required field
 * would be silently dropped — hence every drop is logged, so it surfaces in
 * `wrangler tail` instead of becoming a mystery.
 */
const FACILITATOR_PAYLOAD_KEYS = ["x402Version", "scheme", "network", "accepted", "payload"];

function projectPaymentPayload(payload, context) {
  const projected = {};
  const dropped = [];
  for (const [k, v] of Object.entries(payload ?? {})) {
    if (FACILITATOR_PAYLOAD_KEYS.includes(k)) projected[k] = v;
    else dropped.push(k);
  }
  if (dropped.length > 0) {
    console.log(
      JSON.stringify({
        evt: "payment_payload_keys_dropped",
        dropped, // key names only — never values
        kept: Object.keys(projected),
        ...context,
      })
    );
  }
  return projected;
}

// OKX API responses may be wrapped as { code, msg, data } — tolerate both.
function unwrap(d) {
  if (d && typeof d === "object" && d.data && typeof d.data === "object") return d.data;
  return d ?? {};
}

/**
 * Authenticated call to the OKX x402 facilitator. The facilitator rejects
 * unauthenticated requests ("Request header OK-ACCESS-KEY can not be empty",
 * verified 2026-07-22), so every call is HMAC-signed — see src/okx-auth.js.
 */
async function facilitator(env, path, body, method = "POST") {
  const base = (env.FACILITATOR_BASE || "").replace(/\/$/, "");
  const r = await okxRequest(env, `${base}${path}`, { method, body });
  return { status: r.status, data: r.data, raw: r.raw, authed: r.authed };
}

/** GET /supported — the facilitator's advertised schemes, networks and assets. */
export async function fetchSupported(env) {
  return facilitator(env, "/supported", undefined, "GET");
}

function readPaymentHeader(request) {
  for (const name of PAID_HEADERS) {
    const v = request.headers.get(name);
    if (v) return { name, value: v };
  }
  return null;
}

/**
 * Gate a paid tool call. Returns:
 *  { ok: true, mode: "paid", payload, requirements }  — verified, execute then settle
 *  { ok: false, reason, response }                    — send `response` as-is
 *
 * There is no "free bypass" branch: a paid tool never yields a deliverable
 * without a verified payment, in any mode.
 */
export async function requirePayment(request, env, tool) {
  const resourceUrl = new URL(request.url).origin + "/mcp";
  const header = readPaymentHeader(request);

  // Refuse to advertise a malformed challenge. An accepts[] entry with an empty
  // or invalid `asset` / `payTo` is unsignable — better an honest 503 than a
  // 402 that wastes a buyer's time (or, worse, sends funds nowhere).
  const configError = paymentConfigError(env);
  if (configError) {
    console.log(JSON.stringify({ evt: "chain_misconfigured", tool: tool.name, detail: configError }));
    return {
      ok: false,
      reason: "chain_misconfigured",
      response: new Response(
        JSON.stringify({
          error: "payment_configuration_incomplete",
          message: `This endpoint cannot currently accept payment: ${configError}`,
          tool: tool.name,
        }),
        { status: 503, headers: { "Content-Type": "application/json", "Retry-After": "3600", ...CORS_HEADERS } }
      ),
    };
  }

  // No payment at all → the real 402 challenge. Same in stubbed and live mode.
  if (!header) {
    return {
      ok: false,
      reason: "no_payment",
      response: paymentRequiredResponse(env, tool, resourceUrl),
    };
  }

  // Payment header present, but we cannot verify it. Say exactly that.
  // Two ways to land here: mode is still "stubbed", or someone flipped it to
  // "live" without credentials. Both are OUR problem, not the buyer's — so we
  // return 503, never another 402. Re-challenging a payer is the #1 rejection.
  if (!isLive(env) || !hasOkxCredentials(env)) {
    if (isLive(env)) {
      console.log(JSON.stringify({ evt: "live_mode_without_credentials", tool: tool.name }));
    }
    return {
      ok: false,
      reason: isLive(env) ? "missing_credentials" : "verification_stubbed",
      response: verificationPendingResponse(
        env,
        tool,
        resourceUrl,
        isLive(env) ? "missing_credentials" : "mode_stubbed"
      ),
    };
  }

  // ---- live path: everything below runs only when X402_MODE = "live" ----
  let payload;
  try {
    payload = JSON.parse(atob(header.value));
  } catch {
    return {
      ok: false,
      reason: "bad_payload",
      response: paymentRequiredResponse(
        env,
        tool,
        resourceUrl,
        `${header.name} header is not valid base64-encoded JSON`
      ),
    };
  }

  const requirements = buildPaymentRequirements(env, tool, resourceUrl);

  let verify;
  try {
    verify = await facilitator(env, "/verify", {
      x402Version: X402_VERSION,
      paymentPayload: projectPaymentPayload(payload, { phase: "verify", tool: tool.name }),
      paymentRequirements: requirements,
    });
  } catch (err) {
    console.log(JSON.stringify({ evt: "verify_unreachable", error: String(err).slice(0, 300) }));
    return {
      ok: false,
      reason: "verify_unreachable",
      response: verificationPendingResponse(env, tool, resourceUrl, "facilitator_unreachable", String(err).slice(0, 300)),
    };
  }

  // Distinguish "the buyer's payment is bad" from "our facilitator call broke".
  // Only the former justifies another 402; the latter is a 503, because
  // re-challenging someone who actually paid is the top review rejection.
  //
  // The facilitator answers HTTP 200 even for its own errors — the real status
  // is the envelope's `code` (0 = ok) plus data.isValid. Observed 2026-07-22:
  //   ok/invalid : {"code":0,"data":{"isValid":false,"invalidReason":
  //                 "invalid_signature","invalidMessage":"Signature
  //                 verification failed","payer":"0x…"}}
  //   its error  : {"code":-1,"data":{},"msg":"unknown error"}
  const envelopeCode = verify.data?.code;
  const envelopeOk = envelopeCode === undefined || String(envelopeCode) === "0";
  if (verify.status !== 200 || !envelopeOk) {
    console.log(
      JSON.stringify({
        evt: "verify_infrastructure_error",
        status: verify.status,
        code: envelopeCode ?? null,
        raw: String(verify.raw).slice(0, 200),
      })
    );
    return {
      ok: false,
      reason: "verify_infrastructure_error",
      response: verificationPendingResponse(
        env,
        tool,
        resourceUrl,
        "facilitator_error",
        `HTTP ${verify.status} code=${envelopeCode ?? "?"} ${String(verify.raw).slice(0, 200)}`
      ),
    };
  }

  const v = unwrap(verify.data);
  const isValid = v.isValid ?? v.valid ?? v.is_valid ?? false;
  if (isValid !== true) {
    // invalidMessage is the human-readable one; invalidReason is the code.
    const why =
      v.invalidMessage ?? v.invalid_message ?? v.invalidReason ?? v.invalid_reason ?? v.reason ?? "payment verification failed";
    const code = v.invalidReason ?? v.invalid_reason ?? null;
    console.log(JSON.stringify({ evt: "verify_rejected", code, why: String(why).slice(0, 200) }));
    return {
      ok: false,
      reason: "invalid_payment",
      response: paymentRequiredResponse(env, tool, resourceUrl, String(why)),
    };
  }

  // Verified. Raw envelope logged for the same reason as settle_raw below:
  // the payer address is public on-chain data and is the only reconciliation
  // evidence if a payment is later disputed. Deliberate, approved 2026-07-22.
  console.log(JSON.stringify({ evt: "verify_ok", tool: tool.name, raw: String(verify.raw).slice(0, 400) }));

  return {
    ok: true,
    mode: "paid",
    payload,
    requirements,
    payer: v.payer ?? payload?.payload?.authorization?.from,
  };
}

/**
 * Settle after successful generation. Never throws; returns { ok, header?, detail? }.
 * Only ever called on the live path (mode === "paid").
 */
export async function settlePayment(env, payment, tool) {
  try {
    const settle = await facilitator(env, "/settle", {
      x402Version: X402_VERSION,
      paymentPayload: projectPaymentPayload(payment.payload, { phase: "settle", tool: tool.name }),
      paymentRequirements: payment.requirements,
    });
    // DELIBERATE DECISION (approved 2026-07-22): the raw facilitator envelope
    // IS logged, and this is the one place we knowingly log an identifier.
    // It carries the payer wallet address and the settlement tx hash — both
    // public on-chain data, and the only evidence available to reconcile a
    // disputed or failed settlement after the fact. Everything else in this
    // service logs shapes, not payloads (no tool arguments, no generated
    // output). Removing this would make a settlement dispute unarguable.
    console.log(JSON.stringify({ evt: "settle_raw", tool: tool.name, raw: String(settle.raw).slice(0, 600) }));
    const s = unwrap(settle.data);

    // FAIL CLOSED. The facilitator returns HTTP 200 even for its own failures
    // ({"code":-1,"data":{},"msg":"unknown error"} observed 2026-07-22), so an
    // earlier `?? settle.status === 200` fallback would have reported a
    // SUCCESSFUL settlement for an errored one. Success now requires an
    // explicit positive signal.
    //   success  : {"code":0,"data":{"success":true,"status":"success",
    //               "transaction":"0x…","payer":"0x…","network":"eip155:196"}}
    //   failure  : {"code":0,"data":{"success":false,"status":"failed",
    //               "errorReason":"insufficient_balance","errorMessage":"…"}}
    const envelopeOk = settle.data?.code === undefined || String(settle.data.code) === "0";
    const status = s.status ?? null;

    // DELIBERATE DECISION (approved 2026-07-22 after the testnet proof run):
    // `success === true` alone is sufficient to release the deliverable, even
    // when `status` is still "pending". We do NOT wait for on-chain
    // confirmation.
    //   Why: the facilitator's success:true is a commitment, and X Layer
    //   settlement is fast and highly reliable. Blocking on confirmation would
    //   add seconds of latency to every paid call for a sub-dollar service.
    //   Evidence: on the first real testnet payment the envelope returned
    //   {success:true, status:"pending", transaction:"0xbe808fdd…c9e7"} and the
    //   chain subsequently reported SUCCESS.
    //   Trade-off accepted: if a settlement that reported success:true later
    //   fails on-chain, we will have already delivered. That is a deliberate
    //   speed-over-confirmation choice, not an oversight. `pending` is tracked
    //   separately below so reconciliation can still distinguish the two.
    const ok = envelopeOk && (s.success === true || status === "success");
    // `exact` settles synchronously; aggr_deferred can report pending, which is
    // "settling", not a failure — surfaced so reconciliation can tell them apart.
    const pending = envelopeOk && status === "pending";

    const responseBody = {
      success: ok,
      status: status ?? (ok ? "success" : "failed"),
      transaction: s.transaction ?? s.txHash ?? s.tx_hash ?? null,
      network: s.network || payment.requirements.network,
      payer: s.payer || payment.payer || null,
    };
    const detail = ok
      ? null
      : (s.errorMessage ?? s.error_message ?? settle.data?.msg ?? settle.raw ?? "").toString().slice(0, 500);
    return { ok, pending, header: b64utf8(JSON.stringify(responseBody)), detail };
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
}

/** Service catalogue + challenge for a bare GET probe (see mcp.js). */
export function catalogueChallenge(env, tools, resourceUrl) {
  const flagship = tools.find((t) => t.priceAtomic) ?? tools[0];
  return paymentRequiredResponse(env, flagship, resourceUrl, undefined, {
    service: "launch-copilot",
    transport: "MCP Streamable HTTP — POST JSON-RPC 2.0 to this URL",
    services: tools.map((t) => ({
      name: t.name,
      price: t.priceLabel,
      payment_required: Boolean(t.priceAtomic),
    })),
    note:
      "The accepts[] above covers the flagship paid service. Free tools are callable by POSTing a tools/call request with no payment.",
  });
}
