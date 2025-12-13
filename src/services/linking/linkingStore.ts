import crypto from 'crypto';
import logger from '../../utils/logger';

export interface LinkingSession {
  token: string;
  telegramId: string;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  createdAt: number;
  expiresAt: number;
  // Wallet info (filled after user connects wallet)
  walletAddress?: string;
  walletType?: 'zklogin' | 'slush' | 'external';
  // zkLogin-specific (filled after Google OAuth)
  zkLoginSalt?: string;
  zkLoginSub?: string;  // Google subject ID
  // Status
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

// Start cleanup on module load
startCleanupTimer();

/**
 * Create a new linking session for a Telegram user
 * Expires after 15 minutes by default
 */
export function createLinkingSession(
  telegramId: string,
  telegramUsername: string | null,
  telegramFirstName: string | null,
  ttlMinutes = 15
): LinkingSession {
  // Invalidate any existing session for this user
  const existingToken = byTelegramId.get(telegramId);
  if (existingToken) {
    store.delete(existingToken);
  }

  const token = crypto.randomBytes(24).toString('base64url'); // URL-safe token
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
    telegramUsername
  }, 'Created linking session');

  return session;
}

/**
 * Get a linking session by token
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
 * Get linking session by Telegram ID
 */
export function getLinkingSessionByTelegramId(telegramId: string): LinkingSession | null {
  const token = byTelegramId.get(telegramId);
  if (!token) return null;
  return getLinkingSession(token);
}

/**
 * Update a linking session (e.g., after wallet connection)
 */
export function updateLinkingSession(
  token: string,
  updates: Partial<Omit<LinkingSession, 'token' | 'telegramId' | 'createdAt' | 'expiresAt'>>
): LinkingSession | null {
  const session = getLinkingSession(token);
  if (!session) return null;

  Object.assign(session, updates);
  store.set(token, session);

  logger.info({
    token: token.slice(0, 8) + '...',
    status: session.status,
    walletType: session.walletType
  }, 'Updated linking session');

  return session;
}

/**
 * Complete the linking process - mark as done and return final session
 * Session is kept for a short time for confirmation, then cleaned up
 */
export function completeLinkingSession(token: string): LinkingSession | null {
  const session = getLinkingSession(token);
  if (!session) return null;

  session.status = 'completed';
  store.set(token, session);

  // Clean up after 5 minutes (allow time for confirmation messages)
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
 * Delete a linking session
 */
export function deleteLinkingSession(token: string): boolean {
  const session = store.get(token);
  if (session) {
    byTelegramId.delete(session.telegramId);
  }
  return store.delete(token);
}

/**
 * Get count of active sessions (for monitoring)
 */
export function getLinkingSessionCount(): number {
  return store.size;
}
