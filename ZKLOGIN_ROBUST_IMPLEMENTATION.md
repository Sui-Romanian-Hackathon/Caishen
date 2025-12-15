# zkLogin Robust Implementation PRD

> **Document Type**: Agentic Coding Agent PRD + Implementation Prompt  
> **Version**: 1.0.0  
> **Last Updated**: 2025-12-15  
> **Target Service**: `services/transaction-builder` (salt + proof backend)

---

## 🎯 Mission Statement

Transform Caishen's zkLogin from "hardcoded salt hackathon mode" to a **production-grade identity-to-wallet binding system** where:

1. Salt is **never hardcoded** on the frontend
2. JWT tokens are **verified server-side** before salt is returned
3. Proof generation is **proxied through our own endpoint**
4. OAuth flows enforce **nonce/state validation**
5. Address derivation is **verified against linked wallets**

---

## 📋 Agent Instructions

### Execution Model

```
┌─────────────────────────────────────────────────────────────┐
│                    RECURSIVE TESTING LOOP                   │
├─────────────────────────────────────────────────────────────┤
│  1. READ spec & success criteria                            │
│  2. WRITE tests FIRST (Red phase)                           │
│  3. RUN tests → expect failures                             │
│  4. IMPLEMENT minimal code to pass (Green phase)            │
│  5. RUN tests → expect pass                                 │
│  6. REFACTOR if needed                                      │
│  7. GIT COMMIT with conventional commit message             │
│  8. RE-RUN all previous tests (regression check)            │
│  9. LOOP to next feature                                    │
└─────────────────────────────────────────────────────────────┘
```

### Git Workflow

```bash
# After each significant feature implementation:
git add -A
git commit -m "feat(zklogin): <description>"

# After test suite additions:
git commit -m "test(zklogin): <description>"

# After bug fixes:
git commit -m "fix(zklogin): <description>"
```

### Agent Notes Section

> **🤖 AGENT: Leave notes here during implementation for future reference**

```markdown
<!-- AGENT_NOTES_START -->
Implementation Date: _______________
Current Phase: _______________
Blockers Encountered: 
  - 
  - 
Decisions Made:
  - 
  - 
Next Steps:
  - 
  - 
Test Coverage Status:
  - Unit: ____%
  - Integration: ____%
Regression Issues Found:
  - 
  - 
<!-- AGENT_NOTES_END -->
```

---

## 🏗️ Architecture Overview

### Current State (BROKEN)

```
┌─────────────────┐      ┌─────────────────┐
│   Web dApp      │      │  Mysten Prover  │
│ (App.tsx)       │──────│  (direct call)  │
│                 │      └─────────────────┘
│ HARDCODED_SALT  │
│ = '150862...'   │      ┌─────────────────┐
│                 │      │  Salt Service   │
│ No JWT verify   │──────│  (unused)       │
└─────────────────┘      └─────────────────┘
```

### Target State (ROBUST)

```
┌─────────────────┐      ┌──────────────────────────────────────┐
│   Web dApp      │      │      transaction-builder service     │
│ (App.tsx)       │      │  ┌────────────────────────────────┐  │
│                 │      │  │   POST /api/v1/zklogin/salt    │  │
│ Calls backend   │─────▶│  │   - JWT signature verify       │  │
│ for salt        │      │  │   - iss/aud/exp/iat check      │  │
│                 │      │  │   - Return deterministic salt  │  │
│ Calls backend   │      │  └────────────────────────────────┘  │
│ for proof       │      │  ┌────────────────────────────────┐  │
│                 │─────▶│  │   POST /api/v1/zklogin/proof   │  │
│ Validates       │      │  │   - Rate limiting              │  │
│ nonce + state   │      │  │   - Timeout handling           │  │
│                 │      │  │   - Proxy to Mysten prover     │  │
└─────────────────┘      │  └────────────────────────────────┘  │
                         │  ┌────────────────────────────────┐  │
                         │  │   JWT Validator Module         │  │
                         │  │   - JWKS fetching + caching    │  │
                         │  │   - Signature verification     │  │
                         │  │   - Claims validation          │  │
                         │  └────────────────────────────────┘  │
                         │  ┌────────────────────────────────┐  │
                         │  │   Salt Manager Module          │  │
                         │  │   - Deterministic derivation   │  │
                         │  │   - Encrypted storage          │  │
                         │  │   - Master secret management   │  │
                         │  └────────────────────────────────┘  │
                         └──────────────────────────────────────┘
```

