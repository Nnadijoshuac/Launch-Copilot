// MCP protocol layer — JSON-RPC 2.0 over Streamable HTTP (stateless, JSON responses).
// Zero dependencies by design.

import { TOOLS, findTool, validateInput, runTool } from "./tools.js";
import { requirePayment, settlePayment, catalogueChallenge } from "./payments.js";
import { checkRateLimit, recordStat } from "./stats.js";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, X-Payment, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "X-Payment-Response, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extraHeaders },
  });
}

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message, data) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: data === undefined ? { code, message } : { code, message, data },
});

// Tool-execution failures go back as isError results (self-correctable by an
// agent caller), never as protocol errors or stack traces.
const toolError = (text) => ({ content: [{ type: "text", text }], isError: true });

export async function handleMcp(request, env, ctx) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  // ---- x402 REST path -------------------------------------------------
  // Generic x402 buyer tooling (and reviewers) probe a paid resource with a
  // plain GET or a bodyless POST — they cannot construct a JSON-RPC tools/call
  // envelope. Crucially, `payment pay` REPLAYS the original request verbatim
  // with the payment header attached, so whatever shape discovery happens on
  // must also be payable. Hence one handler serving both.
  if (request.method === "GET" || request.method === "HEAD") {
    return handleX402Rest(request, env, ctx);
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed. POST JSON-RPC to this endpoint." }, 405, { Allow: "GET, POST, OPTIONS" });
  }

  // Read once: a JSON-RPC envelope means MCP, anything else means x402 REST.
  const rawBody = await request.text();
  let msg = null;
  try {
    msg = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    msg = null;
  }
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    // Not an MCP call. Returning a JSON-RPC parse error here (HTTP 200) is what
    // made `payment quote` conclude "no payment required" — and a 200 on an
    // unpaid probe is itself the top review rejection. Serve the x402 path.
    return handleX402Rest(request, env, ctx);
  }
  if (Array.isArray(msg)) {
    return json(rpcError(null, -32600, "Batch requests are not supported"));
  }
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return json(rpcError(msg?.id, -32600, "Invalid Request: expected a JSON-RPC 2.0 message"));
  }

  // Notifications (no id) are acknowledged with 202 and no body.
  if (msg.id === undefined || msg.id === null) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      const version = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      return json(
        rpcResult(msg.id, {
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: { name: "launch-copilot", title: "Launch Copilot", version: "1.0.0" },
          instructions:
            "Launch Copilot helps OKX.AI ASP builders launch successfully. " +
            "Tools: audit_listing (FREE — score a draft listing and get the top 3 fixes), " +
            "generate_launch_kit (1 USDT via x402 — full listing package, pricing, X thread with #OKXAI, 90-second demo script), " +
            "pricing_check (0.2 USDT via x402 — category comps table and a recommended price). " +
            "All results are single markdown documents with fixed, paste-ready sections.",
        })
      );
    }

    case "ping":
      return json(rpcResult(msg.id, {}));

    case "tools/list":
      return json(
        rpcResult(msg.id, {
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        })
      );

    case "tools/call":
      return handleToolCall(request, env, ctx, msg);

    default:
      return json(rpcError(msg.id, -32601, `Method not found: ${msg.method}`));
  }
}

/** Coerce query-string values to the types the tool's schema declares. */
function argsFromQuery(tool, url) {
  const args = {};
  const props = tool.inputSchema.properties;
  for (const [k, v] of url.searchParams) {
    if (k === "tool") continue;
    const spec = props[k];
    if (!spec) {
      args[k] = v;
      continue;
    }
    if (spec.type === "number") {
      const n = Number(v);
      args[k] = Number.isFinite(n) ? n : v;
    } else if (spec.type === "boolean") {
      args[k] = v === "true" ? true : v === "false" ? false : v;
    } else if (spec.type === "object") {
      try {
        args[k] = JSON.parse(v);
      } catch {
        args[k] = v;
      }
    } else {
      args[k] = v;
    }
  }
  return args;
}

/**
 * x402 REST surface — the shape generic buyer tooling can both discover AND
 * pay on. Select a tool with `?tool=<name>`; pass its arguments as further
 * query params. Without `?tool=`, returns the service catalogue challenge.
 *
 * Same payment invariants as the JSON-RPC path: payment gate before business
 * validation, 402 only when the buyer is at fault, settle only after success.
 */
