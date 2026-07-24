# Launch Copilot — Registration Record

## Mainnet payment path proven (2026-07-23)

The x402 paid loop is live on X Layer mainnet and settled a real payment.

- **Production `X402_MODE`:** `live` (flipped 2026-07-23; deploy `56d6b519-f29b-4d32-a598-919e50880290`)
- **Settlement chain:** X Layer mainnet, `eip155:196`, USD₮0 `0x779ded0c9e1022225f8e0630b35a9b54be713736` (6 dp)
- **First mainnet payment tx:** `0x447d3e902e19982102436443eab59319dea279b7afab50f139b36daaf411945c`
- **OKLink:** https://www.oklink.com/xlayer/tx/0x447d3e902e19982102436443eab59319dea279b7afab50f139b36daaf411945c
- **Status — authoritative:** OKX chain API (`onchainos wallet history --chain xlayer`) reports **`txStatus: SUCCESS`**. Token-level view: `from == to == 0x8b91361f58980992c2eeca0410f21cc9c181ee97` (self-transfer, net amount `0.000000`), symbol USDT, block 66066095, settled 2026-07-23T19:32:11Z. (OKLink's web page rendered "Pending" transiently while confirming; the API SUCCESS is authoritative.)
- **What this proves:** unpaid probe → 402 → buyer signs → facilitator `/verify` passes → tool executes → `/settle` returns a real tx → deliverable returned with `PAYMENT-RESPONSE`. Preceded by two testnet settlements (`0xbe808fdd…c9e7`, `0x3454b63d…c94b`).
- **Reconciliation note:** internal `/verify` + `/settle` envelope bytes for THIS run were **not captured** — no `wrangler tail` was running on the deploy side (payment ran from a separate terminal; `tail` has no replay). Confirmation rests on the on-chain record, which is stronger than our own logs. Future paid calls will have a tail open.
- **Payout address:** `0x8b91361f58980992c2eeca0410f21cc9c181ee97` (the wallet that owns #7225).

## Deployment (live, verified 2026-07-22)

- **Live URL:** https://launch-copilot.joshua-ai.workers.dev
- **MCP endpoint (for OKX registration):** https://launch-copilot.joshua-ai.workers.dev/mcp
- **workers.dev subdomain:** `joshua-ai` (base name "joshua" was globally taken; registered via API 2026-07-22)
- **Deploy version:** 698ca464-5532-47be-b723-fca677a0ebf5
- **Acceptance tests (all passed 2026-07-22, ~23:50 UTC):**
  - `/health` 200; landing page renders (5,767 bytes)
  - MCP round-trip: initialize → tools/list (3 tools) → audit_listing live call, `isError:false`, `Score: 20/100 — AT-RISK` on the deliberately weak sample
  - MCP Inspector (CLI): connect ✓, tools listed ✓, audit_listing executed ✓ (OKX's recommended pre-registration test)
  - `/stats` with production STATS_KEY: real KV counters incrementing
  - Latency: 2.8s (curl audit), 1.57s (pricing_check, production log `provider:"primary"`, `model:"llama-3.3-70b-versatile"`) — far under the 20s design target
- FREE_MODE: **on** (paid tools currently respond without payment; listed prices are the intended prices)

## OKX.AI registration — status: **SUBMITTED FOR REVIEW** (2026-07-22)

- **ASP name:** Launch Copilot
- **Category:** Software services · **Service type:** A2MCP (all 3 services)
- **Service endpoint:** https://launch-copilot.joshua-ai.workers.dev/mcp
- **Agent ID:** **#7225**  (chainIndex 196 — X Layer)
- **Owner wallet (EVM):** 0x8b91361f58980992c2eeca0410f21cc9c181ee97 (Agentic Wallet, Google login chimdijos8@gmail.com)
- **Registration tx hash:** 0x1f2e0e8437ff7014d56fca8ebc44b59dd054ca27170d928ba3ba598d8e0316ca
- **Registration result (verbatim):** `{"agentId":"7225","chainIndex":196,"name":"Launch Copilot","status":"SUCCESS","txHash":"0x1f2e0e8437ff7014d56fca8ebc44b59dd054ca27170d928ba3ba598d8e0316ca"}`
- **Activation / listing (verbatim):** `{"activate":{"approvalStatus":1,"rejectReason":null,"success":false},"submitApproval":[{"approvalStatus":2,"success":true}]}` → per OKX's status table (`activate` + `submitApproval`) = **Submitted for review**
- **Review submission timestamp (UTC):** 2026-07-22T00:56:02Z (registration + activation completed just prior)
- **Review status:** Under review — OKX SLA ~24h; result arrives by email (chimdijos8@gmail.com) + the agent conversation window. Pre-approval, the ASP is already callable via Agent ID #7225.
- **Avatar (CDN):** https://static.okx.com/cdn/web3/wallet/marketplace/headimages/agent/avatar/90d8a758-bbfe-4f4b-84c2-2217e4473a0e.png  (from new_logo.png, 1254×1254)

### Identity description as registered (final, verbatim)

```
Launch your agent on OKX.AI the right way. Review-ready listing copy, a price based on live comps, an X launch thread, and a 90 second demo. Start free, full kit for 1 USDT.
```

### Services as registered (verbatim)

- **Listing Audit** — 0 USDT (A2MCP) — "Paste your draft listing and get a score plus the 3 fixes that matter most, with the copy rewritten for you. Know if you'll pass review before you submit. / Provide: 1. listing name 2. draft description 3. category 4. service type"
- **Launch Kit Generator** — 1 USDT (A2MCP) — "Tell it what your agent does. Get back everything you need to launch. Listing copy, 3 name ideas, a price based on what's actually selling right now, an X thread, and a 90 second demo script. All ready to paste. / Provide: 1. what your agent does 2. category 3. target user 4. service type"
- **Pricing Check** — 0.2 USDT (A2MCP) — "Not sure what to charge? Get a table of what similar agents cost and a recommended price for your category. Takes one line about your service. / Provide: 1. category 2. one-line service description"

### Notes for when the review result arrives

- If **approved**: the listing goes public; nothing further needed to be live.
- If **rejected**: OKX returns a reason by email + conversation window. Fix via `identity-update.md` flow (update #7225), then re-activate. The knowledge layer (rules.json) was the basis for the copy — a rejection tells us exactly what to correct.

## TODO — tomorrow (x402 spike, per BUILD_NOTES.md §6 step 5)

1. `curl -s https://web3.okx.com/api/v6/pay/x402/supported`
2. Resolve the five BUILD_NOTES §3.2 unknowns (facilitator base path, response envelope, `ASSET_ADDRESS`, EIP-712 `extra` domain, auth headers)
3. Replace the zero-address `PAY_TO_ADDRESS` placeholder with the real X Layer receiving address (`npx wrangler secret put PAY_TO_ADDRESS`)
4. One real paid call end to end (Agentic Wallet signs → verify passes → settle returns tx hash in `X-Payment-Response`)
5. Set `FREE_MODE: "false"` in wrangler.jsonc → `npx wrangler deploy`

Do **not** post anything to X until the listing is live.
