# Launch Copilot — Complete Build Record, Analysis & Compromise Log

*(Everything below is written so you can hand it to another engineer or agent cold — it is the full state of the project, why every decision was made, and where the bodies are buried.)*

> Status note (2026-07-22): the §3.5 provider flip has since been **applied** (Groq is now primary, NVIDIA fallback) and the §3.4 resilience deviation was **approved as implemented**. The text below is the original record, kept verbatim.

---

## 1. Mission and constraints

Build **Launch Copilot**, an A2MCP Agent Service Provider for the OKX.AI Genesis Hackathon (deadline **2026-07-27 23:59 UTC**), from a locked design (`DESIGN.md`) and build instructions (`CLAUDE.md`). The product: a remote MCP server whose customers are *other agents*, exposing exactly three tools — `audit_listing` (free funnel), `generate_launch_kit` (1 USDT), `pricing_check` (0.2 USDT) — with paid tools behind an x402 paywall settling USDT on X Layer via the OKX facilitator.

Hard constraints honored throughout:
- **Zero runtime dependencies.** One plain-JS fetch handler on Cloudflare Workers. `wrangler` is the only dependency, and it's dev-only. No SDKs, no frameworks — every LLM and facilitator interaction is raw `fetch`.
- **Verify payment before any LLM spend.** The paywall gates generation, never the reverse.
- **Agents are the callers.** Every error is machine-correctable (structured text + example args), never a stack trace.
- **One markdown document out, fixed section order, paste-ready** — enforced by pure-code validators, not by trust in the model.
- **Do not re-architect** during the provider swap (phase 2) — surgical changes only.

---

## 2. What was built, file by file

```
launch-copilot/
├── wrangler.jsonc          Worker config: vars (FREE_MODE, LLM_*, x402 config), KV binding stub
├── package.json            private, type:module, scripts dev/deploy/tail, devDep wrangler@^4.113
├── .dev.vars(.example)     local secrets template (gitignored real file)
├── README.md               run/deploy/x402-verification/ops/registration runbook
├── LAUNCH_ASSETS.md        ← dogfood output: Launch Copilot's own launch kit, made by itself
└── src/
    ├── index.js            router: POST /mcp, GET /, GET /stats, GET /health, 404+CORS
    ├── mcp.js              JSON-RPC 2.0 over Streamable HTTP, stateless; the request pipeline
    ├── tools.js            the product: 3 tool defs (schema+examples), prompts, input validation
    ├── engine.js           OpenAI-compatible chat-completions client + resilience ladder
    ├── validators.js       pure-code output validators (sections, #OKXAI, word caps, score lines)
    ├── payments.js         x402: 402+PaymentRequirements → verify → execute → settle
    ├── stats.js            shape-only logs, KV counters, /stats endpoint, free-tool rate limit
    ├── landing.js          single static HTML landing page (no external assets)
    └── knowledge/
        ├── rules.json      curated OKX platform/hackathon knowledge (provided in handoff)
        └── comps.json      marketplace comps snapshot, 2026-07-21 (provided in handoff)
```

### The request pipeline (mcp.js) — order is load-bearing