async function handleX402Rest(request, env, ctx) {
  const started = Date.now();
  const url = new URL(request.url);
  const resourceUrl = url.origin + "/mcp";
  const toolName = url.searchParams.get("tool");
  const tool = toolName ? findTool(toolName) : null;
  const hasPaymentHeader = Boolean(
    request.headers.get("payment-signature") || request.headers.get("x-payment")
  );

  if (toolName && !tool) {
    return json(
      {
        error: "unknown_tool",
        message: `Unknown tool "${toolName}". Available: ${TOOLS.map((t) => t.name).join(", ")}`,
      },
      404
    );
  }

  // No tool named → discovery only. If a payment arrived anyway we must NOT
  // re-challenge (that is the top rejection) and must NOT charge for nothing:
  // tell the buyer exactly what to add.
  if (!tool) {
    if (hasPaymentHeader) {
      return json(
        {
          error: "tool_not_specified",
          message:
            "A payment header was received but no service was selected, so nothing was charged or executed. " +
            `Add ?tool=<name> to the URL and pay that request. Paid services: ${TOOLS.filter((t) => t.priceAtomic)
              .map((t) => `${t.name} (${t.priceLabel})`)
              .join(", ")}.`,
        },
        400
      );
    }
    return catalogueChallenge(env, TOOLS, resourceUrl);
  }

  const log = (fields) =>
    console.log(JSON.stringify({ evt: "rest_call", tool: tool.name, ms: Date.now() - started, ...fields }));

  // Free tools need no payment — run directly.
  let payment = { mode: "free" };
  if (tool.priceAtomic) {
    payment = await requirePayment(request, env, tool);
    if (!payment.ok) {
      log({ status: "payment_required", reason: payment.reason });
      ctx.waitUntil(recordStat(env, tool.name, "payment_required"));
      return payment.response;
    }
  }

  const args = argsFromQuery(tool, url);
  const inputErrors = validateInput(tool, args);
  if (inputErrors.length > 0) {
    log({ status: "invalid_input" });
    ctx.waitUntil(recordStat(env, tool.name, "invalid_input"));
    // Paid but unusable input: no settlement happens (we only settle after a
    // successful result), so the buyer is not charged.
    return json(
      {
        error: "invalid_input",
        message: `Invalid input for ${tool.name}: ${inputErrors.join("; ")}`,
        example: `${resourceUrl}?tool=${tool.name}&` +
          Object.entries(tool.example)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === "object" ? JSON.stringify(v) : v)}`)
            .join("&"),
        charged: false,
      },
      400
    );
  }

  let result;
  try {
    result = await runTool(env, tool, args);
  } catch (err) {
    log({ status: "error", error: String(err?.message ?? err).slice(0, 200) });
    ctx.waitUntil(recordStat(env, tool.name, "error"));
    return json({ error: "generation_failed", message: "Upstream model error. You have not been charged.", charged: false }, 502);
  }

  const headers = { "Content-Type": "text/markdown; charset=utf-8" };
  if (payment.mode === "paid") {
    const settlement = await settlePayment(env, payment, tool);
    if (settlement.header) headers["PAYMENT-RESPONSE"] = settlement.header;
    if (!settlement.ok) {
      console.log(
        JSON.stringify({
          evt: settlement.pending ? "settle_pending_reconcile" : "settle_failed_reconcile",
          tool: tool.name,
          payer: payment.payer ?? null,
          detail: settlement.detail?.slice?.(0, 500) ?? null,
        })
      );
    }
  }

  log({ status: "ok", payment: payment.mode, provider: result.provider, warnings: result.warnings.length });
  ctx.waitUntil(recordStat(env, tool.name, "ok"));

  let text = result.text;
  if (result.warnings.length > 0) {
    text += `\n\n> Note: automated quality checks flagged: ${result.warnings.join("; ")}.`;
  }
  return new Response(text, { status: 200, headers: { ...headers, ...CORS_HEADERS } });
}

async function handleToolCall(request, env, ctx, msg) {
  const started = Date.now();
  const name = msg.params?.name;
  const args = msg.params?.arguments ?? {};
  const tool = findTool(name);

  if (!tool) {
    return json(
      rpcError(msg.id, -32602, `Unknown tool: ${JSON.stringify(name)}. Available: ${TOOLS.map((t) => t.name).join(", ")}`)
    );
  }

  const log = (fields) =>
    console.log(
      JSON.stringify({
        evt: "tool_call",
        tool: tool.name,
        ms: Date.now() - started,
        ...fields,
      })
    );

  // 1. Payment gate FIRST for paid tools — before input validation, before any
  //    LLM spend. Order matters: OKX's reviewer probes a paid endpoint with an
  //    arbitrary body, and "402 before any business validation" is an explicit
  //    review expectation. Validating first would answer that probe with a 200
  //    input error instead of a payment challenge.
  //    A payer who then sends bad input is still not charged — settlement only
  //    happens after a successful result (step 5).
  let payment = { mode: "free" };
  if (tool.priceAtomic) {
    payment = await requirePayment(request, env, tool);
    if (!payment.ok) {
      log({ status: "payment_required", reason: payment.reason });
      ctx.waitUntil(recordStat(env, tool.name, "payment_required"));
      return payment.response; // 402 challenge, or 503 while verification is stubbed
    }
  } else {
    // 2. Rate limit the free tools (per caller IP, per day).
    const rl = await checkRateLimit(request, env);
    if (!rl.ok) {
      log({ status: "rate_limited" });
      return json(
        rpcResult(
          msg.id,
          toolError(
            `Daily free-tool limit reached (${rl.limit}/day). Try again tomorrow, ` +
              `or use the paid tools (generate_launch_kit, pricing_check) which are not rate limited.`
          )
        )
      );
    }
  }

  // 3. Input validation — pure code, no LLM spend. Errors are written so an
  //    agent can self-correct and retry.
  const inputErrors = validateInput(tool, args);
  if (inputErrors.length > 0) {
    log({ status: "invalid_input" });
    ctx.waitUntil(recordStat(env, tool.name, "invalid_input"));
    return json(
      rpcResult(
        msg.id,
        toolError(
          `Invalid input for ${tool.name}:\n- ${inputErrors.join("\n- ")}\n\n` +
            `Fix the arguments and call again. Example arguments:\n${JSON.stringify(tool.example, null, 2)}`
        )
      )
    );
  }

  // 4. Generate (single-shot LLM call + code validators, one retry inside).
  let result;
  try {
    result = await runTool(env, tool, args);
  } catch (err) {
    log({ status: "error", error: String(err?.message ?? err).slice(0, 300) });
    ctx.waitUntil(recordStat(env, tool.name, "error"));
    // Paid + verified but not settled: nothing was charged yet (settle happens
    // after success), so a plain error is safe.
    return json(
      rpcResult(
        msg.id,
        toolError(
          `${tool.name} failed to generate a result (upstream model error). ` +
            `You have not been charged. Please retry in a few seconds.`
        )
      )
    );
  }

  // 5. Settle AFTER successful generation. Verify-passed-but-settle-failed is
  //    treated as a served call and logged for reconciliation.
  const extraHeaders = {};
  if (payment.mode === "paid") {
    const settlement = await settlePayment(env, payment, tool);
    if (settlement.header) extraHeaders["X-Payment-Response"] = settlement.header;
    if (!settlement.ok) {
      console.log(
        JSON.stringify({
          evt: settlement.pending ? "settle_pending_reconcile" : "settle_failed_reconcile",
          tool: tool.name,
          payer: payment.payer ?? null,
          detail: settlement.detail?.slice?.(0, 500) ?? null,
        })
      );
    }
  }

  log({ status: "ok", payment: payment.mode, provider: result.provider, warnings: result.warnings.length });
  ctx.waitUntil(recordStat(env, tool.name, "ok"));

  let text = result.text;
  if (result.warnings.length > 0) {
    text += `\n\n> Note: automated quality checks flagged: ${result.warnings.join("; ")}. The sections above are still usable.`;
  }
  return json(rpcResult(msg.id, { content: [{ type: "text", text }] }), 200, extraHeaders);
}
