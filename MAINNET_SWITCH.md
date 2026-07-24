# Mainnet Switch Runbook

**Status: NOT EXECUTED.** Planning document only. Production (`launch-copilot`) is
still running pre-x402 code with `FREE_MODE`, and ASP **#7225** has not been touched.

Execute this top to bottom. Every command is copy-pasteable. Every value you must
eyeball is called out. Stop points are marked **STOP**.

---

## ⚠️ Read this first — three things that are NOT what you'd assume

**1. Production is several deploys behind. A flag flip is NOT enough.**
Verified live on 2026-07-22:

| Probe | Production today | Preview (proven) |
|---|---|---|
| `/health` | `{"free_mode":true}` — the *old* field name | `payments_armed:true`, chain, credentials |
| `GET /mcp` | **405** | **402** challenge |
| `POST` unpaid call to a **paid** tool | **200 + full deliverable** | **402** challenge |
| `tools/list` | **3 tools** | **4 tools** (incl. `preflight_x402`) |

**2. Production is currently in the exact state our own tool flags as the #1
rejection reason.** An unpaid caller gets `200` and the paid deliverable for free.
If an OKX reviewer probes `#7225` right now, that is what they see. This is review
risk that exists *today*, independent of whether you ever take a payment — which is
an argument for deploying the new code promptly rather than waiting on USD₮0.

**3. Production `PAY_TO_ADDRESS` is almost certainly the zero address.**
It was set to `0x0000…0000` as a placeholder during the first deploy; the real
address was only ever set with `--env preview`. Secrets are write-only so this
cannot be read back — **step 2.3 verifies it indirectly via `/health`.** Payments to
`0x000…000` are burned. The new code refuses to serve a challenge in that state
(503, fails safe), so it cannot silently lose funds — but it must be fixed.

---

## 1. PRE-FLIGHT CHECKS

### 1.1 Review verdict on #7225

Check the email registered to the Agentic Wallet (`chimdijos8@gmail.com`) and the
agent conversation window. Also:

```bash
onchainos agent get-agents --agent-ids 7225
```

| Verdict | What it means | Timing |
|---|---|---|
| **Approved / live** | Publicly listed. Real buyers can call it. | Proceed — but note real buyers may hit the endpoint the moment you go live. Do the 0.2 test immediately after deploy. |
| **Pending** | Still in the ≤24h queue. Callable by Agent ID only. | Safe to proceed. Preferred window — you get to be the first real payer. |
| **Rejected** | Fix via the update flow on #7225, re-activate. | Read the reason first. If it cites the payment flow, the redeploy in §3 is likely the fix. Do **not** re-register a new ASP. |

### 1.2 Mainnet USD₮0 balance

```bash
onchainos wallet balance --chain xlayer
```

**Eyeball:** a `tokenAssets[]` entry with `tokenAddress` exactly
`0x779ded0c9e1022225f8e0630b35a9b54be713736`, `decimal: "6"`, and
`balance` ≥ **2** (recommended: 0.2 for the test call, margin for a retry if a
signature expires, and headroom for a second trial).

Minimum workable is 0.2. Below that, stop and acquire more.

### 1.3 Native OKB for gas

```bash
onchainos wallet balance --chain xlayer
```

Look for the native entry (`tokenAddress: ""`). **X Layer is gas-subsidized and
EIP-3009 settlement is broadcast by the facilitator, not by you** — both testnet
runs cost you zero gas. A small non-zero balance is still prudent insurance.
Not a blocker.

### 1.4 Confirm the payout address

The intended value is:

```
0x8b91361f58980992c2eeca0410f21cc9c181ee97
```

This is the wallet that owns #7225. It cannot be read back from Cloudflare, so
**set it unconditionally in §2.3** rather than trying to verify it first.

### 1.5 Confirm production secrets

```bash
cd launch-copilot && npx wrangler secret list
```

**Eyeball — all 7 must be present:**
`LLM_API_KEY`, `LLM_FALLBACK_API_KEY`, `OKX_API_KEY`, `OKX_SECRET_KEY`,
`OKX_PASSPHRASE`, `PAY_TO_ADDRESS`, `STATS_KEY`

(Confirmed present 2026-07-22. Presence ≠ correctness — see the `PAY_TO_ADDRESS`
warning above.)

---

## 2. PRODUCTION CONFIG CHANGES

### 2.1 The one config diff

In `wrangler.jsonc`, top-level `vars` (NOT the `env.preview` block):

```diff
- "X402_MODE": "stubbed",
+ "X402_MODE": "live",
```

