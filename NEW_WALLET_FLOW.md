# 🤖 AI Agent PRD: Deterministic zkLogin Wallet Flow

> **Document Type**: Product Requirements Document + AI Agent Prompt  
> **Methodology**: Test-Driven Development (TDD) + Spec-Driven + Agentic Development  
> **Session Storage**: In-Memory (Map-based with TTL)  
> **Last Updated**: 2024-12-14

---

## 📋 Table of Contents

1. [Agent Instructions](#-agent-instructions)
2. [Executive Summary](#-executive-summary)
3. [Success Criteria (Define FIRST)](#-success-criteria-define-first)
4. [Test Suite Specification](#-test-suite-specification)
5. [Implementation Phases](#-implementation-phases)
6. [Git Workflow](#-git-workflow)
7. [Recursive Testing Protocol](#-recursive-testing-protocol)
8. [Agent Notes & Comments](#-agent-notes--comments)
9. [Technical Specification](#-technical-specification)
10. [Security Checklist](#-security-checklist)

---

## 🤖 Agent Instructions

```
YOU ARE AN AI CODING AGENT. Follow these rules strictly:

1. READ THIS ENTIRE DOCUMENT before writing any code
2. WRITE TESTS FIRST - No implementation without failing tests
3. COMMIT FREQUENTLY - After each green test or feature
4. RE-TEST EVERYTHING - After each new feature, run full test suite
5. DOCUMENT DECISIONS - Use the Agent Notes section below
6. CHECK GIT HISTORY - Before implementing, review past commits
7. RECURSIVE LOOP - Test → Implement → Commit → Re-test ALL → Repeat

WORKFLOW:
┌─────────────────────────────────────────────────────────────────┐
│  1. Read Success Criteria                                       │
│  2. Write failing test for criteria                             │
│  3. Implement minimal code to pass                              │
│  4. Run ALL tests (not just new ones)                           │
│  5. Git commit with descriptive message                         │
│  6. Check git log for context                                   │
│  7. Move to next criteria                                       │
│  8. After 3 features: run integration tests                     │
│  9. After integration: regression test all units                │
│  └──────────────────────────────────────────────────────────────┘
```

---

## 📄 Executive Summary

### Purpose
Create a secure, non-custodial zkLogin wallet linking flow for Telegram users using **in-memory session storage** with automatic TTL expiration.

### Architecture Decision: In-Memory Storage

**Chosen**: In-Memory Map with TTL  
**Rationale**: 
- Hackathon scope - simplicity over scalability
- Single container deployment
- No external dependencies
- Automatic garbage collection via `setInterval`

**Trade-offs Accepted**:
- ❌ Sessions lost on container restart
- ❌ Cannot scale horizontally
- ✅ Zero latency
- ✅ No Redis/infrastructure complexity

```typescript
// Core storage pattern used throughout
const store = new Map<string, Session>();
setInterval(() => cleanExpired(store), 60_000);
```

---

## ✅ Success Criteria (Define FIRST)

> **RULE**: Every criterion MUST have a test before implementation begins.

### SC-1: Linking Session Management

| ID | Criterion | Test File | Status |
|----|-----------|-----------|--------|
| SC-1.1 | Session created with 15-min TTL | `tests/linking/session.test.ts` | ⬜ |
| SC-1.2 | Session retrievable by token | `tests/linking/session.test.ts` | ⬜ |
| SC-1.3 | Expired sessions return null | `tests/linking/session.test.ts` | ⬜ |
| SC-1.4 | One session per telegram_id (old invalidated) | `tests/linking/session.test.ts` | ⬜ |
| SC-1.5 | Session auto-cleanup runs every 60s | `tests/linking/session.test.ts` | ⬜ |

### SC-2: Wallet Connection

| ID | Criterion | Test File | Status |
|----|-----------|-----------|--------|
| SC-2.1 | Valid Sui address accepted (0x + 40-64 hex) | `tests/linking/wallet.test.ts` | ⬜ |
| SC-2.2 | Invalid address rejected with error | `tests/linking/wallet.test.ts` | ⬜ |
| SC-2.3 | zkLogin type stores salt and sub | `tests/linking/wallet.test.ts` | ⬜ |
| SC-2.4 | Status transitions: pending_wallet → pending_telegram | `tests/linking/wallet.test.ts` | ⬜ |
| SC-2.5 | Cannot connect wallet twice to same session | `tests/linking/wallet.test.ts` | ⬜ |

### SC-3: Telegram Verification

| ID | Criterion | Test File | Status |
|----|-----------|-----------|--------|
| SC-3.1 | Valid HMAC hash accepted | `tests/linking/telegram.test.ts` | ⬜ |
| SC-3.2 | Invalid hash rejected (401) | `tests/linking/telegram.test.ts` | ⬜ |
| SC-3.3 | Telegram ID must match session creator | `tests/linking/telegram.test.ts` | ⬜ |
| SC-3.4 | Auth older than 5 minutes rejected | `tests/linking/telegram.test.ts` | ⬜ |
| SC-3.5 | Timing-safe comparison used | `tests/linking/telegram.test.ts` | ⬜ |

### SC-4: zkLogin Flow

| ID | Criterion | Test File | Status |
|----|-----------|-----------|--------|
| SC-4.1 | Ephemeral keypair generated client-side | `tests/zklogin/flow.test.ts` | ⬜ |
| SC-4.2 | Nonce includes maxEpoch | `tests/zklogin/flow.test.ts` | ⬜ |
| SC-4.3 | Salt fetched from Mysten API | `tests/zklogin/salt.test.ts` | ⬜ |
| SC-4.4 | Address derived deterministically | `tests/zklogin/address.test.ts` | ⬜ |
| SC-4.5 | Same salt + JWT = same address | `tests/zklogin/address.test.ts` | ⬜ |

### SC-5: Integration

| ID | Criterion | Test File | Status |
|----|-----------|-----------|--------|
| SC-5.1 | Full flow: create → wallet → verify → complete | `tests/integration/fullFlow.test.ts` | ⬜ |
| SC-5.2 | Rate limiting: 20 req/min per IP | `tests/integration/rateLimit.test.ts` | ⬜ |
| SC-5.3 | Concurrent sessions for different users work | `tests/integration/concurrent.test.ts` | ⬜ |
| SC-5.4 | Database persistence of final wallet link | `tests/integration/persistence.test.ts` | ⬜ |

---

## 🧪 Test Suite Specification

### Directory Structure

```
tests/
├── unit/
│   ├── linking/
│   │   ├── session.test.ts      # SC-1.*
│   │   ├── wallet.test.ts       # SC-2.*
│   │   └── telegram.test.ts     # SC-3.*
│   └── zklogin/
│       ├── flow.test.ts         # SC-4.1, SC-4.2
│       ├── salt.test.ts         # SC-4.3
│       └── address.test.ts      # SC-4.4, SC-4.5
├── integration/
│   ├── fullFlow.test.ts         # SC-5.1
│   ├── rateLimit.test.ts        # SC-5.2
│   ├── concurrent.test.ts       # SC-5.3
│   └── persistence.test.ts      # SC-5.4
├── fixtures/
│   ├── validSessions.json
│   ├── invalidAddresses.json
│   └── telegramAuthData.json
└── helpers/
    ├── mockTelegramAuth.ts
    ├── mockSuiClient.ts
    └── testStore.ts
```

### Test Template

```typescript
// tests/unit/linking/session.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createLinkingSession,
  getLinkingSession,
  getLinkingSessionCount
} from '@/services/linking/linkingStore';

describe('SC-1: Linking Session Management', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('SC-1.1: Session created with 15-min TTL', () => {
    it('should create session with correct expiration', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const session = createLinkingSession('123', 'testuser', 'Test');

      expect(session.expiresAt).toBe(now + 15 * 60 * 1000);
    });
  });

  describe('SC-1.3: Expired sessions return null', () => {
    it('should return null for expired session', () => {
      const session = createLinkingSession('123', 'testuser', 'Test');

      // Advance time past expiration
      vi.advanceTimersByTime(16 * 60 * 1000);

      const retrieved = getLinkingSession(session.token);
      expect(retrieved).toBeNull();
    });
  });

  describe('SC-1.4: One session per telegram_id', () => {
    it('should invalidate old session when creating new', () => {
      const session1 = createLinkingSession('123', 'user1', 'User');
      const session2 = createLinkingSession('123', 'user1', 'User');

      expect(getLinkingSession(session1.token)).toBeNull();
      expect(getLinkingSession(session2.token)).not.toBeNull();
    });
  });

  // AGENT: Add remaining tests for SC-1.2, SC-1.5 here
});
```

### Running Tests

```bash
# Run all unit tests
npm run test:unit

# Run specific test file
npm run test -- tests/unit/linking/session.test.ts

# Run with coverage
npm run test:coverage

# Run integration tests (requires running services)
npm run test:integration

# Run FULL regression suite
npm run test:all
```

---

## 📦 Implementation Phases

> **RULE**: Complete all tests for a phase before moving to next phase.

### Phase 1: Session Store (Days 1-2)

**Tests to write FIRST:**
```bash
# Write these tests before any implementation
touch tests/unit/linking/session.test.ts
# Implement SC-1.1 through SC-1.5 tests
```

**Implementation after tests pass:**
```typescript
// src/services/linking/linkingStore.ts
export interface LinkingSession {
  token: string;
  telegramId: string;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  createdAt: number;
  expiresAt: number;
  walletAddress?: string;
  walletType?: 'zklogin' | 'slush' | 'external';
  zkLoginSalt?: string;
  zkLoginSub?: string;
  status: 'pending_wallet' | 'pending_telegram_confirm' | 'completed' | 'expired';
}

// In-memory store with automatic cleanup
const store = new Map<string, LinkingSession>();
const byTelegramId = new Map<string, string>();

// Cleanup interval - runs every 60 seconds
const CLEANUP_INTERVAL_MS = 60_000;
let cleanupTimer: NodeJS.Timeout | null = null;

export function startCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [token, session] of store) {
      if (session.expiresAt < now) {
        store.delete(token);
        byTelegramId.delete(session.telegramId);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

export function stopCleanupTimer() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// Start cleanup on module load
startCleanupTimer();
```

**Git commit after Phase 1:**
```bash
git add -A
git commit -m "feat(linking): implement in-memory session store with TTL

- SC-1.1: 15-minute TTL on sessions ✓
- SC-1.2: Token-based retrieval ✓
- SC-1.3: Expired sessions return null ✓
- SC-1.4: One session per telegram_id ✓
- SC-1.5: Auto-cleanup every 60s ✓

Tests: 5 passing"
```

### Phase 2: Wallet Connection (Days 2-3)

**Tests to write FIRST:**
```bash
touch tests/unit/linking/wallet.test.ts
# Implement SC-2.1 through SC-2.5 tests
```

**Git commit after Phase 2:**
```bash
git add -A
git commit -m "feat(linking): wallet connection with validation

- SC-2.1: Sui address validation ✓
- SC-2.2: Invalid address rejection ✓
- SC-2.3: zkLogin metadata storage ✓
- SC-2.4: Status state machine ✓
- SC-2.5: Prevent double-connect ✓

Tests: 10 passing (5 new + 5 regression)"
```

### Phase 3: Telegram Verification (Days 3-4)

**Tests to write FIRST:**
```bash
touch tests/unit/linking/telegram.test.ts
# Implement SC-3.1 through SC-3.5 tests
```

**Critical security test:**
```typescript
describe('SC-3.5: Timing-safe comparison', () => {
  it('should use crypto.timingSafeEqual for hash comparison', () => {
    // This test verifies the implementation uses timing-safe comparison
    // to prevent timing attacks on the HMAC verification
    const spy = vi.spyOn(crypto, 'timingSafeEqual');

    verifyTelegramAuth(validAuthData);

    expect(spy).toHaveBeenCalled();
  });
});
```

### Phase 4: Integration (Days 4-5)

**Full flow test:**
```typescript
// tests/integration/fullFlow.test.ts
describe('SC-5.1: Complete linking flow', () => {
  it('should complete full flow: create → wallet → verify → complete', async () => {
    // 1. Create session
    const session = createLinkingSession('12345', 'testuser', 'Test');
    expect(session.status).toBe('pending_wallet');

    // 2. Connect wallet
    const walletResult = updateLinkingSession(session.token, {
      walletAddress: '0x' + 'a'.repeat(64),
      walletType: 'zklogin',
      status: 'pending_telegram_confirm'
    });
    expect(walletResult?.status).toBe('pending_telegram_confirm');

    // 3. Verify Telegram (with mocked auth)
    const authData = createMockTelegramAuth('12345');
    const verification = verifyTelegramAuth(authData);
    expect(verification.valid).toBe(true);
    expect(verification.telegramId).toBe('12345');

    // 4. Complete
    const completed = completeLinkingSession(session.token);
    expect(completed?.status).toBe('completed');
  });
});
```

---

## 🔀 Git Workflow

### Branch Strategy

```
main
├── feature/SC-1-session-store
├── feature/SC-2-wallet-connection
├── feature/SC-3-telegram-verification
├── feature/SC-4-zklogin-flow
└── feature/SC-5-integration
```

### Commit Message Format

```
<type>(<scope>): <description>

- SC-X.X: <criterion> ✓
- SC-X.X: <criterion> ✓

Tests: X passing (Y new + Z regression)

AGENT_NOTES:
- <any observations or decisions made>
```

### Pre-Commit Checklist

```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "🧪 Running unit tests..."
npm run test:unit || exit 1

echo "🔍 Running linter..."
npm run lint || exit 1

echo "✅ All checks passed!"
```

### Git Commands for Agent

```bash
# Before implementing, check recent context
git log --oneline -10
git diff HEAD~1

# After each feature
git add -A
git status
git commit -m "feat(scope): description"

# Check what changed
git show --stat

# If tests fail after new feature, check what broke
git bisect start
git bisect bad HEAD
git bisect good HEAD~5
```

---

## 🔄 Recursive Testing Protocol

```
┌─────────────────────────────────────────────────────────────────────┐
│                    RECURSIVE TESTING LOOP                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐                                                   │
│  │ 1. WRITE TEST │ ◄─────────────────────────────────────┐          │
│  └──────┬───────┘                                        │          │
│         │                                                │          │
│         ▼                                                │          │
│  ┌──────────────┐                                        │          │
│  │ 2. RUN TEST  │ ──── Should FAIL ────────────────────┐ │          │
│  │    (Red)     │                                      │ │          │
│  └──────┬───────┘                                      │ │          │
│         │                                              │ │          │
│         ▼                                              │ │          │
│  ┌──────────────┐                                      │ │          │
│  │ 3. IMPLEMENT │                                      │ │          │
│  │   (Minimal)  │                                      │ │          │
│  └──────┬───────┘                                      │ │          │
│         │                                              │ │          │
│         ▼                                              │ │          │
│  ┌──────────────┐                                      │ │          │
│  │ 4. RUN TEST  │ ──── Should PASS ────┐               │ │          │
│  │    (Green)   │                      │               │ │          │
│  └──────┬───────┘                      │               │ │          │
│         │                              │               │ │          │
│         ▼                              ▼               │ │          │
│  ┌──────────────┐              ┌──────────────┐        │ │          │
│  │ 5. RUN ALL   │              │   DEBUG &    │        │ │          │
│  │    TESTS     │              │   FIX CODE   │────────┘ │          │
│  └──────┬───────┘              └──────────────┘          │          │
│         │                                                │          │
│         ▼                                                │          │
│  ┌──────────────┐                                        │          │
│  │ 6. ALL PASS? │ ──── NO ──► REGRESSION! ──► FIX ──────┘          │
│  └──────┬───────┘                                                   │
│         │ YES                                                       │
│         ▼                                                           │
│  ┌──────────────┐                                                   │
│  │ 7. GIT COMMIT│                                                   │
│  └──────┬───────┘                                                   │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────┐                                                   │
│  │ 8. MORE      │ ──── YES ──► Back to step 1 ─────────────────────┘
│  │   CRITERIA?  │                                                   │
│  └──────┬───────┘                                                   │
│         │ NO                                                        │
│         ▼                                                           │
│  ┌──────────────┐                                                   │
│  │ 9. DONE! 🎉  │                                                   │
│  └──────────────┘                                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Regression Detection Script

```bash
#!/bin/bash
# scripts/regression-check.sh

echo "📊 Running regression check..."

# Get list of all test files
TEST_FILES=$(find tests -name "*.test.ts")

# Run each test file and track results
FAILED=()
PASSED=()

for file in $TEST_FILES; do
  echo "Testing: $file"
  if npm run test -- "$file" --silent; then
    PASSED+=("$file")
  else
    FAILED+=("$file")
  fi
done

echo ""
echo "====== REGRESSION REPORT ======"
echo "✅ Passed: ${#PASSED[@]}"
echo "❌ Failed: ${#FAILED[@]}"

if [ ${#FAILED[@]} -gt 0 ]; then
  echo ""
  echo "Failed tests:"
  for f in "${FAILED[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

echo "🎉 All tests passing!"
```

---

## 📝 Agent Notes & Comments

> **INSTRUCTIONS**: AI Agent should update this section with observations, decisions, and learnings during implementation.

### Session Log

```
<!-- AGENT: Add entries here as you work -->

[YYYY-MM-DD HH:MM] SESSION START
- Current git commit: <hash>
- Tests passing: X/Y
- Working on: SC-X.X

---

[YYYY-MM-DD HH:MM] DECISION MADE
- Issue: <what problem encountered>
- Decision: <what was decided>
- Rationale: <why this approach>
- Trade-offs: <what was sacrificed>

---

[YYYY-MM-DD HH:MM] REGRESSION FOUND
- Failed test: <test name>
- Cause: <what broke it>
- Fix: <how it was resolved>
- Prevention: <how to avoid in future>

---

[YYYY-MM-DD HH:MM] SESSION END
- Commits made: X
- Tests passing: X/Y
- Next steps: <what to do next>
```

### Open Questions

```
<!-- AGENT: Add questions that need human input -->

1. [ ] <Question about requirements>
   - Context: ...
   - Options: A, B, C
   - Recommendation: ...

2. [ ] <Question about architecture>
   - Context: ...
   - Options: A, B, C
   - Recommendation: ...
```

### Learnings & Patterns

```
<!-- AGENT: Document patterns discovered -->

PATTERN: <name>
- When to use: ...
- Implementation: ...
- Example: ...

---

ANTI-PATTERN: <name>
- Why it's bad: ...
- What to do instead: ...
```

---

## 🔧 Technical Specification

### In-Memory Session Store

```typescript
// FINAL IMPLEMENTATION - src/services/linking/linkingStore.ts

import crypto from 'crypto';
import logger from '../../utils/logger';

export interface LinkingSession {
  token: string;
  telegramId: string;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  createdAt: number;
  expiresAt: number;
  walletAddress?: string;
  walletType?: 'zklogin' | 'slush' | 'external';
  zkLoginSalt?: string;
  zkLoginSub?: string;
  status: 'pending_wallet' | 'pending_telegram_confirm' | 'completed' | 'expired';
}

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================
// Design Decision: Using Map for O(1) lookups
// Trade-off: Lost on restart, but acceptable for hackathon scope
// ============================================================================

const store = new Map<string, LinkingSession>();
const byTelegramId = new Map<string, string>(); // telegramId -> token

// Cleanup configuration
const CLEANUP_INTERVAL_MS = 60_000; // 1 minute
const DEFAULT_TTL_MINUTES = 15;

let cleanupTimer: NodeJS.Timeout | null = null;

/**
 * Start the automatic cleanup timer
 * Removes expired sessions every minute
 */
export function startCleanupTimer(): void {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    for (const [token, session] of store) {
      if (session.expiresAt < now) {
        store.delete(token);
        byTelegramId.delete(session.telegramId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug({ cleaned }, 'Cleaned expired linking sessions');
    }
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Stop the cleanup timer (for testing)
 */
export function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * Clear all sessions (for testing)
 */
export function clearAllSessions(): void {
  store.clear();
  byTelegramId.clear();
}

/**
 * Create a new linking session
 * Invalidates any existing session for the same telegram user
 */
export function createLinkingSession(
  telegramId: string,
  telegramUsername: string | null,
  telegramFirstName: string | null,
  ttlMinutes: number = DEFAULT_TTL_MINUTES
): LinkingSession {
  // Invalidate existing session for this user
  const existingToken = byTelegramId.get(telegramId);
  if (existingToken) {
    store.delete(existingToken);
    logger.debug({ telegramId }, 'Invalidated existing session');
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();

  const session: LinkingSession = {
    token,
    telegramId,
    telegramUsername,
    telegramFirstName,
    createdAt: now,
    expiresAt: now + ttlMinutes * 60 * 1000,
    status: 'pending_wallet'
  };

  store.set(token, session);
  byTelegramId.set(telegramId, token);

  logger.info({
    token: token.slice(0, 8) + '...',
    telegramId,
    ttlMinutes
  }, 'Created linking session');

  return session;
}

/**
 * Get session by token
 * Returns null if not found or expired
 */
export function getLinkingSession(token: string): LinkingSession | null {
  const session = store.get(token);

  if (!session) {
    return null;
  }

  // Check expiration
  if (session.expiresAt < Date.now()) {
    store.delete(token);
    byTelegramId.delete(session.telegramId);
    return null;
  }

  return session;
}

/**
 * Get session by telegram ID
 */
export function getLinkingSessionByTelegramId(telegramId: string): LinkingSession | null {
  const token = byTelegramId.get(telegramId);
  if (!token) return null;
  return getLinkingSession(token);
}

/**
 * Update session fields
 */
export function updateLinkingSession(
  token: string,
  updates: Partial<Pick<LinkingSession, 'walletAddress' | 'walletType' | 'zkLoginSalt' | 'zkLoginSub' | 'status'>>
): LinkingSession | null {
  const session = getLinkingSession(token);
  if (!session) return null;

  Object.assign(session, updates);
  store.set(token, session);

  logger.info({
    token: token.slice(0, 8) + '...',
    status: session.status
  }, 'Updated linking session');

  return session;
}

/**
 * Complete the linking process
 */
export function completeLinkingSession(token: string): LinkingSession | null {
  const session = getLinkingSession(token);
  if (!session) return null;

  session.status = 'completed';
  store.set(token, session);

  // Keep for 5 minutes for confirmation, then auto-cleanup
  setTimeout(() => {
    store.delete(token);
    byTelegramId.delete(session.telegramId);
  }, 5 * 60 * 1000);

  logger.info({
    token: token.slice(0, 8) + '...',
    telegramId: session.telegramId,
    walletAddress: session.walletAddress
  }, 'Completed linking session');

  return session;
}

/**
 * Get count of active sessions (monitoring)
 */
export function getLinkingSessionCount(): number {
  return store.size;
}

// Start cleanup on module load
startCleanupTimer();
```

### Telegram Verification (Security-Critical)

```typescript
// src/services/linking/telegramAuth.ts

import crypto from 'crypto';
import logger from '../../utils/logger';
import { config } from '../../config/env';

export interface TelegramAuthData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

const MAX_AUTH_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Verify Telegram Login Widget auth data
 * 
 * SECURITY NOTES:
 * - Uses HMAC-SHA256 as specified by Telegram
 * - Uses timing-safe comparison to prevent timing attacks
 * - Checks auth_date to prevent replay attacks
 */
export function verifyTelegramAuth(authData: TelegramAuthData): {
  valid: boolean;
  error?: string;
  telegramId?: string;
} {
  try {
    const { hash, ...dataToCheck } = authData;

    // 1. Build data-check-string (alphabetically sorted)
    const dataCheckString = Object.keys(dataToCheck)
      .sort()
      .map(key => `${key}=${dataToCheck[key as keyof typeof dataToCheck]}`)
      .join('\n');

    // 2. Create secret key (SHA256 of bot token)
    const secretKey = crypto
      .createHash('sha256')
      .update(config.TELEGRAM_BOT_TOKEN)
      .digest();

    // 3. Calculate expected hash
    const expectedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // 4. TIMING-SAFE comparison (SC-3.5)
    const hashBuffer = Buffer.from(hash, 'hex');
    const expectedBuffer = Buffer.from(expectedHash, 'hex');

    if (hashBuffer.length !== expectedBuffer.length) {
      return { valid: false, error: 'Invalid hash format' };
    }

    const hashesMatch = crypto.timingSafeEqual(hashBuffer, expectedBuffer);

    if (!hashesMatch) {
      logger.warn({ telegramId: authData.id }, 'Hash mismatch');
      return { valid: false, error: 'Invalid authentication hash' };
    }

    // 5. Check auth age (SC-3.4)
    const authAge = Date.now() - (authData.auth_date * 1000);
    if (authAge > MAX_AUTH_AGE_MS) {
      logger.warn({
        telegramId: authData.id,
        authAge: Math.round(authAge / 1000) + 's'
      }, 'Auth too old');
      return { valid: false, error: 'Authentication expired' };
    }

    logger.info({ telegramId: authData.id }, 'Telegram auth verified');

    return {
      valid: true,
      telegramId: String(authData.id)
    };

  } catch (err) {
    logger.error({ err }, 'Telegram auth verification failed');
    return { valid: false, error: 'Verification failed' };
  }
}
```

---

## 🔐 Security Checklist

> **AGENT**: Mark each item as you verify implementation

### Authentication & Authorization

- [ ] Telegram HMAC verification uses `crypto.timingSafeEqual`
- [ ] Auth data expires after 5 minutes
- [ ] Telegram ID in auth MUST match session creator
- [ ] Rate limiting applied (20 req/min/IP)

### Session Security

- [ ] Tokens are cryptographically random (24 bytes)
- [ ] Sessions expire after 15 minutes
- [ ] One session per telegram user
- [ ] Expired sessions cleaned up

### Data Validation

- [ ] Wallet addresses validated (0x + 40-64 hex)
- [ ] Status transitions are controlled
- [ ] All user input sanitized

### Logging & Monitoring

- [ ] Sensitive data (tokens) truncated in logs
- [ ] Security events logged (hash mismatch, ID mismatch)
- [ ] Session count available for monitoring

---

## 🚀 Quick Start for Agent

```bash
# 1. Clone and setup
git clone <repo>
cd Caishen
npm install

# 2. Check current test status
npm run test:all

# 3. Check git history
git log --oneline -20

# 4. Start implementing from Success Criteria
# Begin with SC-1.1, write test, implement, commit

# 5. After each commit, run full regression
npm run test:all
git log --oneline -5
```

---

**END OF PRD**

*This document serves as both specification and prompt for AI coding agents.*
