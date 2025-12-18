# zkLogin Fix Plan

## Current Issues Identified (2025-12-18)

### Issue 1: Salt Mismatch Between Linking and Signing

**Symptom**: "Connected wallet differs from the sender specified in this link"

**Evidence**:
- Linked wallet address in DB: `0x9b0e4ac373b8eb2835dab7f6cd192d6de4553e6b0f4ed4fb326455ad4f05f8d3`
- Derived zkLogin address in browser: `0x2b0e0c489375d8ecbe180ad1bfa595f5d751b3d343aec4d14acd4b72661873b4`
- `zklogin_salts` table is **empty** - salt was never persisted

**Root Cause**:
The wallet was linked using a salt (possibly from Mysten's salt service or a different value) that was never stored. The web-dapp previously used a hardcoded salt (`150862062947206198448536405856390800536`), producing a different address. Salt is now derived and persisted server-side.

**Affected Files**:
- `services/web-dapp/src/LinkPage.tsx` - wallet linking flow
- `services/web-dapp/src/App.tsx` - transaction signing flow
- `services/user-service/src/saltDb.ts` - salt storage (not being called during linking)
- `bot/` - Python bot creates pending tx with `session.walletAddress`

---

### Issue 2: Ephemeral Key Not Found

**Symptom**: "Ephemeral key not found. Please sign in with Google again to get a fresh token."

**Root Cause**:
The ephemeral keypair is stored in `sessionStorage` before OAuth redirect, but not being restored properly after callback. Possible causes:
1. `sessionStorage` key mismatch between store and restore
2. OAuth redirect URL differs from callback URL (different origin/path)
3. Race condition: JWT extracted before sessionStorage restore useEffect runs
4. User navigated away or refreshed before callback completed

**Affected Code** (`App.tsx`):
- Line 675-686: Stores ephemeral key before OAuth redirect
- Line 704-742: Restores ephemeral key after OAuth callback
- Line 881-887: Checks for ephemeral key before signing

---

### Issue 3: Salt Not Persisted During Linking

**Symptom**: `zklogin_salts` table is empty despite successful wallet linking

**Root Cause**:
The `LinkPage.tsx` derives the zkLogin address and sends it to the backend, but:
1. The salt used for derivation is not sent to the backend
2. The backend's `getOrCreateSalt` is not called during the linking flow
3. No salt is stored, making future signing impossible with the correct salt

---

### Issue 4: Pending TX Salt vs Frontend Salt

**Symptom**: Backend stores one salt in pending tx, frontend ignores it

**Details**:
- Backend (`updateHandler.ts:278-302`): Calls `getOrCreateSalt()` and stores result in pending tx
- Frontend (`App.tsx:852`): Was ignoring `data.salt` and always using `HARDCODED_SALT`
- **Partial fix applied**: Frontend now uses `salt` from pending tx API when available

---

### Infra Issue: Split Databases Causing Missing Data

**Symptom**: wallet_links and zklogin_salts end up empty or mismatched between services.

**Root Cause**: docker-compose defined two separate Postgres containers (`postgres` for the bot and `zklogin-db` for transaction-builder) with different volumes, so data was isolated.

**Fix**: Consolidate all services on the single `postgres` service/volume. `zklogin-transaction-builder` now points to `postgres:5432` and the extra `zklogin-db` service/volume has been removed (also mirrored in `docker-compose.zklogin.yml`).

---

## Fixes Already Applied

### In `services/web-dapp/src/App.tsx`:

1. **Salt usage in `onSubmitZk`** - Now requires backend-provided salt (pending tx API or direct salt service) with no hardcoded fallback:
   ```typescript
   const { saltBigInt, saltString: saltValue } = normalizeSalt(salt);
   ```

2. **Sender param consumption** - Now sets `senderParam` from API response:
   ```typescript
   if (data.sender) setSenderParam(data.sender);
   ```

3. **Address derivation useEffect** - Now re-derives when salt changes (no default salt):
   ```typescript
   useEffect(() => { ... }, [jwtToken, salt]);
   ```

### New fixes in this iteration

- **Infra:** docker-compose now uses a single Postgres service; `zklogin-transaction-builder` points to `postgres:5432` and the duplicate `zklogin-db` container/volume was removed (also mirrored in `docker-compose.zklogin.yml`).
- **Linking flow:** `/api/link/:token/zklogin-salt` proxies to transaction-builder `/api/v1/zklogin/salt` (JWT-verified, derived via `ZKLOGIN_MASTER_SECRET`, encrypted with `ZKLOGIN_ENCRYPTION_KEY`) and returns salt + derived address; link persists `zkLoginSalt/zkLoginSub` without any hardcoded fallback.
- **Frontend:** zkLogin callback (link/create/send) fetches salt from backend salt service (`VITE_ZKLOGIN_SALT_SERVICE_URL`) once JWT is present; no HARDCODED_SALT usage. Pending-tx API now returns `telegramId` to provide tenant context to the salt service.
- **Ephemeral key restore:** zkLogin send flow now restores `zklogin_eph` session data even before JWT is present, logs the state, and only clears storage after a successful restore to reduce "Ephemeral key not found" errors.

### Fixes Applied 2025-12-18 (Session 2)

#### Issue: zklogin-transaction-builder crashing with `Cannot read properties of undefined (reading 'searchParams')`

**Root Cause:** The `DATABASE_URL` environment variable was either:
1. Not set (falling back to default with wrong password `copilot_secret`)
2. Or if set with the actual password `pH0DuWF7KzJ4P/4xaAN6XOlsa9SV4epMfwwVh/hQ6gs=`, the `/` and `=` characters break URL parsing in `pg-connection-string`

**Fix Applied:**
- `docker-compose.yml:113-118` - Changed from `DATABASE_URL` to individual `POSTGRES_*` variables:
  ```yaml
  - POSTGRES_HOST=postgres
  - POSTGRES_PORT=5432
  - POSTGRES_USER=${POSTGRES_USER:-caishen}
  - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-copilot_secret}
  - POSTGRES_DB=${POSTGRES_DB:-caishen_wallet}
  ```
- `docker-compose.zklogin.yml:30-35` - Same fix applied

The `db.ts` in transaction-builder already handles `POSTGRES_*` variables by URL-encoding the password when constructing the connection string internally.

#### Issue: `Failed to fetch salt from backend: 404: Not Found`

**Root Cause:** The Python bot (`bot/src/bot/bot.py`) was missing the `/api/link/{token}/zklogin-salt` endpoint that the web-dapp (`services/web-dapp/src/LinkPage.tsx:313`) calls.

**Fix Applied:**
1. `bot/src/core/config.py:57` - Added `TX_SERVICE_URL` setting:
   ```python
   TX_SERVICE_URL: str = Field(default="http://zklogin-transaction-builder:3003")
   ```

2. `bot/src/bot/bot.py:245-298` - Added `handle_zklogin_salt` endpoint that:
   - Validates the link token exists
   - Extracts JWT from request body
   - Proxies to transaction-builder `/api/v1/zklogin/salt`
   - Returns salt + derived address to web-dapp

3. `bot/src/bot/bot.py:304` - Registered the route:
   ```python
   app.router.add_post("/api/link/{token}/zklogin-salt", handle_zklogin_salt)
   ```

4. `docker-compose.yml:65,75-76` - Added `TX_SERVICE_URL` env var and dependency:
   ```yaml
   - TX_SERVICE_URL=http://zklogin-transaction-builder:3003
   ...
   depends_on:
     zklogin-transaction-builder:
       condition: service_started
   ```

**Flow After Fix:**
1. Web-dapp calls `POST /api/link/{token}/zklogin-salt` with `{ jwt }`
2. Python bot validates token, proxies to transaction-builder with `telegramId`
3. Transaction-builder derives salt from JWT using `ZKLOGIN_MASTER_SECRET`
4. Transaction-builder saves salt to `zklogin_salts` table (encrypted)
5. Returns `{ salt, provider, subject, derivedAddress, keyClaimName }` to web-dapp
6. Web-dapp uses returned salt + address for wallet linking

#### Issue: `zklogin_salts` table not created

**Root Cause:** The Python bot's `_create_tables()` didn't create the `zklogin_salts` table, and the database init script only runs on first container creation.

**Fix Applied:**
1. `bot/src/database/postgres.py:111-138` - Added `zklogin_salts` table creation
2. `services/transaction-builder/src/db.ts:8-63` - Added schema creation including `users` and `zklogin_salts` tables

Both services now create the required tables on startup if they don't exist.

---

## Remaining Fixes Needed

### Priority 1: Fix Salt Persistence During Linking

**Goal**: When a user links via zkLogin, store the salt in `zklogin_salts` table.

**Status**: Implemented. `LinkPage.tsx` calls `/api/link/:token/zklogin-salt`, which proxies to transaction-builder `/api/v1/zklogin/salt` (JWT-verified, HMAC-derived, encrypted storage). The backend caches `zkLoginSalt/zkLoginSub/derivedAddress` on the session and persists during wallet connect. No hardcoded salt is used.

### Priority 2: Fix Ephemeral Key Restoration

**Goal**: Ensure ephemeral key survives OAuth redirect/callback cycle.

**Investigation Needed**:
1. Add logging to verify sessionStorage contents before/after OAuth
2. Check if OAuth redirect URL matches the callback URL exactly
3. Verify the useEffect dependency and execution order

**Potential Fix**:
```typescript
// Store with more robust key
const STORAGE_KEY = 'caishen_zklogin_ephemeral';

// Before OAuth redirect
sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
  secretKey: Array.from(eph.getSecretKey()),
  maxEpoch: maxEp,
  randomness: rand.toString(),
  timestamp: Date.now()  // For debugging
}));

// After callback - add immediate logging
useEffect(() => {
  const stored = sessionStorage.getItem(STORAGE_KEY);
  console.log('[zkLogin] Checking storage on mount:', {
    hasJwt: !!jwtToken,
    hasStored: !!stored,
    storedKeys: stored ? Object.keys(JSON.parse(stored)) : []
  });
  // ... rest of restoration logic
}, [jwtToken]);
```

### Priority 3: Unify Salt Strategy

**Goal**: Single source of truth for salt management.

**Options**:

**Option A: Always use HARDCODED_SALT (Simplest for hackathon)**
- Pro: Deterministic, same address for same Google account
- Con: All users share same salt (less secure)
- Implementation: Already done in frontend, just need to persist it

**Option B: Per-user salt from Mysten service**
- Pro: Secure, unique per user
- Con: Requires storing salt, more complex flow
- Implementation:
  1. During linking: Fetch salt from Mysten, store in DB
  2. During signing: Retrieve salt from DB
  3. Pending tx: Include salt from DB

**Option C: Derived salt from master secret (Current backend approach)**
- Pro: Deterministic without external service
- Con: Different from what frontend might use
- Implementation: Ensure frontend fetches salt from backend API

**Recommendation**: Use server-derived deterministic salt (transaction-builder `/api/v1/zklogin/salt`), no hardcoded fallback. Store encrypted salt in `zklogin_salts` with master secret + encryption key.

---

## Immediate Action Items

### Step 1: Clear Bad Data
```sql
-- Delete wallet link with wrong address
DELETE FROM wallet_links WHERE telegram_id = '1123891263';
```

### Step 2: Re-link Wallet
1. User runs `/start` in Telegram bot
2. Clicks link to web-dapp
3. Signs in with Google
4. Backend derives salt via `/api/link/:token/zklogin-salt` → transaction-builder `/api/v1/zklogin/salt` (verified JWT, master secret, encrypted storage)
5. Wallet address is stored consistently with derived salt (no hardcoded fallback)

### Step 3: Verify Fix
1. Create a send transaction from bot
2. Click signing link
3. Sign in with Google (same account)
4. Derived address should match stored address
5. Ephemeral key should be restored
6. Transaction should sign successfully

---

## Testing Checklist

- [ ] zklogin-transaction-builder starts without database errors
- [ ] Python bot starts and depends on transaction-builder
- [ ] `/api/link/{token}/zklogin-salt` returns salt from transaction-builder
- [ ] Wallet linking stores correct address (derived with backend salt)
- [ ] Salt is persisted in `zklogin_salts` table
- [ ] Pending tx API returns correct `sender`, `salt`, and `telegramId`
- [ ] Frontend uses salt from backend API (no hardcoded fallback)
- [ ] Ephemeral key survives OAuth redirect
- [ ] Derived address matches stored address
- [ ] Transaction signs and executes successfully

## Deployment Commands

```bash
# Restart all containers with rebuild
docker-compose down
docker-compose up -d --build

# Check logs for transaction-builder
docker-compose logs -f zklogin-transaction-builder

# Check logs for bot
docker-compose logs -f telegram-bot

# Verify transaction-builder health
curl http://localhost:3003/health
```

---

## Database Schema Reference

```sql
-- zklogin_salts table
CREATE TABLE zklogin_salts (
  telegram_id TEXT,
  provider TEXT,
  subject TEXT,
  salt TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (provider, subject)
);

-- wallet_links table
CREATE TABLE wallet_links (
  id UUID PRIMARY KEY,
  telegram_id TEXT,
  address TEXT,
  label TEXT,
  linked_via TEXT,
  created_at TIMESTAMP
);
```

---

## Related Files

| File | Purpose |
|------|---------|
| `services/web-dapp/src/App.tsx` | Send funds page, zkLogin signing |
| `services/web-dapp/src/LinkPage.tsx` | Wallet linking flow, calls `/api/link/{token}/zklogin-salt` |
| `services/transaction-builder/src/db.ts` | Database connection (uses POSTGRES_* vars) |
| `services/transaction-builder/src/zklogin/salt.service.ts` | Salt derivation from JWT + master secret |
| `bot/src/bot/bot.py` | Python bot API endpoints including zklogin-salt proxy |
| `bot/src/core/config.py` | Bot configuration including TX_SERVICE_URL |
| `docker-compose.yml` | Container orchestration, env vars, dependencies |
| `docker-compose.zklogin.yml` | zkLogin-specific compose file |
