import { Router, Request, Response, NextFunction } from 'express';
import {
  getLinkingSession,
  updateLinkingSession,
  completeLinkingSession,
  getLinkingSessionCount
} from '../services/linking/linkingStore';
import { verifyTelegramAuth, parseTelegramAuthData } from '../services/linking/telegramAuth';
import { sessionStore } from '../services/session/sessionStore';
import { upsertZkloginSalt } from '../services/database/postgres';
import logger from '../utils/logger';

const router = Router();

// Rate limiter for linking endpoints
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;

function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  next();
}

/**
 * GET /api/link/:token
 * Get linking session status (for web-dapp to check if token is valid)
 */
router.get('/api/link/:token', rateLimiter, (req, res) => {
  const { token } = req.params;

  const session = getLinkingSession(token);
  if (!session) {
    res.status(404).json({ error: 'Linking session not found or expired' });
    return;
  }

  // Return public session info (hide sensitive data)
  res.json({
    token: session.token,
    telegramUsername: session.telegramUsername,
    telegramFirstName: session.telegramFirstName,
    status: session.status,
    expiresAt: session.expiresAt,
    // Only show wallet info if already connected
    walletAddress: session.walletAddress ? session.walletAddress.slice(0, 10) + '...' : null,
    walletType: session.walletType
  });
});

/**
 * POST /api/link/:token/wallet
 * Connect a wallet to the linking session
 * Body: { walletAddress, walletType, zkLoginSalt?, zkLoginSub? }
 */
router.post('/api/link/:token/wallet', rateLimiter, async (req, res) => {
  const { token } = req.params;
  const { walletAddress, walletType, zkLoginSalt, zkLoginSub } = req.body;

  const session = getLinkingSession(token);
  if (!session) {
    res.status(404).json({ error: 'Linking session not found or expired' });
    return;
  }

  if (session.status !== 'pending_wallet') {
    res.status(400).json({ error: 'Wallet already connected or session in wrong state' });
    return;
  }

  // Validate wallet address format
  if (!walletAddress || typeof walletAddress !== 'string' || !/^0x[a-fA-F0-9]{40,64}$/.test(walletAddress)) {
    res.status(400).json({ error: 'Invalid wallet address format' });
    return;
  }

  // Validate wallet type
  if (!['zklogin', 'slush', 'external'].includes(walletType)) {
    res.status(400).json({ error: 'Invalid wallet type' });
    return;
  }

  if (walletType === 'zklogin') {
    if (!zkLoginSalt || !zkLoginSub) {
      res.status(400).json({ error: 'zkLoginSalt and zkLoginSub are required for zklogin wallets' });
      return;
    }

    try {
      await upsertZkloginSalt({
        telegramId: session.telegramId,
        provider: 'google',
        subject: String(zkLoginSub),
        salt: String(zkLoginSalt),
        audience: process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID,
        derivedAddress: walletAddress,
        keyClaimName: 'sub'
      });
    } catch (err) {
      logger.error(
        { err, token: token.slice(0, 8) + '...', telegramId: session.telegramId },
        'Failed to persist zkLogin salt during linking'
      );
      res.status(500).json({ error: 'Failed to store zkLogin salt. Please try again.' });
      return;
    }
  }

  // Update session with wallet info
  const updated = updateLinkingSession(token, {
    walletAddress,
    walletType,
    zkLoginSalt: walletType === 'zklogin' ? zkLoginSalt : undefined,
    zkLoginSub: walletType === 'zklogin' ? zkLoginSub : undefined,
    status: 'pending_telegram_confirm'
  });

  if (!updated) {
    res.status(500).json({ error: 'Failed to update session' });
    return;
  }

  logger.info({
    token: token.slice(0, 8) + '...',
    walletType,
    walletAddress: walletAddress.slice(0, 10) + '...'
  }, 'Wallet connected to linking session');

  res.json({
    success: true,
    status: 'pending_telegram_confirm',
    message: 'Now verify your Telegram account using the login widget'
  });
});

/**
 * POST /api/link/:token/telegram-verify
 * Verify Telegram identity and complete the linking
 * Body: Telegram Login Widget auth data (id, first_name, username, auth_date, hash)
 */
router.post('/api/link/:token/telegram-verify', rateLimiter, async (req, res) => {
  const { token } = req.params;
  const authData = parseTelegramAuthData(req.body);

  if (!authData) {
    res.status(400).json({ error: 'Invalid Telegram auth data' });
    return;
  }

  const session = getLinkingSession(token);
  if (!session) {
    res.status(404).json({ error: 'Linking session not found or expired' });
    return;
  }

  if (session.status !== 'pending_telegram_confirm') {
    res.status(400).json({ error: 'Connect wallet first before verifying Telegram' });
    return;
  }

  // Verify Telegram auth hash
  const verification = verifyTelegramAuth(authData);
  if (!verification.valid) {
    res.status(401).json({ error: verification.error || 'Telegram verification failed' });
    return;
  }

  // CRITICAL: Verify the Telegram ID matches the one who started the flow
  if (verification.telegramId !== session.telegramId) {
    logger.warn({
      expected: session.telegramId,
      received: verification.telegramId
    }, 'Telegram ID mismatch - possible attack');
    res.status(403).json({
      error: 'Telegram account does not match. You must use the same Telegram account that started this linking process.'
    });
    return;
  }

  // Complete the linking!
  const completed = completeLinkingSession(token);
  if (!completed) {
    res.status(500).json({ error: 'Failed to complete linking' });
    return;
  }

  // Update the session store with the linked wallet
  if (completed.walletAddress) {
    await sessionStore.setWallet(
      completed.telegramId,
      completed.walletAddress,
      completed.walletType || 'manual'
    );
  }

  logger.info({
    telegramId: completed.telegramId,
    telegramUsername: completed.telegramUsername,
    walletAddress: completed.walletAddress,
    walletType: completed.walletType
  }, 'Account linking completed successfully');

  res.json({
    success: true,
    status: 'completed',
    message: 'Your wallet is now linked to your Telegram account!',
    walletAddress: completed.walletAddress,
    telegramUsername: completed.telegramUsername
  });
});

/**
 * GET /api/link-stats
 * Get count of active linking sessions (for monitoring)
 */
router.get('/api/link-stats', (_req, res) => {
  res.json({ activeSessions: getLinkingSessionCount() });
});

export default router;
