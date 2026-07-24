// Editable config for the x402 pre-flight checker.
// Sourced from the OKX reviewer-rejection taxonomy. Keep this file as the ONLY
// place constants live so it can be updated without touching the engine.
//
// VERIFICATION STATUS (2026-07-22) — now confirmed against live OKX APIs:
//   • network eip155:196 + scheme "exact" + x402Version 2 — confirmed by an
//     authenticated GET /api/v6/pay/x402/supported (HTTP 200).
//   • asset 0x779ded…3736 — confirmed via `onchainos token search --chain
//     xlayer --query USDT`: symbol USDT, name "USD₮0", 6 decimals, ~220k
//     holders, ~$21.9B liquidity. Note /supported does NOT advertise token
//     addresses, so this came from OKX's token registry instead.
export const ASSET_LIST_VERIFIED = true;

// --- Check 2: hosts OKX's buyer security plugin (SC_CDN_DEPLOY_TOOL) blocks ---
// A reviewer literally cannot call an endpoint on these hosts.
export const BLOCKED_HOST_PATTERNS = [
  { pattern: /(^|\.)vercel\.app$/i, label: "vercel.app" },
  { pattern: /(^|\.)onrender\.com$/i, label: "onrender.com" },
  { pattern: /(^|\.)trycloudflare\.com$/i, label: "trycloudflare.com" },
  { pattern: /(^|\.)up\.railway\.app$/i, label: "up.railway.app" },
  { pattern: /(^|\.)railway\.app$/i, label: "railway.app" },
  { pattern: /(^|\.)fly\.dev$/i, label: "fly.dev" },
  { pattern: /(^|\.)run\.app$/i, label: "run.app" },
  { pattern: /(^|\.)sslip\.io$/i, label: "sslip.io" },
  { pattern: /(^|\.)nip\.io$/i, label: "nip.io" },
  { pattern: /(^|\.)ngrok(-free)?\.(io|app|dev)$/i, label: "ngrok" },
  { pattern: /(^|\.)loca\.lt$/i, label: "loca.lt" },
  { pattern: /(^|\.)serveo\.net$/i, label: "serveo.net" },
  { pattern: /(^|\.)herokuapp\.com$/i, label: "herokuapp.com" },
  { pattern: /(^|\.)glitch\.me$/i, label: "glitch.me" },
  { pattern: /(^|\.)repl\.co$/i, label: "repl.co" },
  { pattern: /(^|\.)netlify\.app$/i, label: "netlify.app" },
];

// Hosts we have NOT confirmed either way. Reported as "could not verify",
// never as a pass — a false green here would be worse than a warning.
export const UNVERIFIED_HOST_PATTERNS = [
  {
    pattern: /(^|\.)workers\.dev$/i,
    label: "workers.dev",
    note:
      "Cloudflare Workers' own subdomain. It is not a known ephemeral tunnel or preview host like vercel.app or trycloudflare.com, and we have not seen it on the published blocklist — but we could not confirm the reviewer's plugin ignores it. A custom domain removes all doubt.",
  },
  {
    pattern: /(^|\.)pages\.dev$/i,
    label: "pages.dev",
    note: "Cloudflare Pages subdomain — same uncertainty as workers.dev.",
  },
];

// Non-public hosts a reviewer can never reach.
export const UNREACHABLE_HOST_PATTERNS = [
  { pattern: /^localhost$/i, label: "localhost" },
  { pattern: /^127\./, label: "127.0.0.0/8 loopback" },
  { pattern: /^0\.0\.0\.0$/, label: "0.0.0.0" },
  { pattern: /^10\./, label: "10.0.0.0/8 private" },
  { pattern: /^192\.168\./, label: "192.168.0.0/16 private" },
  { pattern: /^172\.(1[6-9]|2\d|3[01])\./, label: "172.16.0.0/12 private" },
  { pattern: /\.local$/i, label: ".local" },
  { pattern: /\.internal$/i, label: ".internal" },
];

// --- Checks 5 & 6: settlement rails the reviewer's task system supports ---
export const EXPECTED_CHAIN_ID = 196; // X Layer
export const EXPECTED_NETWORKS = ["eip155:196"]; // CAIP-2, confirmed by the OKX payments skill
// Aliases some servers emit instead of CAIP-2. Accepted with a warning, not a pass.
export const NETWORK_ALIASES = ["xlayer", "x-layer", "okxchain", "196"];

export const ACCEPTED_ASSETS = [
  // "USD₮0" — the dominant USDT on X Layer (~$21.9B liquidity, ~220k holders).
  { address: "0x779ded0c9e1022225f8e0630b35a9b54be713736", symbol: "USDT", decimals: 6 },
];
// Assets seen in real rejections — named so the report can be specific.
export const KNOWN_WRONG_ASSETS = [
  {
    address: "0x1e4a5963abfd975d8c9021ce480b42188849d41d",
    note:
      'this is "XLAYER_USDT" (Tether USD bridged), a different and far smaller token than the USDT the marketplace settles on — ~$1.5M liquidity vs ~$21.9B for USD₮0',
  },
  { address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", note: "native-token sentinel, not an ERC-20" },
];
export const USDG_SYMBOLS = ["USDG"];

// --- Check 10 ---
export const EXPECTED_X402_VERSION = 2;

// --- Check 1 ---
export const PROBE_TIMEOUT_MS = 15_000;
export const REVIEWER_MAX_SECONDS = 300;
export const SLOW_RESPONSE_WARN_MS = 20_000;

// --- Check 7 ---
export const USDT_DECIMALS = 6;
