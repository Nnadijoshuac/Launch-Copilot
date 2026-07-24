# Launch Copilot — System Design Document

**Version 1.0 — July 21, 2026**
**Target: OKX.AI Genesis Hackathon (Best Product · Creative Genius · Revenue Rocket)**
**Deadline: July 27, 23:59 UTC (verify in official Telegram — older OKX pages say July 17)**

---

## 1. What we are building

Launch Copilot is an Agent Service Provider (ASP) on OKX.AI that helps other ASP builders launch successfully. A builder's agent calls our service and gets back a review-ready listing, a pricing recommendation grounded in live marketplace comps, an X launch thread with #OKXAI, and a 90-second demo script — everything the hackathon and the marketplace require of them.

The one-line pitch: *the agent that launches agents.*

Why this wins: our customers are the other 435+ hackathon participants, all on the platform right now, all facing the same deadline. Demand is guaranteed inside the judging window, which is exactly what the Revenue Rocket track measures. The meta-concept (an agent whose customers are agents) is the Creative Genius angle. Execution quality is the Best Product angle.

## 2. Product decisions (locked)

**Service type: A2MCP, not A2A.** OKX's fit test for A2MCP is "take some parameters, return a clear result" — our tools pass it cleanly. A2MCP settles instantly per call, requires no negotiation, no arbitration exposure, and runs fully automatically once registered. A2A would require staying online to negotiate every job — wrong shape for a 6-day sprint and wrong shape for volume.

**Category: Software Services.** This also makes us eligible for the Software Utility side-pool ($2,500 × 3 winners) on top of the three main tracks.

**Pricing model: free funnel + paid core.** One free tool drives volume, ratings, and discovery; two paid tools drive revenue. Free calls simply return the result (no billing infrastructure needed); paid calls go through x402.

## 3. The service: three MCP tools

The entire product surface is three tools. Fewer tools means simpler review, simpler docs, and less to break.

### Tool 1 — `audit_listing` (FREE)

The funnel. A builder pastes their draft listing; we score it and return the top fixes.

Input schema: `name` (string), `description` (string), `category` (enum: finance / software / lifestyle / art / other), `price_per_call` (number, optional), `service_type` (enum: a2mcp / a2a).

Output: an overall readiness score (0–100), a pass/risk verdict against OKX review expectations, the top 3 concrete fixes ranked by impact, and one comparison to a top performer in their category ("PixelBrief's description leads with the deliverable in the first 8 words — yours takes 40"). Ends with a one-line pointer to the paid launch kit.

Why free: it seeds sold-count and ratings (both publicly visible and likely judge inputs), it is the cheapest possible way for a stranger's agent to trust us, and it advertises the paid tier inside its own output.

### Tool 2 — `generate_launch_kit` (PAID — 1 USDT)

The flagship. Input: what your agent does (free text), category, target user, service type, and optionally a draft name/description.

Output, as one structured markdown document with clearly delimited sections, every one paste-ready:

1. **Listing package** — 3 name options with rationale, an optimized description (hook in the first line, deliverable stated early, structured for agent-readability), and a service list written in OKX's expected register format.
2. **Pricing recommendation** — a specific price with reasoning, benchmarked against the comps snapshot for their category (e.g. "utility APIs in Software Services cluster at 0.01–0.5 USDT; data-rich outputs sustain 0.5–1").
3. **X launch thread** — a 4–6 post thread including #OKXAI, structured hook → problem → demo walkthrough → try-it link, per the hackathon's Step 3 requirements.
4. **90-second demo script** — timed beat sheet (0:00–0:15 hook, 0:15–0:60 walkthrough, 0:60–0:90 call to action), capped at 220 words (~150 wpm speaking pace).

### Tool 3 — `pricing_check` (PAID — 0.2 USDT)

The impulse buy. Input: category + one-line service description. Output: a comps table for that category (top agents, their prices, sold counts from our snapshot), a recommended price point with a one-paragraph rationale, and a note on free-tier strategy. Cheap enough that agents call it on a whim; a natural upsell path to the full kit.

## 4. System architecture

Five components inside one deployable, three external dependencies.

### 4.1 MCP tool layer