---

## ✅ Success Criteria (VERIFY BEFORE MARKING DONE)

### Phase 1: Salt Service Correctness

| ID | Criterion | Test File | Test Name | Status |
|----|-----------|-----------|-----------|--------|
| SC-1.1 | Salt endpoint REJECTS requests without JWT | `salt.service.test.ts` | `should reject request without JWT` | ⬜ |
| SC-1.2 | Salt endpoint REJECTS invalid/expired JWT | `salt.service.test.ts` | `should reject invalid JWT signature` | ⬜ |
| SC-1.3 | Salt endpoint REJECTS JWT with wrong iss | `salt.service.test.ts` | `should reject wrong issuer` | ⬜ |
| SC-1.4 | Salt endpoint REJECTS JWT with wrong aud | `salt.service.test.ts` | `should reject wrong audience` | ⬜ |
| SC-1.5 | Salt endpoint RETURNS consistent salt for same identity | `salt.service.test.ts` | `should return same salt for same identity` | ⬜ |
| SC-1.6 | Salt is derived from (iss + aud + sub) deterministically | `salt.service.test.ts` | `should derive salt deterministically` | ⬜ |
| SC-1.7 | Different identities get different salts | `salt.service.test.ts` | `should return different salts for different identities` | ⬜ |
| SC-1.8 | Salts are encrypted at rest in database | `salt.storage.test.ts` | `should encrypt salt before storage` | ⬜ |

### Phase 2: Proof Service Proxy

| ID | Criterion | Test File | Test Name | Status |
|----|-----------|-----------|-----------|--------|
| SC-2.1 | Proof endpoint validates all required fields | `proof.service.test.ts` | `should reject missing required fields` | ⬜ |
| SC-2.2 | Proof endpoint enforces rate limit per IP | `proof.service.test.ts` | `should rate limit by IP` | ⬜ |
| SC-2.3 | Proof endpoint enforces rate limit per telegramId | `proof.service.test.ts` | `should rate limit by telegramId` | ⬜ |
| SC-2.4 | Proof endpoint times out after 30s | `proof.service.test.ts` | `should timeout after 30 seconds` | ⬜ |
| SC-2.5 | Proof endpoint returns Mysten prover response | `proof.service.test.ts` | `should proxy to Mysten prover` | ⬜ |
| SC-2.6 | Proof endpoint logs request metadata | `proof.service.test.ts` | `should log request metadata` | ⬜ |

### Phase 3: JWT Validator

| ID | Criterion | Test File | Test Name | Status |
|----|-----------|-----------|-----------|--------|
| SC-3.1 | Validator fetches Google JWKS | `jwt.validator.test.ts` | `should fetch Google JWKS` | ⬜ |
| SC-3.2 | Validator caches JWKS with TTL | `jwt.validator.test.ts` | `should cache JWKS` | ⬜ |
| SC-3.3 | Validator verifies RS256 signature | `jwt.validator.test.ts` | `should verify RS256 signature` | ⬜ |
| SC-3.4 | Validator rejects expired tokens | `jwt.validator.test.ts` | `should reject expired tokens` | ⬜ |
| SC-3.5 | Validator extracts claims correctly | `jwt.validator.test.ts` | `should extract claims` | ⬜ |
| SC-3.6 | Validator handles JWKS rotation | `jwt.validator.test.ts` | `should handle JWKS rotation` | ⬜ |

### Phase 4: Address Verification