For `tools/call`: **(1) input validation** (free, pure code — malformed input is never charged) → **(2) rate limit** (free tool only, per-IP daily via KV) → **(3) payment** (skip if free tool or FREE_MODE; else `X-PAYMENT` header → facilitator `/verify`) → **(4) generation** (single-shot LLM + validator retry) → **(5) settle** (only after success; settle failure = served call, logged `settle_failed_reconcile`). Every step emits a structured JSON log line — shapes only, never user payloads (the customers' product ideas are their own).

### The generation engine (engine.js) — two independent retry ladders

- **Provider ladder** (per LLM call): primary → on 429/5xx/30s-timeout wait 2s, retry primary once → fallback provider once → throw. Providers configured entirely by env: `LLM_BASE_URL/_API_KEY/_MODEL` and `LLM_FALLBACK_*`. `temperature: 0.7`, `max_tokens` 3500 (audit/pricing) / 4500 (kit). `finish_reason: "length"` is mapped to the internal `max_tokens` stop reason so truncation is treated as a validation failure.
- **Validator ladder** (per tool call, model-agnostic): generate → run pure-code validators → on failure, exactly one regeneration with the literal failure list appended → on second failure, return whichever attempt failed *fewer* checks, with a visible warning note appended. An agent can use 3 of 4 good sections; it cannot use an exception.

### The output contract (tools.js + validators.js)

Each tool carries a `sections` array that is the *same list* the validators check, injected into the system prompt as a hard contract: *"Output ONLY the following markdown sections, in this exact order, each starting with '## <name>' … No prose, titles, or headings before the first '##' line."* Validators check: all sections present (prefix-tolerant heading match) and non-trivially non-empty; `Score: NN/100` line (audit); `#OKXAI` present in the thread and demo ≤ 220 words (kit); `Recommended: N USDT per call` line and snapshot-date citation (pricing).

---

## 3. Compromises — the honest ledger

These are the places where the shipped thing deviates from the ideal, the spec, or certainty. Each entry: what was compromised, why, and the exposure.

### 3.1 Payments are implemented but **not live-verified** → FREE_MODE ships ON
The single biggest compromise. The x402 flow is fully coded (402 + `accepts`, base64 `X-PAYMENT` decode, verify-before-LLM, settle-after-success, `X-Payment-Response` header, reconciliation logging) and the 402/rejection shapes are locally tested — but the OKX facilitator round-trip has **never been exercised against the real API**, because that requires the owner's OKX account, Agentic Wallet, and a real signed payment. Per the design's own fallback ladder, `FREE_MODE="true"` is the default with the reason documented in `wrangler.jsonc`. **Exposure:** until flipped, paid tools are free; revenue = 0; Revenue Rocket evidence only accrues call counts.

### 3.2 Facilitator details are educated guesses wrapped in tolerant code
Five specific unknowns, all isolated in `payments.js` / `wrangler.jsonc` and all marked TODO:
- **Endpoint base** `https://web3.okx.com/api/v6/pay/x402` — from CLAUDE.md's doc pointers, not verified.
- **Response envelope** — OKX APIs often wrap as `{code,msg,data}`; the parser accepts `isValid`/`valid`/`is_valid` both bare and wrapped rather than betting on one shape.
- **`ASSET_ADDRESS`** — set to the commonly cited USDT-on-X-Layer contract, **must** be checked against `/supported`.
- **EIP-712 `extra` domain** `{name:"USDT",version:"1"}` — a guess; wrong values make signatures unverifiable.
- **Auth** — if the facilitator wants OKX API-key headers, there's a marked insertion point but no implementation.
**Exposure:** flipping FREE_MODE off without the README's 5-step verification checklist will produce failed verifies, not revenue. The compromise was deliberate: build the *shape* now, bind the *facts* during the live spike.

### 3.3 Provider swap traded model quality for cost/control — absorbed via contract tightening
Phase 1 used Claude Opus 4.8 (raw fetch). Phase 2 replaced it, per instruction, with Llama-3.3-70B behind OpenAI-compatible endpoints. A 70B instruct model follows format instructions less reliably than a frontier model, so three compensations were made:
- The **hard output contract** (§2) was added — the validator section list verbatim in the system prompt.
- The **H1 title lines were removed** from all three prompt templates. This is a real, visible output change (documents now start at `## …`): the contract demands "no prose before the first section," the old templates demanded an H1, and the validators never checked H1s. Alignment beat aesthetics.
- `max_tokens` for the kit was **cut 7000 → 4500** (per spec) — fine for 70B's terser output, but it caps kit length; if a future model writes richer kits, truncation → validator failure → retry burn.
**Exposure:** output is noticeably more generic than the Opus version would produce (see §5 quality note). Mitigated but not eliminated by the contract.

### 3.4 One deliberate deviation from the resilience spec *(approved 2026-07-22)*
Spec: retry primary on 429/5xx/timeout, then fallback. Implemented, plus: a **non-retryable** primary error (400/401/403) skips the pointless 2s+retry and goes **straight to fallback** if configured. Rationale: a revoked primary key at 2 AM shouldn't take the service down when a working fallback key exists, and retrying a 401 can never succeed. Flagged in code comments and disclosed at delivery; approved as implemented on 2026-07-22.

### 3.5 The NVIDIA primary is functionally dead weight *right now* — left in place by instruction *(since resolved: providers flipped 2026-07-22)*
Empirical finding from live testing: every NVIDIA call hit the 30s timeout (a direct probe confirmed 30.2s for a 5-token completion — server-side queueing, valid key), while Groq served every real output in 2.4–3.2s. Result: **every production call paid ~62s of failover tax** (30s + 2s + 30s) before the 3s answer — p95 ≈ 65s against the design's ≤20s target. Defaults were initially left as specified. **Resolution:** primary/fallback were swapped in `wrangler.jsonc` on 2026-07-22 (Groq primary, NVIDIA fallback); post-flip sanity check showed 2.4s end-to-end.

### 3.6 Stats and rate limiting are "good enough," not correct
- KV counters use read-modify-write — **non-atomic**; concurrent isolates can drop increments. Fine for magnitude-level Revenue Rocket evidence, wrong for accounting.
- Rate limiting is **per-IP per-day and fails open** (no KV binding, or KV error → allow). Trivially bypassable by IP rotation; acceptable because the free tool's output is deliberately capped (score + 3 fixes) so bulk-calling never substitutes for the paid kit — the design's real abuse defense.
- `/stats` does a KV `list` + N parallel `get`s — O(days×tools×statuses), fine at hackathon scale, not beyond.
- The KV namespace id started as a **placeholder**; local dev simulates it, production silently disables stats/rate-limit until the namespace is created. Code tolerates absence everywhere.

### 3.7 MCP surface is deliberately minimal
Stateless; JSON responses only (no SSE stream leg of Streamable HTTP); no sessions issued; no server-initiated messages; JSON-RPC batching rejected (removed in the 2025-06-18 spec anyway); GET/DELETE on `/mcp` → 405. This is spec-conformant for a stateless server and passed a full curl protocol suite (initialize / tools/list / notification→202 / unknown-tool→-32602 / malformed-JSON→-32700), but a client that *demands* SSE or sessions would notice. MCP Inspector against the deployed URL remains the required acceptance test (also OKX's own recommended step).

### 3.8 Validators are heuristics, not proofs
- Heading match is **prefix-tolerant** (`## Comps (as of 2026-07-21)` matches "Comps") — needed for model freedom, means a mangled suffix passes.
- "Non-empty" = >15 chars — a stub like "See above for details." passes.
- Demo word count splits on whitespace, so **timestamps and markdown tokens count as words** — strictness cuts in our favor (limit 220, prompt asks ≤200, actual outputs 48–52).
- The kit's `###` subsections (Name Options / Description / Service List) are **not individually validated** — only their parent `## Listing Package`. The contract text carries that weight.

### 3.9 Miscellaneous smaller trades
- **Prompt caching skipped**: the system prompt (~2K tokens incl. both JSON knowledge files serialized whole) is small; OpenAI-compatible endpoints handle caching opaquely; both knowledge files are small enough that "include everything" beat category-slicing complexity.
- **Landing page CTA** points at a generic OKX AI URL — the real listing URL doesn't exist until registration completes.
- **No test framework** — the harness is curl + a throwaway Node script that re-runs the repo validators against live output. Right-sized for a 6-day sprint, but there's no CI safety net for the daily comps-refresh redeploys.
- **`.dev.vars` holds real keys** locally — gitignored, never committed, never echoed (presence checks only).

---

## 4. What is verified vs. assumed

| Area | Status |
|---|---|
| MCP protocol (init, list, call, notifications, errors, CORS) | ✅ Verified live via curl suite |
| Input validation → agent-correctable errors | ✅ Verified live |
| 402 + PaymentRequirements shape, malformed-payment rejection | ✅ Verified live (FREE_MODE=false locally) |
| Graceful failure with no/dead LLM key ("you have not been charged") | ✅ Verified live |
| Real generation + validators, both test tools | ✅ Verified live — **0 issues, first attempt, both calls** |
| Provider failover ladder | ✅ Verified live — by accident of NVIDIA's queueing, the fallback path got a full production-grade test |
| Shape-only logging incl. per-call provider | ✅ Verified in dev logs |
| Stats counters + auth (404 wrong key / 200 right key) | ✅ Verified live |
| Dogfood kit in `LAUNCH_ASSETS.md` | ✅ Exists, validator-clean, #OKXAI×2, demo 52 words |
| OKX facilitator verify/settle round-trip | ❌ Assumed — needs owner's wallet (§3.2) |
| Asset address / network id / EIP-712 domain | ❌ Assumed — check `/supported` |
| Deployed behavior on Cloudflare + MCP Inspector | ❌ Not yet (in progress) |
| OKX registration & review | ❌ Not started — needs owner's email/wallet |

---

## 5. Quality note on the dogfood output

`LAUNCH_ASSETS.md` is validator-clean and structurally perfect, but stylistically it is recognizably 70B-grade: the X thread hooks are serviceable rather than sharp, and the description doesn't lead with the deliverable in the first 8 words quite as aggressively as our own `audit_listing` would demand. Ironic and fixable: run the saved kit *through our own free `audit_listing`* and apply its fixes before posting — the most on-brand possible edit pass. Alternatively, one regeneration once a stronger model is configured (it's one env var).

## 6. Exact remaining path to "live"

1. ~~Swap primary/fallback provider vars in `wrangler.jsonc` (§3.5).~~ **Done 2026-07-22.**
2. `npx wrangler login` → `secret put LLM_API_KEY` (Groq) → `secret put LLM_FALLBACK_API_KEY` (NVIDIA) → `secret put PAY_TO_ADDRESS` → `secret put STATS_KEY` → `npx wrangler deploy`; `kv namespace create STATS` + paste id + redeploy.
3. MCP Inspector against `https://launch-copilot.joshua-ai.workers.dev/mcp` *(live URL — deployed 2026-07-22, workers.dev subdomain "joshua-ai"; base name "joshua" was globally taken)*.
4. OKX registration (README steps: Onchain OS skills → Agentic Wallet login → register A2MCP ASP at the `/mcp` URL → list). 24h review SLA; callable via Agent ID pre-approval.
5. x402 live spike: `curl …/supported`, correct the §3.2 unknowns, one real paid call, then `FREE_MODE:"false"` + redeploy.
6. Daily: comps refresh (edit `comps.json`, bump `snapshot_date`, redeploy), `wrangler tail` for reconciliation events, post the thread from `LAUNCH_ASSETS.md` with #OKXAI.

## 7. Mainnet flip completed (2026-07-23)

The build is done. Production is `X402_MODE=live` on X Layer mainnet (`eip155:196`, USD₮0 `0x779ded…3736`), deploy `56d6b519`. The `FREE_MODE` flag referenced above was replaced during the spike by `X402_MODE: "stubbed" | "live"` — paid tools are never free in either mode; stubbed emits a real 402 and 503s a payment header, live runs the full verify→execute→settle path. A **fourth tool, `preflight_x402`** (free) shipped and is public — the x402 rejection-preflight checker, our standout differentiator. One real mainnet payment settled: tx `0x447d3e90…945c`, OKX chain API `SUCCESS` (see `REGISTRATION.md` → Mainnet payment path proven), preceded by two testnet settlements. All the taxonomy from §3–§6 was validated against the live facilitator, and the constants (`eip155:196`, USD₮0, EIP-712 domain `version:"1"` matched on-chain via `DOMAIN_SEPARATOR()`) are verified, not assumed.

**Log-capture gap, recorded honestly:** the internal `/verify` and `/settle` envelope bytes for the mainnet payment were **not captured** — no `wrangler tail` was running on the deploy side when the payment ran from a separate terminal, and `tail` has no replay (Workers observability logs aren't CLI-queryable). The mainnet envelope shapes are therefore *inferred* from the two captured testnet runs plus the on-chain SUCCESS, not directly observed. This is acceptable — the chain record is authoritative and stronger than our self-reported logs — but it means the field-by-field internal confirmation exists only for testnet. **Future paid calls should have a tail open on the deploy side** so mainnet envelopes are captured directly.
