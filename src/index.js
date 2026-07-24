// Launch Copilot — entry point. Routes:
//   POST /mcp     MCP endpoint (Streamable HTTP, JSON-RPC 2.0)
//   GET  /        static landing page
//   GET  /stats   private call totals (requires STATS_KEY)
//   GET  /health  liveness probe

import { handleMcp, CORS_HEADERS } from "./mcp.js";
import { handleStats } from "./stats.js";
import { LANDING_HTML } from "./landing.js";
import { activeChain } from "./chains.js";
import { paymentConfigError } from "./payments.js";
import { hasOkxCredentials } from "./okx-auth.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    switch (url.pathname) {
      case "/mcp":
        return handleMcp(request, env, ctx);

      case "/":
        if (request.method !== "GET" && request.method !== "HEAD") {
          return new Response("Method not allowed", { status: 405 });
        }
        return new Response(LANDING_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
        });

      case "/stats":
        return handleStats(request, env);

      case "/health": {
        // Booleans only — presence, never values. Exists so "is the payment
        // path actually armed?" is answerable without guessing from an error
        // message. `payments_armed` is the single question that matters.
        const chain = activeChain(env);
        const mode = String(env.X402_MODE ?? "stubbed").toLowerCase();
        const configError = paymentConfigError(env);
        return Response.json({
          ok: true,
          service: "launch-copilot",
          x402_mode: mode,
          chain: { key: chain.key, network: chain.network, asset: chain.asset, asset_verified: chain.assetVerified },
          credentials: {
            okx: hasOkxCredentials(env),
            pay_to: Boolean(env.PAY_TO_ADDRESS),
            llm: Boolean(env.LLM_API_KEY),
          },
          config_error: configError,
          payments_armed: mode === "live" && hasOkxCredentials(env) && !configError,
          time: new Date().toISOString(),
        });
      }

      default:
        if (request.method === "OPTIONS") {
          return new Response(null, { status: 204, headers: CORS_HEADERS });
        }
        return new Response("Not found", { status: 404 });
    }
  },
};