| ID | Criterion | Test File | Test Name | Status |
|----|-----------|-----------|-----------|--------|
| SC-4.1 | Address derivation matches Sui SDK | `address.service.test.ts` | `should match Sui SDK address derivation` | ⬜ |
| SC-4.2 | Send flow rejects mismatched address | `address.service.test.ts` | `should reject address mismatch` | ⬜ |
| SC-4.3 | Linked wallet lookup works by telegramId | `address.service.test.ts` | `should lookup linked wallet` | ⬜ |

### Phase 5: Integration

| ID | Criterion | Test File | Test Name | Status |
|----|-----------|-----------|-----------|--------|
| SC-5.1 | Full create-wallet flow works without hardcoded salt | `integration.test.ts` | `should complete create-wallet flow` | ⬜ |
| SC-5.2 | Full send-funds flow works with backend salt | `integration.test.ts` | `should complete send-funds flow` | ⬜ |
| SC-5.3 | Full link flow works with backend salt | `integration.test.ts` | `should complete link flow` | ⬜ |
| SC-5.4 | Rate limiting works across endpoints | `integration.test.ts` | `should enforce rate limits` | ⬜ |

---

## 📁 File Structure to Create

```
services/transaction-builder/
├── src/
│   ├── index.ts                    # Main server (MODIFY)
│   ├── db.ts                       # Existing DB module
│   ├── mystenProver.ts             # Existing prover proxy (ENHANCE)
│   ├── zklogin/
│   │   ├── index.ts                # zkLogin module exports
│   │   ├── salt.service.ts         # Salt generation + retrieval
│   │   ├── salt.storage.ts         # Encrypted salt persistence
│   │   ├── proof.service.ts        # Proof proxy with rate limiting
│   │   ├── jwt.validator.ts        # JWT signature + claims validation
│   │   ├── address.service.ts      # Address derivation + verification
│   │   ├── jwks.cache.ts           # JWKS fetching + caching
│   │   ├── rate.limiter.ts         # Rate limiting middleware
│   │   └── types.ts                # TypeScript interfaces
│   └── config/
│       └── zklogin.config.ts       # Configuration constants
├── tests/
│   ├── setup.ts                    # Test setup + mocks
│   ├── fixtures/
│   │   ├── jwts.ts                 # Test JWT tokens
│   │   ├── jwks.ts                 # Mock JWKS responses
│   │   └── identities.ts           # Test identity data
│   ├── unit/
│   │   ├── salt.service.test.ts
│   │   ├── salt.storage.test.ts
│   │   ├── proof.service.test.ts
│   │   ├── jwt.validator.test.ts
│   │   └── address.service.test.ts
│   └── integration/
│       └── integration.test.ts
├── Dockerfile                      # Containerization
├── docker-compose.test.yml         # Test environment
└── package.json                    # Dependencies (MODIFY)
```

---

## 🔧 Implementation Specifications

### 1. Salt Service (`salt.service.ts`)

#### Interface

```typescript
interface SaltRequest {
  jwt: string;                    // Required: Google OAuth JWT
  telegramId: string;             // Required: User's Telegram ID
  provider?: string;              // Optional: defaults to 'google'
}

interface SaltResponse {
  salt: string;                   // BigInt as string (for zkLogin)
  provider: string;
  subject: string;
  derivedAddress: string;         // Pre-computed zkLogin address
  keyClaimName: string;           // Always 'sub' for now
}

interface SaltServiceConfig {
  masterSecret: string;           // ZKLOGIN_MASTER_SECRET env var
  allowedIssuers: string[];       // ['https://accounts.google.com']
  allowedAudiences: string[];     // [VITE_GOOGLE_CLIENT_ID]
  saltLength: number;             // 16 bytes = 32 hex chars
}
```

#### Algorithm: Deterministic Salt Derivation

```typescript
function deriveSalt(params: {
  masterSecret: string;
  issuer: string;
  audience: string;
  subject: string;
}): string {
  const input = `${params.issuer}:${params.audience}:${params.subject}`;
  const hmac = crypto.createHmac('sha256', params.masterSecret);
  hmac.update(input);
  const hash = hmac.digest();
  // Take first 16 bytes, convert to BigInt string
  const saltBigInt = BigInt('0x' + hash.slice(0, 16).toString('hex'));
  return saltBigInt.toString();
}
```