`X402_CHAIN` is already `"mainnet"` — **confirm, don't change.**

### 2.2 The code diff — this is the bulk of it

Production must receive a **full redeploy of the current codebase**. Everything
below exists only on preview today:

| Change | Why it matters on mainnet |
|---|---|
| `src/chains.js` *(new)* | Mainnet/testnet profiles; verified USD₮0 address, `eip155:196`, EIP-712 domain `version:"1"` |
| `src/okx-auth.js` *(new)* | HMAC-SHA256 request signing — without it every facilitator call is rejected |
| `src/payments.js` *(rewritten)* | x402 **v2**, `PAYMENT-REQUIRED` header, verify→execute→settle, fails-closed settle, payload projection, distinct 503 causes |
| **Payload projection** | Strips the buyer CLI's stray `resource` field. Without it **every real payment fails** with `30001 invalid params` |
| **UTF-8 base64 fix** | `btoa()` crashes on the em-dash in tool descriptions → HTTP 500 on every 402 |
| **Gate order** (`src/mcp.js`) | Payment gate now runs *before* input validation, per OKX review expectations |
| **GET → 402** | A bare GET returned 405; reviewers probing with GET saw a dead endpoint |
| **x402 REST path** | Discovery *and* payment on the shape the buyer CLI actually sends; without it `payment quote` reports "no payment required" |
| `paymentConfigError` | Refuses to advertise a price with an empty/zero `payTo` |
| `preflight_x402` *(new tool)* | 4th tool, free |
| `/health` diagnostics | `payments_armed`, chain, credential presence, `config_error` |
| `extra.version` `"2"`→`"1"` | Matches the on-chain `DOMAIN_SEPARATOR` on both chains |

### 2.3 Set the real payout address

**Do this before deploying.** Run in your own terminal and paste the address at
the prompt:

```bash
cd launch-copilot && npx wrangler secret put PAY_TO_ADDRESS
```

Enter exactly:

```
0x8b91361f58980992c2eeca0410f21cc9c181ee97
```

---

## 3. THE DEPLOY

```bash
cd launch-copilot && npx wrangler deploy
```

No `--env` flag — that targets production. Takes ~10–15s.

**Expected warning (harmless):** a note about Preview URLs being enabled.

### 3.1 Confirm the deploy

```bash
curl -s https://launch-copilot.joshua-ai.workers.dev/health
```

**Eyeball every field:**

```json
{
  "x402_mode": "live",
  "chain": { "key": "mainnet", "network": "eip155:196",
             "asset": "0x779ded0c9e1022225f8e0630b35a9b54be713736",
             "asset_verified": true },
  "credentials": { "okx": true, "pay_to": true, "llm": true },
  "config_error": null,
  "payments_armed": true
}
```

**STOP if:**
- `config_error` is non-null → read it; a zero/invalid `payTo` says so explicitly. Fix §2.3, redeploy.
- `payments_armed` is `false` → mode isn't live, or credentials are missing.
- The response still contains `free_mode` → the deploy didn't land. Re-run.

### 3.2 Confirm the review-critical fix landed

```bash
curl -s -o /dev/null -w "GET  %{http_code}\n" https://launch-copilot.joshua-ai.workers.dev/mcp
curl -s https://launch-copilot.joshua-ai.workers.dev/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -o '"name":"[a-z_]*"'
```

**Expect:** `GET 402` (was 405), and **4** tool names including `preflight_x402`.

---

## 4. FIRST LIVE UNPAID PROBE — no signing

```bash
curl -s "https://launch-copilot.joshua-ai.workers.dev/mcp?tool=pricing_check&category=finance&service_description=structured%20crypto%20derivatives%20data%20API" | python -m json.tool
```

**Eyeball `accepts[0]` — all four must match exactly:**

| Field | Required value |
|---|---|
| `asset` | `0x779ded0c9e1022225f8e0630b35a9b54be713736` |
| `network` | `eip155:196` |
| `payTo` | `0x8b91361f58980992c2eeca0410f21cc9c181ee97` |
| `amount` | `200000` |

Also confirm `x402Version: 2` and `extra: {"name":"USD₮0","version":"1"}`.

**STOP if `payTo` is `0x0000…0000`** — the config guard should have caught it as a
503, so if you see it inside a 402 something is wrong. Do not proceed.

Optionally, run our own checker against ourselves:

