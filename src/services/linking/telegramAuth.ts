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

/**
 * Verify Telegram Login Widget authentication data
 *
 * Security: This validates the HMAC-SHA256 hash to ensure the data
 * came from Telegram and wasn't tampered with.
 *
 * @see https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramAuth(authData: TelegramAuthData): {
  valid: boolean;
  error?: string;
  telegramId?: string;
} {
  try {
    const { hash, ...dataToCheck } = authData;

    // 1. Create data-check-string (alphabetically sorted key=value pairs)
    const dataCheckString = Object.keys(dataToCheck)
      .sort()
      .map(key => `${key}=${dataToCheck[key as keyof typeof dataToCheck]}`)
      .join('\n');

    // 2. Create secret key from bot token (SHA-256 hash)
    const secretKey = crypto
      .createHash('sha256')
      .update(config.TELEGRAM_BOT_TOKEN)
      .digest();

    // 3. Calculate HMAC-SHA256
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // 4. Compare hashes (timing-safe comparison)
    const hashesMatch = crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(calculatedHash, 'hex')
    );

    if (!hashesMatch) {
      logger.warn({ telegramId: authData.id }, 'Telegram auth hash mismatch');
      return { valid: false, error: 'Invalid authentication hash' };
    }

    // 5. Check auth_date to prevent replay attacks (max 5 minutes old)
    const authTime = authData.auth_date * 1000; // Convert to milliseconds
    const maxAge = 5 * 60 * 1000; // 5 minutes

    if (Date.now() - authTime > maxAge) {
      logger.warn({
        telegramId: authData.id,
        authDate: new Date(authTime).toISOString(),
        age: Math.round((Date.now() - authTime) / 1000) + 's'
      }, 'Telegram auth too old');
      return { valid: false, error: 'Authentication expired. Please try again.' };
    }

    logger.info({
      telegramId: authData.id,
      username: authData.username
    }, 'Telegram auth verified successfully');

    return {
      valid: true,
      telegramId: String(authData.id)
    };

  } catch (err) {
    logger.error({ err }, 'Telegram auth verification failed');
    return { valid: false, error: 'Verification failed' };
  }
}

/**
 * Parse Telegram auth data from URL query params or JSON
 */
export function parseTelegramAuthData(data: Record<string, string | number>): TelegramAuthData | null {
  try {
    // Required fields
    if (!data.id || !data.auth_date || !data.hash) {
      return null;
    }

    return {
      id: Number(data.id),
      first_name: data.first_name ? String(data.first_name) : undefined,
      last_name: data.last_name ? String(data.last_name) : undefined,
      username: data.username ? String(data.username) : undefined,
      photo_url: data.photo_url ? String(data.photo_url) : undefined,
      auth_date: Number(data.auth_date),
      hash: String(data.hash)
    };

  } catch {
    return null;
  }
}