#### Endpoint Spec

```
POST /api/v1/zklogin/salt

Request Headers:
  Content-Type: application/json
  X-Request-ID: <uuid>  (optional, for tracing)

Request Body:
{
  "jwt": "<google_oauth_jwt>",
  "telegramId": "<telegram_user_id>"
}

Success Response (200):
{
  "salt": "150862062947206198448536405856390800536",
  "provider": "google",
  "subject": "1234567890",
  "derivedAddress": "0x...",
  "keyClaimName": "sub"
}

Error Responses:
  400: { "error": "jwt is required" }
  400: { "error": "telegramId is required" }
  401: { "error": "Invalid JWT signature" }
  401: { "error": "JWT expired" }
  401: { "error": "Invalid issuer" }
  401: { "error": "Invalid audience" }
  500: { "error": "Internal server error" }
```

---

### 2. JWT Validator (`jwt.validator.ts`)

#### Interface

```typescript
interface JwtValidationResult {
  valid: boolean;
  claims?: {
    iss: string;      // Issuer
    aud: string;      // Audience (client ID)
    sub: string;      // Subject (user ID)
    exp: number;      // Expiration timestamp
    iat: number;      // Issued at timestamp
    nonce?: string;   // zkLogin nonce
    email?: string;   // User email (optional)
  };
  error?: string;
}

interface JwksCache {
  keys: JsonWebKey[];
  fetchedAt: number;
  ttlMs: number;
}
```

#### JWKS Endpoints

```typescript
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const JWKS_CACHE_TTL_MS = 3600000; // 1 hour
```

#### Validation Steps

1. Decode JWT header → get `kid` (key ID)
2. Fetch JWKS (or use cache) → find key by `kid`
3. Verify signature using public key
4. Validate `iss` is in allowed issuers
5. Validate `aud` is in allowed audiences
6. Validate `exp > now` (not expired)
7. Validate `iat < now` (issued in past)
8. Extract and return claims

---

### 3. Proof Service (`proof.service.ts`)

#### Interface

```typescript
interface ProofRequest {
  jwt: string;
  extendedEphemeralPublicKey: string;
  maxEpoch: number;
  jwtRandomness: string;
  salt: string;
  keyClaimName: string;           // Usually 'sub'
  telegramId?: string;            // For rate limiting
}

interface ProofResponse {
  proofPoints: {
    a: string[];
    b: string[][];
    c: string[];
  };
  issBase64Details: {
    value: string;
    indexMod4: number;
  };
  headerBase64: string;
}
```

#### Endpoint Spec

```
POST /api/v1/zklogin/proof

Request Headers:
  Content-Type: application/json
  X-Forwarded-For: <client_ip>  (for rate limiting)

Request Body:
{
  "jwt": "<google_oauth_jwt>",
  "extendedEphemeralPublicKey": "<base64>",
  "maxEpoch": 123,
  "jwtRandomness": "<bigint_string>",
  "salt": "<bigint_string>",
  "keyClaimName": "sub",
  "telegramId": "123456789"  (optional)
}

Success Response (200):
{
  "proofPoints": { ... },
  "issBase64Details": { ... },
  "headerBase64": "..."
}

Error Responses:
  400: { "error": "Missing required field: <field>" }
  429: { "error": "Rate limit exceeded", "retryAfter": 60 }
  504: { "error": "Prover timeout" }
  502: { "error": "Prover unavailable" }
```

#### Rate Limiting Rules

```typescript
const RATE_LIMITS = {
  perIp: {
    windowMs: 60000,      // 1 minute
    maxRequests: 10       // 10 requests per minute per IP
  },
  perTelegramId: {
    windowMs: 60000,      // 1 minute
    maxRequests: 5        // 5 requests per minute per user
  },
  global: {
    windowMs: 60000,      // 1 minute
    maxRequests: 100      // 100 requests per minute total
  }
};
```

---

### 4. Address Service (`address.service.ts`)

#### Interface