```bash
curl -s "https://launch-copilot.joshua-ai.workers.dev/mcp?tool=preflight_x402&endpoint=https%3A%2F%2Flaunch-copilot.joshua-ai.workers.dev%2Fmcp&expected_fee_usdt=0.2"
```

Expect `workers.dev` to remain "could not verify" (unchanged, acceptable) and the
payment-flow checks to pass.

---

## 5. THE MAINNET PAYMENT — 💰 REAL MONEY, YOUR KEYSTROKES ONLY

> **This spends real USD₮0 on X Layer mainnet.** I will not run these commands.
> Run them yourself, back to back — **the signature is valid for 120 seconds.**

```bash
onchainos payment quote "https://launch-copilot.joshua-ai.workers.dev/mcp?tool=pricing_check&category=finance&service_description=structured%20crypto%20derivatives%20data%20API"
```

Then — **only after §6 passes** — using the `paymentId` returned:

```bash
onchainos payment pay --payment-id <paymentId> --selected-index 0 --yes
```

**What you are signing:** an EIP-3009 `transferWithAuthorization` for **0.2 USD₮0**
from `0x8b91…ee97` to `0x8b91…ee97`. An off-chain signature, not a transaction —
the facilitator broadcasts and pays gas.

---

## 6. QUOTE EYEBALL CHECKLIST — before you type `pay`

From the quote's `merchantBody` / `decodedChallenge`:

- [ ] `payTo` / `recipient` == `0x8b91361f58980992c2eeca0410f21cc9c181ee97`
- [ ] `asset` == `0x779ded0c9e1022225f8e0630b35a9b54be713736`
- [ ] `network` == `eip155:196`
- [ ] `amount` == `200000` (`amountHuman` `0.2`)

Also sanity-check `summary` reads *"Will pay 0.2 USD₮0"* and `chainName` is
**X Layer** (not Testnet).

> **If ANY value differs — STOP. Do not sign.** A wrong `payTo` sends real funds
> somewhere unrecoverable. There is no undo.

---

## 7. EXPECTED SUCCESS

```json
{"ok":true,"data":{"status":"success",
  "txHash":"0x…","scheme":"exact","paymentId":"pay_…",
  "result": "<the pricing_check markdown report>"}}
```

Server-side (via `npx wrangler tail`) you should see, in order:

```
rest_call            status=payment_required reason=no_payment
payment_payload_keys_dropped  dropped=["resource"] phase=verify
verify_ok            {"code":0,...,"isValid":true,"payer":"0x8b91…ee97"}
llm                  provider=primary
payment_payload_keys_dropped  dropped=["resource"] phase=settle
settle_raw           {"code":0,...,"success":true,"transaction":"0x…"}
rest_call            status=ok payment=paid
```

**Independent verification:**

```
https://www.oklink.com/xlayer/tx/<txHash>
```

Expect status **"Success"** / accepted. Note the explorer will show `from` as the
**facilitator** and `to` as the **USD₮0 contract** — that is correct for EIP-3009;
the token-level transfer is inside the logs.

`status:"pending"` in the settle envelope alongside `success:true` is **expected
and accepted** — see the documented decision in `src/payments.js`.

---

## 8. FAILURE INTERPRETATIONS

All of these fail **closed**: nothing is charged and no deliverable is released.

### `cause: "facilitator_error"`
`/verify` or `/settle` returned an error envelope. Read `facilitator_detail`.

| Detail contains | Meaning | Do |
|---|---|---|
| `code=30001 invalid params` | **Two causes, same code.** (a) Signature expired — >120s between quote and pay. (b) A payload-shape problem. | Retry once, fast. If it repeats immediately, it's shape — stop and capture the payload. **Do not** change the projection whitelist speculatively. |
| `code=-1 unknown error` | Facilitator-side fault | Retry once. If persistent, mainnet facilitator issue — roll back (§10) and report. |
| `insufficient_balance` | Wallet lacks USD₮0 | Top up. Nothing was charged. |
| `invalid_signature` (as `isValid:false`, a **402** not 503) | Buyer-side signature rejected | If it recurs on mainnet only, suspect the EIP-712 domain for the mainnet contract. Do **not** edit `chains.js` mid-incident — roll back first. |

### `cause: "facilitator_unreachable"`
Network failure reaching OKX. Retry. If persistent, roll back — do not touch
credentials or code.

### `cause: "missing_credentials"`
Live mode without OKX creds. Should be impossible after §1.5/§3.1, but if it
appears: re-run the three `wrangler secret put OKX_*` commands and redeploy.

