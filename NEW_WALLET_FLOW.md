# Deterministic New-Wallet Flow (zkLogin + Sui SDK + use-sui-zklogin)

Purpose: document the “No, I need a new wallet” path shown in the onboarding UI (see `AI_Copilot_Wallet_Product_Specification_with_zklogin_microservices.md` and checkpoints in `IMPLEMENTATION_STATUS.md`). The flow creates a zkLogin wallet deterministically from OAuth identity + salt using the Sui SDK and the `use-sui-zklogin` hook (https://github.com/pixelbrawlgames/use-sui-zklogin), then links it back to the Telegram user.

## Scope and Guarantees
- Non-custodial: no seed phrases handled by the bot; signing happens with zkLogin proofs or external wallets.
- Deterministic address: `zkAddress = jwtToAddress(idToken, userSalt)`; same provider + salt => same address every session.
- Secure linking: Telegram Login Widget HMAC + server-side linking token (`/api/link/:token`) with 15-min TTL.
- Minimal infra: use Mysten hosted salt/prover APIs (per spec) unless a custom salt service is provided.

## Components
- Telegram bot (`/bot`): issues secure linking tokens, stores wallet metadata (provider, sub, salt, address, maxEpoch), confirms via Telegram Login Widget (`/api/link/:token/telegram-verify`).
- Web dApp (`/services/web-dapp`): React/Vite UI for wallet creation; uses `use-sui-zklogin` to run zkLogin.
- Sui SDK (`@mysten/sui`): `SuiClient` for epoch/state queries, `jwtToAddress`, `getZkLoginSignature`, transaction building.
- use-sui-zklogin library: provides `beginZkLogin`, `useZkLogin`/`completeZkLogin`, manages ephemeral keys, nonce, proof assembly.
- Mysten APIs: `salt.api.mystenlabs.com` (or custom) for salt; `prover-dev.mystenlabs.com` (testnet) for proof; mainnet prover when promoted.

## End-to-End Flow
1) User taps “No, I need a new wallet” in Telegram  
   - Bot creates linking session (`/api/link/:token`) with Telegram user id, TTL 15m, and returns `https://caishen.iseethereaper.com/link/<handle>?token=XYZ`.

2) Web dApp loads LinkPage with the token  
   - Shows wallet choice UI (per spec). For new wallet, render provider buttons (Google first; Facebook/Apple/Twitch planned).
   - Prepares Sui client: `const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });`

3) Initialize zkLogin hook with deterministic salt  
```ts
const providersConfig = { google: { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', clientId: GOOGLE_CLIENT_ID } };
const { isLoaded, address, accounts } = useZkLogin({
  urlZkProver: 'https://prover-dev.mystenlabs.com/v1', // swap to prod on mainnet
  generateSalt: async () => {
    // Prefer server-issued salt bound to Telegram user for determinism
    const res = await fetch(`/api/link/${token}/salt`, { method: 'POST' });
    const { salt } = await res.json();
    return { salt };
  },
});
```
- If backend unreachable, fall back to Mysten salt API; on success, POST salt back to `/api/link/:token/salt` to persist (per Implementation Status note about Postgres persistence and local-session fallback).

4) Begin OAuth + nonce setup  
```ts
const handleZkLogin = async () => {
  await beginZkLogin({ suiClient, provider: 'google', providersConfig, maxEpoch: await suiClient.getLatestSuiSystemState().then(s => Number(s.epoch) + 10) });
};
```
- `beginZkLogin` (from `use-sui-zklogin`) generates ephemeral keypair, nonce, and redirects to provider with nonce embedded (matches spec step “OAuth URL construction”).

5) Complete zkLogin after redirect  
- `useZkLogin` runs `completeZkLogin`: decodes JWT, uses the stored salt, derives deterministic address, requests proof from prover, caches account data (address, sub, aud, maxEpoch, ephemeral private key) in browser storage.
- Guard maxEpoch against chain state using `suiClient.getLatestSuiSystemState` on load; if expired, force re-login.

6) Link wallet to Telegram session  
```ts
useEffect(() => {
  if (!address) return;
  const account = accounts?.[0];
  fetch(`/api/link/${token}/wallet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletType: 'zklogin',
      provider: account?.provider ?? 'google',
      address,
      sub: account?.sub,
      aud: account?.aud,
      salt: account?.userSalt,
      maxEpoch: account?.maxEpoch,
    }),
  }).then(() => fetch(`/api/link/${token}/complete`, { method: 'POST' }));
}, [address, accounts, token]);
```
- Server stores address + salt + provider + sub + aud for deterministic regeneration; replies to bot so it can DM confirmation.

7) Telegram identity verification  
- Web dApp renders Telegram Login Widget; upon success, calls `/api/link/:token/telegram-verify` (HMAC check + Telegram id match). Bot edits the original message to confirm linkage.

8) Post-creation UX  
- Show zkLogin address, “Copy”, “Open in explorer”, and “Top up with faucet” (testnet).
- Provide “Back to Telegram” deep link. Offer retry/reset buttons for failures (per Implementation Status linking UI resets).

## Determinism Rules
- Salt is the anchor. Always reuse the same salt for the same Telegram user + provider; store it server-side and return via `/api/link/:token/salt`.
- Address formula: `jwtToAddress(idToken, userSalt)`; issuer (`iss`) and audience (`aud`) must match the configured provider/clientId.
- Ephemeral keys are session-scoped (maxEpoch) and not stored server-side; loss only requires a fresh login, not a new address.
- If user switches provider or salt, a new address is expected; warn the user before changing salt/provider.

## UI States (Create-New-Wallet path)
- Default: buttons “Yes, I have a wallet” / “No, I need a new wallet”.
- New wallet screen: provider buttons (Google primary), info text “No seed phrase needed”.
- Loading: disable buttons while `beginZkLogin` in flight; show spinner while awaiting `useZkLogin`.
- Success: show derived Sui address + confirmation CTA to Telegram.
- Error: show friendly copy for OAuth failure, prover failure, salt fetch failure; include “Try again” and “Start over” (resets linking token).

## Data Stored
- Server (Postgres/SQLite): linking token, telegram_id, walletType=zklogin, provider, sub, aud, userSalt, zkAddress, maxEpoch, created_at/ttl.
- Client (browser sessionStorage/localStorage via `use-sui-zklogin`): ephemeral private key, proof payload, maxEpoch; clear on sign-out or expiry.

## Resilience and Security Notes
- Keep linking tokens one-time and 15m TTL; consume on `/complete`.
- Enforce Telegram HMAC verification before marking link complete.
- Rate-limit salt/prover calls; cache proofs until maxEpoch to avoid re-proving.
- Validate `maxEpoch` on each dApp load; if `currentEpoch > maxEpoch`, trigger re-login.
- All signing remains client-side; bot only stores public data needed for deterministic regeneration.

## Next Steps / Hooks into the rest of the system
- After linking, the bot should prompt `/balance` and offer faucet (testnet checkpoint in Implementation Status).
- Transactions built by the bot should set `txb.setSender(zkLoginAddress)` and use `getZkLoginSignature` with the cached proof/ephemeral signature from the dApp.
- Extend provider list using the same pattern by expanding `providersConfig` and UI buttons; keep salt reuse per provider.
