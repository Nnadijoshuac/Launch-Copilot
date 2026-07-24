// Settlement chain profiles. Switching networks is ONE config change:
// set `X402_CHAIN` to "mainnet" or "testnet" (wrangler.jsonc vars, or
// .dev.vars for local runs). Nothing else moves.

export const CHAINS = {
  // ---- PRODUCTION TARGET (fully verified 2026-07-22) -------------------
  mainnet: {
    key: "mainnet",
    network: "eip155:196", // confirmed by authenticated GET /api/v6/pay/x402/supported
    chainIndex: 196,
    cliChain: "xlayer", // for `onchainos --chain`
    asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    assetSymbol: "USDT",
    assetName: "USD₮0", // confirmed via `onchainos token search --chain xlayer --query USDT`
    decimals: 6,
    assetVerified: true,
    // EIP-712 domain for transferWithAuthorization — VERIFIED 2026-07-22 by
    // computing candidate domain separators and matching the on-chain value.
    // The contract implements neither eip712Domain() nor version() (both
    // revert), so DOMAIN_SEPARATOR() is the only source of truth:
    //   on-chain DOMAIN_SEPARATOR() = 0xd591d9baf744328d9400b923cb02c9474d367d591ca1ab24d8c4068be527599d
    //   keccak domain(name="USD₮0", version="1") = 0xd591d9ba…599d  ← MATCH
    //   keccak domain(name="USD₮0", version="2") = 0x27ce12e6…a27d  ← no match
    // Note name() and symbol() both return "USD₮0" (not "USDT").
    // "2" was previously advertised here; it is wrong, even though OKX's buyer
    // CLI derives the domain from the contract and therefore tolerated it.
    // Do not "restore" 2 — the payments skill's "version optional, defaults 2"
    // note does not match these contracts.
    extra: { name: "USD₮0", version: "1" },
    explorer: "https://web3.okx.com/explorer/x-layer",
  },

  // ---- TEST TARGET (network verified; asset NOT yet known) -------------
  testnet: {
    key: "testnet",
    // Confirmed advertised by /supported, and by `onchainos wallet chains`
    // (chainIndex 1952, chainName "xlayer_test").
    network: "eip155:1952",
    chainIndex: 1952,
    cliChain: "xlayer_test",

    // Confirmed 2026-07-22 from a funded wallet:
    //   onchainos wallet balance --chain xlayer_test
    //   → {"symbol":"USD₮0","tokenName":"USD₮0","decimal":"6",
    //      "tokenAddress":"0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
    //      "balance":"10","rawBalance":"10000000"}
    // USD₮0 chosen over USDG/USDC_TEST because mainnet settles in the token
    // whose registry name is also "USD₮0" — closest possible rehearsal.
    // Other testnet tokens available if needed:
    //   USDG       0xa78e2baabaf5c4f36b7fc394725deb68d332eec1 (6dp)
    //   USDC_TEST  0xcb8bf24c6ce16ad21d707c9505421a17f2bec79d (6dp)
    asset: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
    assetSymbol: "USD₮0",
    assetName: "USD₮0",
    decimals: 6, // confirmed: rawBalance 10000000 == balance 10
    assetVerified: true,
    // EIP-712 domain — VERIFIED 2026-07-22 the same way as mainnet:
    //   on-chain DOMAIN_SEPARATOR() = 0xd2406dc8a5f31c1f65263669534de22dea0363db6ca41e1094e98442907ff982
    //   keccak domain(name="USD₮0", version="1") = 0xd2406dc8…f982  ← MATCH
    //   keccak domain(name="USD₮0", version="2") = 0x95db42eb…cf4a  ← no match
    // Kept in lockstep with mainnet on purpose: this profile is the rehearsal
    // environment, and a knowingly-wrong value here would stop it mirroring
    // production. (The first successful testnet payment ran with "2" because
    // the buyer CLI derives the domain from the contract, not from this field.)
    extra: { name: "USD₮0", version: "1" },
    // Verified 2026-07-22: web3.okx.com/explorer/x-layer-test 404s.
    // OKLink is the working X Layer testnet explorer.
    explorer: "https://www.oklink.com/xlayer-test",
  },
};

/** The chain the payment path should use, plus any env override. */
export function activeChain(env) {
  const key = String(env?.X402_CHAIN ?? "mainnet").toLowerCase();
  const base = CHAINS[key] ?? CHAINS.mainnet;
  const asset = env?.X402_ASSET_OVERRIDE || base.asset;
  return { ...base, asset, assetVerified: base.assetVerified && !env?.X402_ASSET_OVERRIDE };
}

/**
 * Returns a human-readable reason the chain is unusable, or null if it is fine.
 * Used to fail loudly instead of emitting a 402 with an empty `asset` — a
 * malformed challenge is worse than an honest error.
 */
export function chainConfigError(chain) {
  if (!chain.asset) {
    return (
      `No settlement asset configured for X402_CHAIN="${chain.key}" (${chain.network}). ` +
      `Claim tokens at https://web3.okx.com/xlayer/faucet, run ` +
      `\`onchainos wallet balance --chain ${chain.cliChain}\` to read the token's contract ` +
      `address, then set X402_ASSET_OVERRIDE to it.`
    );
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(chain.asset)) {
    return `Settlement asset "${chain.asset}" is not a valid 20-byte address.`;
  }
  return null;
}