```typescript
interface AddressDerivationParams {
  jwt: string;
  salt: string;
  keyClaimName?: string;  // defaults to 'sub'
}

interface AddressVerificationParams {
  telegramId: string;
  derivedAddress: string;
}

interface AddressVerificationResult {
  matches: boolean;
  linkedAddress: string | null;
  derivedAddress: string;
  error?: string;
}
```

#### Derivation Algorithm

Uses `@mysten/sui/zklogin` `jwtToAddress` function:

```typescript
import { jwtToAddress } from '@mysten/sui/zklogin';

function deriveZkLoginAddress(params: AddressDerivationParams): string {
  return jwtToAddress(params.jwt, params.salt);
}
```

---

### 5. Salt Storage (`salt.storage.ts`)

#### Database Schema

```sql
-- Existing table structure (from database/init/001_schema.sql)
-- Enhance with encryption_iv column if not present

CREATE TABLE IF NOT EXISTS zklogin_salts (
  id SERIAL PRIMARY KEY,
  telegram_id VARCHAR(64) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  subject VARCHAR(256) NOT NULL,
  audience VARCHAR(256) NOT NULL,        -- NEW: OAuth client ID
  salt_encrypted BYTEA NOT NULL,         -- CHANGED: Encrypted salt
  encryption_iv BYTEA NOT NULL,          -- NEW: AES-GCM IV
  derived_address VARCHAR(66) NOT NULL,  -- NEW: zkLogin address
  key_claim_name VARCHAR(32) DEFAULT 'sub',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(provider, subject, audience)
);

CREATE INDEX idx_zklogin_salts_telegram ON zklogin_salts(telegram_id);
CREATE INDEX idx_zklogin_salts_address ON zklogin_salts(derived_address);
```

#### Encryption

```typescript
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = process.env.ZKLOGIN_ENCRYPTION_KEY; // 32 bytes hex

function encryptSalt(salt: string): { encrypted: Buffer; iv: Buffer } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    ENCRYPTION_ALGORITHM,
    Buffer.from(ENCRYPTION_KEY, 'hex'),
    iv
  );
  const encrypted = Buffer.concat([
    cipher.update(salt, 'utf8'),
    cipher.final(),
    cipher.getAuthTag()
  ]);
  return { encrypted, iv };
}

function decryptSalt(encrypted: Buffer, iv: Buffer): string {
  const authTag = encrypted.slice(-16);
  const data = encrypted.slice(0, -16);
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    Buffer.from(ENCRYPTION_KEY, 'hex'),
    iv
  );
  decipher.setAuthTag(authTag);
  return decipher.update(data) + decipher.final('utf8');
}
```

---

### 6. Rate Limiter (`rate.limiter.ts`)

#### Implementation

```typescript
interface RateLimitStore {
  [key: string]: {
    count: number;
    windowStart: number;
  };
}

class RateLimiter {
  private store: RateLimitStore = {};
  
  constructor(
    private windowMs: number,
    private maxRequests: number
  ) {}
  
  check(key: string): { allowed: boolean; remaining: number; retryAfter?: number } {
    const now = Date.now();
    const record = this.store[key];
    
    if (!record || now - record.windowStart > this.windowMs) {
      this.store[key] = { count: 1, windowStart: now };
      return { allowed: true, remaining: this.maxRequests - 1 };
    }
    
    if (record.count >= this.maxRequests) {
      const retryAfter = Math.ceil((record.windowStart + this.windowMs - now) / 1000);
      return { allowed: false, remaining: 0, retryAfter };
    }
    
    record.count++;
    return { allowed: true, remaining: this.maxRequests - record.count };
  }
}
```

---

## 🐳 Docker Configuration

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3003

USER node
CMD ["node", "dist/index.js"]
```

### docker-compose.test.yml

```yaml
version: '3.8'

