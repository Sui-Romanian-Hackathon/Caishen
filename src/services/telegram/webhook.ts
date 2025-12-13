import { config } from '../../config/env';
import logger from '../../utils/logger';
import { setWebhook } from './telegramClient';

export async function ensureWebhook() {
  if (!config.WEBHOOK_BASE_URL) {
    logger.info('WEBHOOK_BASE_URL not configured, skipping webhook registration');
    return;
  }

  const base = config.WEBHOOK_BASE_URL.replace(/\/+$/, '');
  const webhookUrl = `${base}/webhook/telegram`;

  await setWebhook(webhookUrl, config.TELEGRAM_WEBHOOK_SECRET);
}
