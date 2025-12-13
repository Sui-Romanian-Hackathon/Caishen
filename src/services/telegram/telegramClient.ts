import axios from 'axios';
import { config } from '../../config/env';
import logger from '../../utils/logger';
import { InlineKeyboardMarkup } from '@grammyjs/types';

const telegramApi = axios.create({
  baseURL: `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`,
  timeout: 5000
});

export async function sendMessage(params: {
  chatId: number | string;
  text: string;
  replyToMessageId?: number;
  keyboard?: InlineKeyboardMarkup;
}) {
  try {
    await telegramApi.post('/sendMessage', {
      chat_id: params.chatId,
      text: params.text,
      reply_to_message_id: params.replyToMessageId,
      reply_markup: params.keyboard,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    logger.error({ err }, 'Failed to send Telegram message');
  }
}

export async function setWebhook(url: string, secretToken: string) {
  try {
    await telegramApi.post('/setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['message', 'callback_query']
    });
    logger.info({ url }, 'Telegram webhook updated');
  } catch (err) {
    logger.error({ err }, 'Failed to set Telegram webhook');
    throw err;
  }
}