### `payment_configuration_incomplete`
`payTo` or asset invalid. Fix §2.3 and redeploy. Never seen in a real run because
§3.1 catches it.

### CLI `walletError: "balance_unavailable"`
On **testnet** this appeared on every quote (chain 1952 unsupported by the balance
service) and payments still succeeded. **On mainnet (196) it should not appear.**
If it does, it's cosmetic — proceed only if §6 values are correct.

### Something not listed
Capture: the full CLI output, `npx wrangler tail` for the same minute, and the
`/health` response. **Then stop.** Do not iterate on production with real money at
stake — reproduce on preview/testnet first.

---

## 9. POST-SUCCESS VERIFICATION

```bash
onchainos wallet balance --chain xlayer
onchainos wallet history --chain xlayer
```

### The self-transfer caveat — read before expecting a debit

`payTo` is **your own wallet**, so this test moves 0.2 USD₮0 from you to you.
**Your balance will not visibly decrease.** In history the entry will show
`coinAmount 0.000000`, `from == to == 0x8b91…ee97`, `txStatus SUCCESS` — exactly as
both testnet runs did. **The tx hash on OKLink is the proof**, not the balance.

### Decision point: should mainnet use a different `payTo`?

**Recommendation: keep the self-transfer.** Rationale:

- It mirrors the two proven testnet runs exactly — one variable changes (the chain), not two.
- The flow is already proven end to end twice; what mainnet adds is *contract*
  validation, which the tx hash demonstrates regardless of direction.
- A second address means changing `PAY_TO_ADDRESS`, which is the single most
  dangerous value in the system, immediately before a real payment — and then
  changing it *back* afterwards, since `payTo` must be your wallet for real buyers.
  Two extra mutations of the field most likely to lose funds, for cosmetic proof.

Choose a second address **only** if you specifically want to see a debit land, and
if so, change it back before any real buyer arrives.

---

## 10. ROLLBACK

**Fastest safe revert — flag flip, keeps all the fixes:**

```diff
- "X402_MODE": "live",
+ "X402_MODE": "stubbed",
```

```bash
cd launch-copilot && npx wrangler deploy
```

Payments then return `503 payment_verification_unavailable` — no charges, no
re-402 loop, and the 402 challenge (the review-critical part) stays correct.
**Time to revert: ~15s deploy + a few seconds propagation.**

**Do NOT use `wrangler rollback`** to a pre-today version. That would restore the
code that returns `200` with a free deliverable on unpaid calls — the #1 rejection
reason. A version rollback is strictly worse than the flag flip.

Emergency full stop (only if the endpoint is actively harmful):

```bash
npx wrangler deployments list      # inspect
```
Prefer the flag flip. Deleting or disabling the worker breaks #7225's registered
endpoint and risks the listing.

---

## 11. AFTER A CLEAN MAINNET PAYMENT — do not front-run the review

Nothing is automated. In order:

1. **Confirm #7225's review verdict is approved and the listing is live.**
   Do not post publicly before this. A rejected listing plus a public launch
   thread is a worse position than silence.
2. **Then** post the X thread — copy is in `LAUNCH_ASSETS.md` (regenerate it first;
   it was produced before `preflight_x402` existed and doesn't mention the tool,
   which is now the strongest thing we have). Must include **#OKXAI** and a demo
   ≤90 seconds.
3. **Then** submit the Google form with the ASP details, the X post link, and
   revenue evidence from `/stats?key=<STATS_KEY>`.
4. Daily during the hackathon: refresh `src/knowledge/comps.json`, bump
   `snapshot_date`, redeploy. Watch `npx wrangler tail` for
   `settle_failed_reconcile` / `settle_pending_reconcile`.

**Deadline: 2026-07-27 23:59 UTC.**

---

## Appendix — current state at time of writing (2026-07-22)

| | Production | Preview |
|---|---|---|
| Worker | `launch-copilot` | `launch-copilot-testnet` |
| URL | launch-copilot.joshua-ai.workers.dev | launch-copilot-testnet.joshua-ai.workers.dev |
| Code | **pre-x402 (stale)** | current, proven |
| `X402_MODE` | `stubbed` (unused by stale code) | `live` |
| `X402_CHAIN` | `mainnet` | `testnet` |
| KV / stats | bound | none (test traffic can't pollute evidence) |
| Payments proven | ❌ never | ✅ twice (`0xbe808fdd…c9e7`, `0x3454b63d…c94b`) |

Preview is missing `LLM_FALLBACK_API_KEY` and `STATS_KEY` — intentional and
harmless there; production has both.