services:
  transaction-builder-test:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=test
      - PORT=3003
      - DATABASE_URL=postgresql://test:test@postgres-test:5432/caishen_test
      - ZKLOGIN_MASTER_SECRET=test_master_secret_32_bytes_hex
      - ZKLOGIN_ENCRYPTION_KEY=test_encryption_key_32_bytes_hex
      - GOOGLE_CLIENT_ID=test_client_id.apps.googleusercontent.com
      - PROVER_URL=http://mock-prover:8080
    depends_on:
      - postgres-test
      - mock-prover
    networks:
      - test-network

  postgres-test:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=test
      - POSTGRES_PASSWORD=test
      - POSTGRES_DB=caishen_test
    networks:
      - test-network

  mock-prover:
    build:
      context: ./tests/mocks
      dockerfile: Dockerfile.prover
    networks:
      - test-network

networks:
  test-network:
    driver: bridge
```

---

## 🔑 Environment Variables

### Required for Production

```bash
# Salt derivation master secret (32 bytes hex)
ZKLOGIN_MASTER_SECRET=<generate: openssl rand -hex 32>

# Salt encryption key (32 bytes hex)  
ZKLOGIN_ENCRYPTION_KEY=<generate: openssl rand -hex 32>

# OAuth configuration
GOOGLE_CLIENT_ID=<your-google-client-id>.apps.googleusercontent.com

# Prover URL (Mysten hosted or self-hosted)
PROVER_URL=https://prover-dev.mystenlabs.com/v1

# Database
DATABASE_URL=postgresql://user:pass@host:5432/caishen

# Rate limiting (optional overrides)
RATE_LIMIT_PER_IP_WINDOW_MS=60000
RATE_LIMIT_PER_IP_MAX_REQUESTS=10
RATE_LIMIT_PER_USER_WINDOW_MS=60000
RATE_LIMIT_PER_USER_MAX_REQUESTS=5
```

---

## 📝 Test Data Fixtures

### Test JWT Tokens (`tests/fixtures/jwts.ts`)

```typescript
// These are TEST ONLY tokens - never use in production
// Generated with test keys, expired, for unit testing only

export const VALID_TEST_JWT = {
  // Header: { alg: 'RS256', kid: 'test-key-id', typ: 'JWT' }
  // Payload: { iss: 'https://accounts.google.com', aud: 'test_client_id', sub: 'test_subject_123', exp: 9999999999, iat: 1700000000, nonce: 'test_nonce' }
  token: 'eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2V5LWlkIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhdWQiOiJ0ZXN0X2NsaWVudF9pZCIsInN1YiI6InRlc3Rfc3ViamVjdF8xMjMiLCJleHAiOjk5OTk5OTk5OTksImlhdCI6MTcwMDAwMDAwMCwibm9uY2UiOiJ0ZXN0X25vbmNlIn0.SIGNATURE_PLACEHOLDER',
  claims: {
    iss: 'https://accounts.google.com',
    aud: 'test_client_id',
    sub: 'test_subject_123',
    exp: 9999999999,
    iat: 1700000000,
    nonce: 'test_nonce'
  }
};

export const EXPIRED_TEST_JWT = {
  // Same as above but exp in the past
  token: 'eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2V5LWlkIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhdWQiOiJ0ZXN0X2NsaWVudF9pZCIsInN1YiI6InRlc3Rfc3ViamVjdF8xMjMiLCJleHAiOjE3MDAwMDAwMDAsImlhdCI6MTY5OTAwMDAwMCwibm9uY2UiOiJ0ZXN0X25vbmNlIn0.SIGNATURE_PLACEHOLDER',
  claims: {
    iss: 'https://accounts.google.com',
    aud: 'test_client_id',
    sub: 'test_subject_123',
    exp: 1700000000,  // Expired
    iat: 1699000000,
    nonce: 'test_nonce'
  }
};

export const WRONG_ISSUER_JWT = {
  token: 'eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2V5LWlkIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwczovL2V2aWwuY29tIiwiYXVkIjoidGVzdF9jbGllbnRfaWQiLCJzdWIiOiJ0ZXN0X3N1YmplY3RfMTIzIiwiZXhwIjo5OTk5OTk5OTk5LCJpYXQiOjE3MDAwMDAwMDAsIm5vbmNlIjoidGVzdF9ub25jZSJ9.SIGNATURE_PLACEHOLDER',
  claims: {
    iss: 'https://evil.com',  // Wrong issuer
    aud: 'test_client_id',
    sub: 'test_subject_123',
    exp: 9999999999,
    iat: 1700000000,
    nonce: 'test_nonce'
  }
};