A remote MCP server speaking Streamable HTTP over HTTPS, exposing exactly the three tools above with strict JSON schemas. Built with FastMCP (the tooling OKX's own A2MCP guide recommends). Strict schemas matter doubly here because our callers are *agents*, not humans — malformed or ambiguous parameters are the top failure mode, so every parameter gets a description, a type, an example, and server-side validation with helpful error messages an agent can self-correct from.

### 4.2 x402 paywall middleware

Sits in front of the two paid tools. The flow per OKX's Payment API (x402 protocol, HTTP 402 status code):

1. Call arrives without payment → respond `402` with PaymentRequirements (price, asset = USDT, network = X Layer, pay-to address).
2. Caller's Agentic Wallet signs payment and retries with the payment payload header.
3. We verify via the OKX facilitator (`/api/v6/pay/x402/verify`).
4. On success, execute the tool.
5. Settle via the facilitator (`/api/v6/pay/x402/settle`) and return the result.

Design rules: verify **before** doing any LLM work (never burn tokens on unpaid calls); treat verify-passed-but-settle-failed as a served call and log it for reconciliation (settlement on X Layer is gas-subsidized and near-instant; failures should be rare); the free tool bypasses this layer entirely.

This middleware is the highest-risk component. It gets built and tested FIRST, as a hello-world paid endpoint, before any product logic exists.

### 4.3 Generation engine

One LLM call per tool invocation (Claude via API), assembled as: system prompt (role + hard output rules) + knowledge context (relevant slice of the knowledge store) + tool-specific template + user input. No agent loops, no multi-step chains — single-shot with a validator, because latency and cost must stay flat and predictable.

Post-generation validators (pure code, no LLM): output parses into the expected sections; X thread contains #OKXAI; demo script ≤ 220 words; description within listing length norms; no empty sections. On validation failure: one retry with the failure reason appended, then fail gracefully with a partial result rather than an error (an agent caller can use 3 of 4 sections; it cannot use a stack trace).

### 4.4 Knowledge store

Two files, versioned in the repo, loaded into memory at startup. No database.

**`rules.json` (static, hand-curated):** OKX review expectations and process facts (24h review, email + conversation-window notification, usable via Agent ID pre-approval), listing structure norms (name / description / service list / default pricing), A2MCP vs A2A decision guidance, hackathon submission requirements (X post w/ #OKXAI, ≤90s demo, Google form), category taxonomy, x402 basics a builder needs to know.

**`comps.json` (semi-dynamic, refreshed snapshot):** per category — top agents with name, one-line positioning, price, sold count, rating. Seeded manually from okx.ai/agents on day 1 (the marketplace is small enough that manual curation beats scraping), refreshed by hand once daily during the hackathon. A `snapshot_date` field is included, and outputs cite it ("comps as of Jul 22").

Design principle: the knowledge store is the moat and the swappable layer. Everything OKX-specific lives in these two files; the engine and tool layer are platform-agnostic. Post-hackathon pivot to another marketplace = replace two JSON files.

### 4.5 Observability

Structured logs per request: tool, timestamp, latency, payment status, validation status, error class. A tiny `/stats` endpoint (private) totaling calls per tool per day — this is also our Revenue Rocket evidence for the submission form and demo. No user content retained beyond the request lifecycle; we log shapes, not payloads (our customers' product ideas are their own).

### External dependencies

OKX x402 facilitator (verify/settle), LLM API (generation), and the OKX.AI platform itself (registration, discovery, marketplace listing). One deliberate non-dependency: no live scraping of okx.ai in the request path — the comps snapshot is read from memory, so a marketplace UI change can never take us down mid-demo.

## 5. Flows

**Free call:** agent → MCP tool call → validate input → engine (rules + comps context) → validate output → return. Target p95 latency: ≤ 20s.

**Paid call:** agent → 402 with terms → signed retry → facilitator verify → engine → facilitator settle → return result. Target p95: ≤ 35s including payment round-trips.

**Comps refresh (ops, out of request path):** once daily — review okx.ai/agents per category, update comps.json, bump snapshot_date, redeploy (seconds on serverless).

**Our own launch (dogfood):** install Onchain OS skills → log in to Agentic Wallet → register A2MCP ASP → list on OKX.AI → pass review → post on X with #OKXAI using our own generated launch kit → submit Google form. Using Launch Copilot to launch Launch Copilot IS the demo: it proves the product and provides the 90-second story in one move.

## 6. UI design

This product's primary UI is conversational — buyers interact through their own agents, so our "interface" is three things:

**Tool ergonomics.** Tool names are verbs an agent can match to intent (`audit_listing`, not `tool_1`). Every parameter description is written for an agent reader: what to pass, an example, what happens if omitted. Descriptions are the ad copy — they're what a routing agent (or ScoutGate) reads when deciding whether to call us.

**Output format.** Every response is a single markdown document with named sections in fixed order, so both agents and humans can parse it predictably. Every section is paste-ready — no "you could consider…" advisory mush; actual copy the builder ships. The free tool's output ends with exactly one upsell line, never more.

**The listing itself.** Our marketplace listing is the storefront and must be the best listing on the platform — it is literally the product demo. Description leads with the deliverable in the first sentence, names the three tools and prices, and states the meta-hook plainly.

**Secondary surface — one static landing page** (single HTML file, no framework) used in the X post and demo video: what it does, one real sample output (rendered), prices, "Try it on OKX.AI" link. Nothing interactive; it exists for credibility and the demo recording.

## 7. Technology choices — and what we rejected

**Runtime: TypeScript on Cloudflare Workers** (the serverless-edge route OKX's own guide points to). Global HTTPS out of the box, custom domain + TLS in minutes, zero ops, deploys in seconds, generous free tier. Rejected: a VPS (a day of ops we don't have), Python/FastAPI on a server (fine, but Workers removes the whole server category of risk). If FastMCP-python proves dramatically faster to ship during day-1 spike work, we allow ourselves to fall back to Python on Railway/Fly — the architecture is identical.

**MCP: Streamable HTTP transport, official TypeScript SDK or FastMCP.** Verified with MCP Inspector before registration (OKX's own recommended test step).

**Payments: OKX Payment SDK / facilitator HTTP API** (`x402/supported`, `verify`, `settle`). Rejected: hand-rolling x402 signing/verification — the SDK exists precisely to remove that boilerplate, and OKX explicitly recommends it.

**Generation: Claude API, single-shot with validators.** Rejected: agentic multi-step generation (latency, cost, nondeterminism — all wrong for pay-per-call).

**Storage: two JSON files in the repo.** Rejected: any database (nothing here needs one), live scraping (fragile, possibly ToS-hostile, and a request-path dependency on someone else's HTML).

## 8. Stress tests — where this breaks, and what we do about it

**x402 integration fights us (highest technical risk).** Mitigation: it's the day-1 spike — a hello-world paid endpoint before any product code. Fallback ladder: (a) SDK → (b) raw facilitator HTTP API → (c) go live free-only (still listed, still eligible, still competing for Best Product/Creative Genius) and add payments mid-week.

**Review rejection (highest eligibility risk — an unlisted ASP is an invalid submission).** Mitigation: submit for listing by day 3–4 latest, leaving at least two 24-hour review cycles before the deadline. The free tool ships first partly because a clean, obviously-useful free service is the easiest thing to approve. Our own listing is written by our own tool against our own rules.json — if OKX rejects it, our knowledge layer was wrong and we've learned exactly what to fix.

**Deadline ambiguity.** July 17 (OKX pages) vs July 27 (live HackQuest page). Mitigation: confirm in the official Telegram before building; plan assumes July 27 but front-loads so that even a surprise earlier cutoff finds us listed.

**LLM latency/cost blowout.** Envelope math: a launch kit is ~6–8K tokens round trip — cents per call against 1 USDT revenue; margin is safe by an order of magnitude. Latency guarded by capped output lengths and no chains; if p95 drifts past 35s, we split the launch kit into two lighter internal calls run in parallel.

**Free-tool abuse.** Rate limit per caller identity/IP (e.g. 10/day), and the free tool's output is deliberately capped (score + 3 fixes) so bulk-calling it never substitutes for the paid kit.

**Someone clones the idea mid-week.** Speed is the defense: first mover on a marketplace with visible sold-counts compounds (buyers herd toward the listing with 200 sold). Ship, then market daily in the hackathon Telegram and under #OKXAI.

**Comps snapshot goes stale.** Outputs carry the snapshot date; daily manual refresh is a 15-minute chore, and staleness degrades quality gracefully rather than causing failure.

## 9. Build plan (assuming July 27 confirmed)

**Day 1 (today/tomorrow):** Confirm deadline in Telegram. Register on OKX.AI ourselves (Onchain OS → Agentic Wallet) and walk the full ASP registration flow to observe it firsthand — this experience feeds rules.json. Spike: hello-world MCP server on Workers + hello-world x402 paid call verified end to end. Seed comps.json manually.

**Day 2:** Build `audit_listing` end to end (schema → engine prompt → validators → tests via MCP Inspector). Write rules.json properly. Start our own listing copy using our own tool.

**Day 3:** Build `generate_launch_kit` and `pricing_check` behind the paywall. Register the ASP, submit for listing. Build the landing page.

**Day 4:** Review buffer + polish. Record the 90-second demo (script generated by our own tool). Draft the X thread (likewise).

**Day 5:** Post on X with #OKXAI. Submit the Google form (do not wait for the deadline). Begin marketing: hackathon Telegram, replies to other builders' #OKXAI posts offering the free audit.

**Day 6:** Drive volume. Daily comps refresh. Iterate pricing if data suggests. Collect testimonials/ratings.

## 10. Success criteria

Listed and live before July 25. Free tool sold-count in the hundreds by the deadline; double-digit paid calls minimum. Rating ≥ 4.8. X post live with working 90-second demo. Google form submitted with revenue evidence from /stats. And the narrative artifact judges can't ignore: Launch Copilot's own listing, thread, and demo were all produced by Launch Copilot.
