/**
 * SC-3: Telegram Verification Tests
 * 
 * SUCCESS CRITERIA:
 * - SC-3.1: Valid HMAC hash accepted
 * - SC-3.2: Invalid hash rejected (401)
 * - SC-3.3: Telegram ID must match session creator
 * - SC-3.4: Auth older than 5 minutes rejected
 * - SC-3.5: Timing-safe comparison used
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { verifyTelegramAuth, parseTelegramAuthData, TelegramAuthData } from '../../../src/services/linking/telegramAuth';

// Mock the config
vi.mock('../../../src/config/env', () => ({
  config: {
    TELEGRAM_BOT_TOKEN: 'test_bot_token_123456789'
  }
}));

/**
 * Helper to create valid Telegram auth data
 */
function createValidAuthData(telegramId: number, overrides: Partial<TelegramAuthData> = {}): TelegramAuthData {
  const authDate = Math.floor(Date.now() / 1000); // Current time in seconds

  const data: Omit<TelegramAuthData, 'hash'> = {
    id: telegramId,
    first_name: 'Test',
    username: 'testuser',
    auth_date: authDate,
    ...overrides
  };

  // Calculate valid hash
  const dataCheckString = Object.keys(data)
    .sort()
    .map(key => `${key}=${data[key as keyof typeof data]}`)
    .join('\n');

  const secretKey = crypto
    .createHash('sha256')
    .update('test_bot_token_123456789')
    .digest();

  const hash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return { ...data, hash };
}

describe('SC-3: Telegram Verification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // SC-3.1: Valid HMAC hash accepted
  // =========================================================================
  describe('SC-3.1: Valid HMAC hash accepted', () => {
    it('should accept valid auth data', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const authData = createValidAuthData(123456);
      const result = verifyTelegramAuth(authData);

      expect(result.valid).toBe(true);
      expect(result.telegramId).toBe('123456');
      expect(result.error).toBeUndefined();
    });

    it('should return telegram ID as string', () => {
      vi.setSystemTime(Date.now());

      const authData = createValidAuthData(123456789);
      const result = verifyTelegramAuth(authData);

      expect(result.telegramId).toBe('123456789');
      expect(typeof result.telegramId).toBe('string');
    });
  });

  // =========================================================================
  // SC-3.2: Invalid hash rejected
  // =========================================================================
  describe('SC-3.2: Invalid hash rejected', () => {
    it('should reject tampered hash', () => {
      vi.setSystemTime(Date.now());

      const authData = createValidAuthData(123456);
      authData.hash = 'invalid_hash_' + 'a'.repeat(50);

      const result = verifyTelegramAuth(authData);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject if data was modified after signing', () => {
      vi.setSystemTime(Date.now());

      const authData = createValidAuthData(123456);
      authData.first_name = 'Modified'; // Tamper with data

      const result = verifyTelegramAuth(authData);

      expect(result.valid).toBe(false);
    });

    it('should reject malformed hash', () => {
      vi.setSystemTime(Date.now());

      const authData = createValidAuthData(123456);
      authData.hash = 'not-a-hex-string!!!';

      const result = verifyTelegramAuth(authData);

      expect(result.valid).toBe(false);
    });
  });

  // =========================================================================
  // SC-3.4: Auth older than 5 minutes rejected
  // =========================================================================
  describe('SC-3.4: Auth age validation', () => {
    it('should reject auth older than 5 minutes', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      // Create auth data from 6 minutes ago
      const sixMinutesAgo = Math.floor((now - 6 * 60 * 1000) / 1000);
      const authData = createValidAuthData(123456, { auth_date: sixMinutesAgo });

      const result = verifyTelegramAuth(authData);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should accept auth within 5 minutes', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      // Create auth data from 4 minutes ago
      const fourMinutesAgo = Math.floor((now - 4 * 60 * 1000) / 1000);
      const authData = createValidAuthData(123456, { auth_date: fourMinutesAgo });

      const result = verifyTelegramAuth(authData);

      expect(result.valid).toBe(true);
    });

    it('should accept fresh auth', () => {
      vi.setSystemTime(Date.now());

      const authData = createValidAuthData(123456);
      const result = verifyTelegramAuth(authData);

      expect(result.valid).toBe(true);
    });
  });

  // =========================================================================
  // SC-3.5: Timing-safe comparison used
  // =========================================================================
  describe('SC-3.5: Timing-safe comparison', () => {
    it('should use crypto.timingSafeEqual for hash comparison', () => {
      vi.setSystemTime(Date.now());

      const spy = vi.spyOn(crypto, 'timingSafeEqual');

      const authData = createValidAuthData(123456);
      verifyTelegramAuth(authData);

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // =========================================================================
  // parseTelegramAuthData tests
  // =========================================================================
  describe('parseTelegramAuthData', () => {
    it('should parse valid data', () => {
      const input = {
        id: 123456,
        first_name: 'Test',
        username: 'testuser',
        auth_date: 1234567890,
        hash: 'abc123'
      };

      const result = parseTelegramAuthData(input);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(123456);
      expect(result?.hash).toBe('abc123');
    });

    it('should return null for missing required fields', () => {
      const input = {
        id: 123456,
        first_name: 'Test'
        // missing auth_date and hash
      };

      const result = parseTelegramAuthData(input as any);

      expect(result).toBeNull();
    });

    it('should handle string to number conversion', () => {
      const input = {
        id: '123456',
        auth_date: '1234567890',
        hash: 'abc123'
      };

      const result = parseTelegramAuthData(input as any);

      expect(result?.id).toBe(123456);
      expect(result?.auth_date).toBe(1234567890);
    });
  });
});

