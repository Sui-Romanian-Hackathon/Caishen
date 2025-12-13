import crypto from 'crypto';
import logger from '../../utils/logger';

export interface PendingTransaction {
  id: string;
  userId: string;
  recipient: string;
  amount: number;
  memo?: string;
  sender: string;
  mode: 'wallet' | 'zklogin';
  salt?: string;
  createdAt: number;
  expiresAt: number;
}

// In-memory store with automatic expiration
// For production, consider using Redis with TTL
const store = new Map<string, PendingTransaction>();

// Clean up expired transactions every minute
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, tx] of store) {
    if (tx.expiresAt < now) {
      store.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug({ cleaned }, 'Cleaned expired pending transactions');
  }
}, 60_000);

/**
 * Create a pending transaction with a unique ID
 * Expires after 15 minutes by default
 */
export function createPendingTransaction(
  params: Omit<PendingTransaction, 'id' | 'createdAt' | 'expiresAt'>,
  ttlMinutes = 15
): PendingTransaction {
  const id = crypto.randomBytes(16).toString('hex');
  const now = Date.now();

  const tx: PendingTransaction = {
    ...params,
    id,
    createdAt: now,
    expiresAt: now + ttlMinutes * 60 * 1000
  };

  store.set(id, tx);
  logger.info({ txId: id, recipient: tx.recipient, amount: tx.amount }, 'Created pending transaction');

  return tx;
}

/**
 * Get a pending transaction by ID
 * Returns null if not found or expired
 */
export function getPendingTransaction(id: string): PendingTransaction | null {
  const tx = store.get(id);

  if (!tx) {
    return null;
  }

  // Check expiration
  if (tx.expiresAt < Date.now()) {
    store.delete(id);
    return null;
  }

  return tx;
}

/**
 * Delete a pending transaction (e.g., after signing)
 */
export function deletePendingTransaction(id: string): boolean {
  return store.delete(id);
}

/**
 * Get count of active pending transactions (for monitoring)
 */
export function getPendingCount(): number {
  return store.size;
}
