# Launch Copilot — Claude Code build instructions

You are building **Launch Copilot**, an A2MCP Agent Service Provider (ASP) for the OKX.AI Genesis Hackathon. **Read DESIGN.md first — it is the complete, locked system design.** Do not re-litigate architecture decisions; build to the spec. Deadline: **July 27, 23:59 UTC** (confirmed). Target: live on OKX.AI within 24 hours.

## What already exists
- `DESIGN.md` — full system design: three tools, components, flows, stress tests, build plan
- `src/knowledge/rules.json` — curated OKX platform/hackathon knowledge (powers the generation prompts)
- `src/knowledge/comps.json` — marketplace comps snapshot seeded from live okx.ai/agents data (2026-07-21)

## Build order (do not reorder — payment risk gets derisked first)
1. **Spike**: minimal Cloudflare Workers MCP server (Streamable HTTP, JSON-RPC: `initialize`, `tools/list`, `tools/call`) with one dummy tool. Deploy it. Verify with MCP Inspector.
2. **Spike**: x402 paywall on the dummy tool — 402 + PaymentRequirements → verify via OKX facilitator → settle. Consult OKX Payment API docs (`/api/v6/pay/x402/supported`, `/verify`, `/settle`; docs at web3.okx.com under Onchain OS → Payment). Include a `FREE_MODE` env flag that bypasses payments entirely — this is the fallback if x402 fights us.
3. `audit_listing` (free tool): input schema per DESIGN.md §3, single-shot LLM call (Anthropic API) with prompt assembled from rules.json + comps.json, code validators on output.
4. `generate_launch_kit` (1 USDT) and `pricing_check` (0.2 USDT) behind the paywall.
5. `/` landing page (single static HTML), private `/stats`.
6. Dogfood: run our own listing copy, X thread, and 90-sec demo script through our own `generate_launch_kit`.

## Hard rules
- **Zero runtime dependencies** if possible — plain JS/TS fetch handler, no frameworks. Every dependency is a 2 AM failure mode.
- Strict input schemas with examples in every description — the callers are agents, not humans; errors must be self-correctable.
- Verify payment BEFORE any LLM call. Never burn tokens on unpaid requests.
- Validators (pure code): output has all named sections; X thread contains #OKXAI; demo script ≤ 220 words; no empty sections. One retry with failure reason appended, then graceful partial result.
- Secrets via `wrangler secret` only (ANTHROPIC_API_KEY, PAY_TO_ADDRESS, STATS_KEY). Never hardcode, never commit.
- Response format: one markdown document, fixed section order, every section paste-ready.

## Registration steps (run with the user, on their machine — needs their email/wallet)
1. `npx skills add okx/onchainos-skills --yes -g`, then new session
2. "Log in to Agentic Wallet on Onchain OS with my email"
3. "Help me register an A2MCP ASP on OKX.AI using OKX Agent Identity from Onchain OS" — point at the deployed endpoint
4. "Help me list my ASP on OKX.AI using Onchain OS"
Review SLA is 24h; result arrives by email + agent conversation window. Pre-approval, the ASP is callable via Agent ID.

## Success bar for tonight
Live HTTPS endpoint passing MCP Inspector, x402 verified (or FREE_MODE on with a documented reason), ASP registration submitted before sleep.
