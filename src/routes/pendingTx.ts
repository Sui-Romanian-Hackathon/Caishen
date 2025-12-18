import { Router, Request, Response, NextFunction } from 'express';
import { getPendingTransaction, deletePendingTransaction, getPendingCount } from '../services/pending/pendingTxStore';
import logger from '../utils/logger';

const router = Router();

// Simple in-memory rate limiter (per IP)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute per IP

function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  let entry = rateLimitMap.get(ip);

  // Reset if window expired
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }

  entry.count++;

  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    logger.warn({ ip, count: entry.count }, 'Rate limit exceeded for pending-tx API');
    res.status(429).json({ error: 'Too many requests. Try again later.' });
    return;
  }

  next();
}

// Clean up old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (entry.resetAt < now) {
      rateLimitMap.delete(ip);
    }
  }
}, 300_000);

/**
 * GET /api/pending-tx/:id
 * Fetch a pending transaction by ID (ONE-TIME USE)
 * Returns transaction details if valid and not expired
 * SECURITY: Transaction is consumed after first fetch to prevent link sharing/interception
 * SECURITY: Rate limited to 10 requests/minute per IP
 */
router.get('/api/pending-tx/:id', rateLimiter, (req, res) => {
  const { id } = req.params;

  if (!id || typeof id !== 'string' || id.length !== 32) {
    res.status(400).json({ error: 'Invalid transaction ID format' });
    return;
  }

  const tx = getPendingTransaction(id);

  if (!tx) {
    logger.warn({ txId: id }, 'Pending transaction not found or expired');
    res.status(404).json({ error: 'Transaction not found or expired' });
    return;
  }

  // SECURITY: Consume token after first fetch (one-time use)
  // This prevents link sharing, interception, or replay attacks
  deletePendingTransaction(id);
  logger.info({ txId: id }, 'Pending transaction consumed on fetch (one-time use)');

  // Return transaction details (excluding internal fields)
  res.json({
    id: tx.id,
    recipient: tx.recipient,
    amount: tx.amount,
    memo: tx.memo,
    sender: tx.sender,
    mode: tx.mode,
    salt: tx.salt,
    expiresAt: tx.expiresAt,
    telegramId: tx.userId // Needed so frontend can request zkLogin salt with correct tenant
  });
});

/**
 * DELETE /api/pending-tx/:id
 * Mark a pending transaction as consumed (after signing)
 */
router.delete('/api/pending-tx/:id', (req, res) => {
  const { id } = req.params;

  if (!id || typeof id !== 'string' || id.length !== 32) {
    res.status(400).json({ error: 'Invalid transaction ID format' });
    return;
  }

  const deleted = deletePendingTransaction(id);

  if (!deleted) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }

  logger.info({ txId: id }, 'Pending transaction consumed');
  res.json({ success: true });
});

/**
 * GET /api/pending-tx/stats
 * Get count of active pending transactions (for monitoring)
 */
router.get('/api/pending-tx-stats', (_req, res) => {
  res.json({ count: getPendingCount() });
});

export default router;
