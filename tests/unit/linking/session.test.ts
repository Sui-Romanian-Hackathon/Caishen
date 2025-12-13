/**
 * SC-1: Linking Session Management Tests
 * 
 * SUCCESS CRITERIA:
 * - SC-1.1: Session created with 15-min TTL
 * - SC-1.2: Session retrievable by token
 * - SC-1.3: Expired sessions return null
 * - SC-1.4: One session per telegram_id (old invalidated)
 * - SC-1.5: Session auto-cleanup runs every 60s
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createLinkingSession,
  getLinkingSession,
  getLinkingSessionByTelegramId,
  getLinkingSessionCount,
  clearAllSessions,
  stopCleanupTimer,
  startCleanupTimer
} from '../../../src/services/linking/linkingStore';

describe('SC-1: Linking Session Management', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAllSessions();
  });

  afterEach(() => {
    vi.useRealTimers();
    stopCleanupTimer();
  });

  // =========================================================================
  // SC-1.1: Session created with 15-min TTL
  // =========================================================================
  describe('SC-1.1: Session created with 15-min TTL', () => {
    it('should create session with default 15-minute expiration', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const session = createLinkingSession('123456', 'testuser', 'TestName');

      expect(session.expiresAt).toBe(now + 15 * 60 * 1000);
      expect(session.status).toBe('pending_wallet');
    });

    it('should allow custom TTL', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const session = createLinkingSession('123456', 'testuser', 'TestName', 30);

      expect(session.expiresAt).toBe(now + 30 * 60 * 1000);
    });

    it('should generate cryptographically random token', () => {
      const session1 = createLinkingSession('111', 'user1', 'User1');
      const session2 = createLinkingSession('222', 'user2', 'User2');

      expect(session1.token).not.toBe(session2.token);
      expect(session1.token.length).toBeGreaterThan(20);
    });
  });

  // =========================================================================
  // SC-1.2: Session retrievable by token
  // =========================================================================
  describe('SC-1.2: Session retrievable by token', () => {
    it('should retrieve session by token', () => {
      const created = createLinkingSession('123456', 'testuser', 'TestName');
      const retrieved = getLinkingSession(created.token);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.telegramId).toBe('123456');
      expect(retrieved?.telegramUsername).toBe('testuser');
    });

    it('should return null for non-existent token', () => {
      const retrieved = getLinkingSession('non-existent-token');
      expect(retrieved).toBeNull();
    });

    it('should retrieve session by telegram ID', () => {
      const created = createLinkingSession('123456', 'testuser', 'TestName');
      const retrieved = getLinkingSessionByTelegramId('123456');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.token).toBe(created.token);
    });
  });

  // =========================================================================
  // SC-1.3: Expired sessions return null
  // =========================================================================
  describe('SC-1.3: Expired sessions return null', () => {
    it('should return null for expired session', () => {
      const session = createLinkingSession('123456', 'testuser', 'TestName');

      // Advance time past expiration (16 minutes)
      vi.advanceTimersByTime(16 * 60 * 1000);

      const retrieved = getLinkingSession(session.token);
      expect(retrieved).toBeNull();
    });

    it('should return session if not yet expired', () => {
      const session = createLinkingSession('123456', 'testuser', 'TestName');

      // Advance time to just before expiration (14 minutes)
      vi.advanceTimersByTime(14 * 60 * 1000);

      const retrieved = getLinkingSession(session.token);
      expect(retrieved).not.toBeNull();
    });

    it('should clean up by-telegram-id index when session expires', () => {
      createLinkingSession('123456', 'testuser', 'TestName');

      // Advance time past expiration
      vi.advanceTimersByTime(16 * 60 * 1000);

      const byId = getLinkingSessionByTelegramId('123456');
      expect(byId).toBeNull();
    });
  });

  // =========================================================================
  // SC-1.4: One session per telegram_id (old invalidated)
  // =========================================================================
  describe('SC-1.4: One session per telegram_id', () => {
    it('should invalidate old session when creating new for same user', () => {
      const session1 = createLinkingSession('123456', 'user1', 'User');
      const token1 = session1.token;

      const session2 = createLinkingSession('123456', 'user1', 'User');
      const token2 = session2.token;

      // Old session should be gone
      expect(getLinkingSession(token1)).toBeNull();
      // New session should exist
      expect(getLinkingSession(token2)).not.toBeNull();
    });

    it('should not affect sessions of other users', () => {
      const session1 = createLinkingSession('111', 'user1', 'User1');
      const session2 = createLinkingSession('222', 'user2', 'User2');

      // Both sessions should exist
      expect(getLinkingSession(session1.token)).not.toBeNull();
      expect(getLinkingSession(session2.token)).not.toBeNull();
    });

    it('should update by-telegram-id index to point to new session', () => {
      createLinkingSession('123456', 'user1', 'User');
      const session2 = createLinkingSession('123456', 'user1', 'User');

      const byId = getLinkingSessionByTelegramId('123456');
      expect(byId?.token).toBe(session2.token);
    });
  });

  // =========================================================================
  // SC-1.5: Session auto-cleanup runs every 60s
  // =========================================================================
  describe('SC-1.5: Session auto-cleanup', () => {
    it('should clean up expired sessions on interval', () => {
      startCleanupTimer();

      // Create session with very short TTL
      createLinkingSession('123456', 'testuser', 'TestName', 1); // 1 minute

      expect(getLinkingSessionCount()).toBe(1);

      // Advance time past TTL but before cleanup (30 seconds)
      vi.advanceTimersByTime(30 * 1000);
      expect(getLinkingSessionCount()).toBe(1); // Still there

      // Advance to 2 minutes (past TTL and past cleanup interval)
      vi.advanceTimersByTime(90 * 1000);
      expect(getLinkingSessionCount()).toBe(0); // Cleaned up
    });

    it('should not clean up non-expired sessions', () => {
      startCleanupTimer();

      createLinkingSession('123456', 'testuser', 'TestName', 15);

      // Advance 5 cleanup intervals (5 minutes)
      vi.advanceTimersByTime(5 * 60 * 1000);

      expect(getLinkingSessionCount()).toBe(1);
    });
  });
});