export const WRONG_AUDIENCE_JWT = {
  token: 'eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2V5LWlkIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhdWQiOiJ3cm9uZ19jbGllbnRfaWQiLCJzdWIiOiJ0ZXN0X3N1YmplY3RfMTIzIiwiZXhwIjo5OTk5OTk5OTk5LCJpYXQiOjE3MDAwMDAwMDAsIm5vbmNlIjoidGVzdF9ub25jZSJ9.SIGNATURE_PLACEHOLDER',
  claims: {
    iss: 'https://accounts.google.com',
    aud: 'wrong_client_id',  // Wrong audience
    sub: 'test_subject_123',
    exp: 9999999999,
    iat: 1700000000,
    nonce: 'test_nonce'
  }
};
```

---

## 🔄 Implementation Phases

### Phase 1: Salt Service (Priority: CRITICAL)

**Goal**: Replace hardcoded salt with server-side salt derivation

**Pre-Implementation Checklist**:
- [ ] Write all unit tests in `tests/unit/salt.service.test.ts`
- [ ] Write all unit tests in `tests/unit/jwt.validator.test.ts`
- [ ] Run tests, confirm they fail (Red phase)
- [ ] Git commit: `test(zklogin): add salt service unit tests`

**Implementation Steps**:
1. Create `src/zklogin/types.ts` with all interfaces
2. Create `src/zklogin/jwt.validator.ts` with JWKS fetching and JWT validation
3. Create `src/zklogin/salt.service.ts` with deterministic salt derivation
4. Add endpoint `POST /api/v1/zklogin/salt` to `src/index.ts`
5. Run tests, confirm they pass (Green phase)
6. Git commit: `feat(zklogin): implement salt service with JWT validation`

**Regression Check**:
- [ ] Run all existing tests in `services/transaction-builder/tests`
- [ ] Run `npm run check` for TypeScript errors
- [ ] Git commit if any fixes needed

---

### Phase 2: Proof Proxy Service (Priority: HIGH)

**Goal**: Proxy proof generation through our own endpoint

**Pre-Implementation Checklist**:
- [ ] Write all unit tests in `tests/unit/proof.service.test.ts`
- [ ] Run tests, confirm they fail
- [ ] Git commit: `test(zklogin): add proof service unit tests`

**Implementation Steps**:
1. Create `src/zklogin/rate.limiter.ts`
2. Create `src/zklogin/proof.service.ts`
3. Enhance `src/mystenProver.ts` with timeout handling
4. Add endpoint `POST /api/v1/zklogin/proof` to `src/index.ts`
5. Run tests, confirm they pass
6. Git commit: `feat(zklogin): implement proof proxy with rate limiting`

**Regression Check**:
- [ ] Run all Phase 1 tests
- [ ] Run all Phase 2 tests
- [ ] Git commit if any fixes needed

---

### Phase 3: Salt Storage (Priority: HIGH)

**Goal**: Encrypted persistence of salts

**Pre-Implementation Checklist**:
- [ ] Write all unit tests in `tests/unit/salt.storage.test.ts`
- [ ] Run tests, confirm they fail
- [ ] Git commit: `test(zklogin): add salt storage unit tests`

**Implementation Steps**:
1. Create `src/zklogin/salt.storage.ts`
2. Add database migration for enhanced schema
3. Integrate storage with salt service
4. Run tests, confirm they pass
5. Git commit: `feat(zklogin): implement encrypted salt storage`

**Regression Check**:
- [ ] Run all Phase 1-2 tests
- [ ] Run all Phase 3 tests
- [ ] Git commit if any fixes needed

---

### Phase 4: Address Verification (Priority: MEDIUM)

**Goal**: Verify derived address matches linked wallet

**Pre-Implementation Checklist**:
- [ ] Write all unit tests in `tests/unit/address.service.test.ts`
- [ ] Run tests, confirm they fail
- [ ] Git commit: `test(zklogin): add address service unit tests`

**Implementation Steps**:
1. Create `src/zklogin/address.service.ts`
2. Add endpoint `POST /api/v1/zklogin/verify-address`
3. Run tests, confirm they pass
4. Git commit: `feat(zklogin): implement address verification`

**Regression Check**:
- [ ] Run all Phase 1-3 tests
- [ ] Run all Phase 4 tests
- [ ] Git commit if any fixes needed

---

### Phase 5: Integration Tests (Priority: HIGH)

**Goal**: End-to-end flow verification

**Pre-Implementation Checklist**:
- [ ] Write all integration tests in `tests/integration/integration.test.ts`
- [ ] Set up docker-compose test environment
- [ ] Git commit: `test(zklogin): add integration tests`

**Implementation Steps**:
1. Create mock prover for testing
2. Set up test database with fixtures
3. Run full integration test suite
4. Git commit: `test(zklogin): integration tests passing`

---

## 🧪 Test Commands

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- --testPathPattern=salt.service.test.ts
```

