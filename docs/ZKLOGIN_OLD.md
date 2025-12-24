# Current zkLogin Implementation (with exact code locations)

File + line references are 1-based from the current repo.

## Key files
- Web dApp (create + send flows): `services/web-dapp/src/App.tsx`
- Web linking page: `services/web-dapp/src/LinkPage.tsx`
- Telegram bot orchestrator: `src/services/telegram/updateHandler.ts`
- Linking API: `src/routes/linking.ts`
- Salt API + storage: `services/user-service/src/index.ts`, `services/user-service/src/saltDb.ts`
- zklogin-service stub: `services/zklogin-service/src/index.ts`
- zkLogin client helper: `src/services/clients/zkloginService.ts`

## Constants
- Hardcoded salt used everywhere in web flows: `services/web-dapp/src/App.tsx:42`; `services/web-dapp/src/LinkPage.tsx:23`.

## Wallet creation flow (`/create-wallet`)
- OAuth kickoff + nonce/session storage: `App.tsx:153-193` (`startZkLogin`).
- Callback + hardcoded salt + address derivation: `App.tsx:204-241` (`handleZkLoginCallback`, `jwtToAddress` with `HARDCODED_SALT`).
- Address shown to user (no proof, no backend write): `App.tsx:236-241`.

## zkLogin send flow (`/send-funds`)
- Pending tx fetch (deep link from bot): `App.tsx:560-620`.
- OAuth setup + nonce persistence: `App.tsx:652-713` (`startGoogleOAuth`).
- Restore ephemeral key/randomness after OAuth: `App.tsx:674-715`.
- Derive zk address with hardcoded salt: `App.tsx:843-873`.
- Build unsigned tx (sender = zk addr): `App.tsx:897-903`.
- Ephemeral signature over tx bytes: `App.tsx:904-910`.
- Proof request to Mysten hosted prover: `App.tsx:915-939`.
- zkLogin signature assembly: `App.tsx:940-966`.
- Execute transaction with zkLogin signature: `App.tsx:968-982`.

## Linking page zkLogin flow (`/link`)
- Linking token/session load: `LinkPage.tsx:31-190`.
- OAuth kickoff for zkLogin: `LinkPage.tsx:242-288`.
- Callback: hardcoded salt + address derivation (`jwtToAddress`): `LinkPage.tsx:291-320`.
- Connect wallet to linking session (POST `/api/link/:token/wallet` with salt/sub): `LinkPage.tsx:315-322`; backend handler `src/routes/linking.ts:62-116`.
- Telegram verification completion: `LinkPage.tsx:329-413`; backend `src/routes/linking.ts:121-191`.

## Salt handling
- Salt API endpoint: `services/user-service/src/index.ts:96-115` (`POST /api/v1/zklogin/salt`).
- Salt fetch/store logic (Mysten salt service fallback): `services/user-service/src/saltDb.ts:80-152`; lookup `getSalt` at `158-166`.
- Bot salt fetch (currently without subject/JWT, so returns null): `src/services/telegram/updateHandler.ts:277-304`; client wrapper `src/services/clients/zkloginService.ts:21-53`.
- Web dApp: does **not** call salt API; always uses `HARDCODED_SALT`.

## Other
- zklogin-service stub (no real prover/salt): `services/zklogin-service/src/index.ts:1-26`.
