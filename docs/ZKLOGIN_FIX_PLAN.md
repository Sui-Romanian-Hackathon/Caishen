# zkLogin Fix Plan

## Current Issues Identified (2025-12-18)

### Issue 1: Salt Mismatch Between Linking and Signing

**Symptom**: "Connected wallet differs from the sender specified in this link"

**Evidence**:
- Linked wallet address in DB: `0x9b0e4ac373b8eb2835dab7f6cd192d6de4553e6b0f4ed4fb326455ad4f05f8d3`
- Derived zkLogin address in browser: `0x2b0e0c489375d8ecbe180ad1bfa595f5d751b3d343aec4d14acd4b72661873b4`
- `zklogin_salts` table is **empty** - salt was never persisted

**Root Cause**:
The wallet was linked using a salt (possibly from Mysten's salt service or a different value) that was never stored. Now the web-dapp uses `HARDCODED_SALT = '150862062947206198448536405856390800536'` which derives a different address.

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

## Fixes Already Applied

### In `services/web-dapp/src/App.tsx`:

1. **Salt usage in `onSubmitZk`** - Now uses salt from pending tx API with fallback:
   ```typescript
   const rawSaltValue = salt || HARDCODED_SALT;
   const { saltBigInt, saltString: saltValue } = normalizeSalt(rawSaltValue);
   ```

2. **Sender param consumption** - Now sets `senderParam` from API response:
   ```typescript
   if (data.sender) setSenderParam(data.sender);
   ```

3. **Address derivation useEffect** - Now re-derives when salt changes:
   ```typescript
   useEffect(() => { ... }, [jwtToken, salt]);
   ```

---

## Remaining Fixes Needed

### Priority 1: Fix Salt Persistence During Linking

**Goal**: When a user links via zkLogin, store the salt in `zklogin_salts` table.

**Changes Required**:

1. **`LinkPage.tsx`**: Send salt to backend during wallet connection
   ```typescript
   // In connectWallet function, include salt:
   await fetch(`${API_BASE_URL}/api/link/${token}/wallet`, {
     method: 'POST',
     body: JSON.stringify({
       walletAddress: address,
       walletType: 'zklogin',
       zkLoginSalt: HARDCODED_SALT,  // or the salt used
       zkLoginSub: sub
     })
   });
   ```

2. **Backend linking endpoint**: Store salt in `zklogin_salts` table
   ```typescript
   // In routes/linking.ts, after storing wallet_link:
   if (walletType === 'zklogin' && zkLoginSalt && zkLoginSub) {
     await storeSalt({
       telegramId,
       provider: 'google',
       subject: zkLoginSub,
       salt: zkLoginSalt
     });
   }
   ```

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

**Recommendation**: For hackathon, stick with Option A (HARDCODED_SALT) but ensure it's persisted.

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
4. Wallet gets linked with HARDCODED_SALT
5. Address is stored consistently

### Step 3: Verify Fix
1. Create a send transaction from bot
2. Click signing link
3. Sign in with Google (same account)
4. Derived address should match stored address
5. Ephemeral key should be restored
6. Transaction should sign successfully

---

## Testing Checklist

- [ ] Wallet linking stores correct address (derived with HARDCODED_SALT)
- [ ] Salt is persisted in `zklogin_salts` table
- [ ] Pending tx API returns correct `sender` and `salt`
- [ ] Frontend uses salt from API (with HARDCODED_SALT fallback)
- [ ] Ephemeral key survives OAuth redirect
- [ ] Derived address matches stored address
- [ ] Transaction signs and executes successfully

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
| `services/web-dapp/src/LinkPage.tsx` | Wallet linking flow |
| `services/user-service/src/saltDb.ts` | Salt storage functions |
| `src/routes/linking.ts` | Backend linking API |
| `src/routes/pendingTx.ts` | Pending transaction API |
| `src/services/telegram/updateHandler.ts` | Bot command handling |
| `bot/` | Python Telegram bot |