---

## 📊 Monitoring & Observability

### Structured Logging

All endpoints should log:

```typescript
logger.info({
  endpoint: '/api/v1/zklogin/salt',
  telegramId: req.body.telegramId,
  provider: 'google',
  durationMs: endTime - startTime,
  success: true
}, 'Salt request completed');

logger.error({
  endpoint: '/api/v1/zklogin/salt',
  telegramId: req.body.telegramId,
  error: err.message,
  stack: err.stack
}, 'Salt request failed');
```

### Health Check Enhancement

```typescript
app.get('/health', async (req, res) => {
  const checks = {
    database: await checkDbConnection(),
    jwksCache: jwksCacheStatus(),
    rateLimiter: rateLimiterStatus()
  };
  
  const healthy = Object.values(checks).every(c => c.healthy);
  
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    service: 'transaction-builder',
    checks,
    timestamp: new Date().toISOString()
  });
});
```

---

## 🔒 Security Checklist

Before deployment, verify:

- [ ] `ZKLOGIN_MASTER_SECRET` is set and not committed to git
- [ ] `ZKLOGIN_ENCRYPTION_KEY` is set and not committed to git
- [ ] Database connection uses SSL in production
- [ ] Rate limiting is enabled and tested
- [ ] JWT validation rejects all invalid tokens
- [ ] Salts are encrypted at rest
- [ ] No hardcoded salts remain in frontend code
- [ ] CORS is properly configured
- [ ] Request size limits are enforced
- [ ] Timeout handling is implemented

---

## 🚨 Incident Response

### If Master Secret is Compromised

1. Generate new master secret immediately
2. All existing salts become invalid (users need to re-link)
3. Update env var and redeploy
4. Notify affected users

### If Encryption Key is Compromised

1. Generate new encryption key
2. Run migration to re-encrypt all salts
3. Update env var and redeploy

### If Rate Limiting is Bypassed

1. Enable emergency rate limits at nginx level
2. Investigate bypass method
3. Patch and deploy fix

---

## 📚 References

- [Sui zkLogin Documentation](https://docs.sui.io/concepts/cryptography/zklogin)
- [Mysten Salt Server Architecture](https://blog.sui.io/zklogin-salt-server-architecture/)
- [zkLogin Proof Generation](https://docs.sui.io/guides/developer/cryptography/zklogin-integration)
- [Google OAuth JWKS Endpoint](https://www.googleapis.com/oauth2/v3/certs)

---

## ✍️ Final Agent Checklist

Before marking implementation complete:

```markdown
<!-- FINAL_CHECKLIST -->
[ ] All success criteria tests pass
[ ] All regression tests pass
[ ] Code coverage > 80%
[ ] No TypeScript errors
[ ] No ESLint warnings
[ ] Docker build succeeds
[ ] Health check returns ok
[ ] Manual smoke test completed
[ ] Documentation updated
[ ] Git history is clean with conventional commits
<!-- /FINAL_CHECKLIST -->
```

---

*Document generated for agentic implementation. Human review required before production deployment.*
