// OKX API request signing (HMAC-SHA256 via Web Crypto — zero dependencies).
//
// Per OKX's spec, every authenticated call carries four headers:
//   OK-ACCESS-KEY         the API key
//   OK-ACCESS-SIGN        base64( HMAC-SHA256( secret, prehash ) )
//   OK-ACCESS-TIMESTAMP   ISO 8601 UTC, millisecond precision
//   OK-ACCESS-PASSPHRASE  the passphrase chosen when the key was created
//
// prehash = timestamp + METHOD + requestPath + body
//   • METHOD is uppercase ("GET" / "POST")
//   • requestPath is the path INCLUDING any query string, e.g.
//     "/api/v6/pay/x402/supported" — never the full URL
//   • body is the exact JSON string sent (empty string for GET)
//
// This module deliberately imports nothing, so it can be exercised from a
// plain Node script as well as from the Worker.

const enc = new TextEncoder();

/** base64 of raw bytes (btoa is Latin1-only, so go via a byte string). */
function b64(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Sign one request. Returns { timestamp, sign, prehash }.
 * `prehash` is returned for debugging only — never log it with a real secret
 * in scope, and never send it anywhere.
 */
export async function signRequest(secretKey, method, requestPath, body = "") {
  // toISOString() is exactly ISO 8601 UTC with milliseconds: 2026-07-22T01:23:45.678Z
  const timestamp = new Date().toISOString();
  const prehash = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(prehash));
  return { timestamp, sign: b64(signature), prehash };
}

/** True when all three OKX credentials are present. */
export function hasOkxCredentials(env) {
  return Boolean(env?.OKX_API_KEY && env?.OKX_SECRET_KEY && env?.OKX_PASSPHRASE);
}

/**
 * Authenticated fetch against an OKX endpoint.
 * `url` must be absolute; the signature is computed over its path + query.
 * Returns { status, data, raw, ok, authed }.
 */
export async function okxRequest(env, url, { method = "GET", body } = {}) {
  const u = new URL(url);
  const requestPath = u.pathname + u.search;
  const bodyString = body === undefined || body === null ? "" : typeof body === "string" ? body : JSON.stringify(body);

  const headers = { "Content-Type": "application/json" };
  let authed = false;

  if (hasOkxCredentials(env)) {
    const { timestamp, sign } = await signRequest(env.OKX_SECRET_KEY, method, requestPath, bodyString);
    headers["OK-ACCESS-KEY"] = env.OKX_API_KEY;
    headers["OK-ACCESS-SIGN"] = sign;
    headers["OK-ACCESS-TIMESTAMP"] = timestamp;
    headers["OK-ACCESS-PASSPHRASE"] = env.OKX_PASSPHRASE;
    authed = true;
  }

  const res = await fetch(u.toString(), {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : bodyString,
  });
  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    /* keep raw for logging */
  }
  return { status: res.status, data, raw, ok: res.ok, authed };
}
