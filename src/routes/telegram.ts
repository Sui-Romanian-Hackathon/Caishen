import { Router } from 'express';
import { config } from '../config/env';
import logger from '../utils/logger';
import { handleTelegramUpdate } from '../services/telegram/updateHandler';
import { Update } from '@grammyjs/types';

const router = Router();
const webhookPaths = ['/webhook/telegram', '/api/v1/telegram/webhook'];

webhookPaths.forEach((path) =>
  router.post(path, async (req, res, next) => {
    try {
      const secretHeader = req.header('x-telegram-bot-api-secret-token');

      if (!secretHeader || secretHeader !== config.TELEGRAM_WEBHOOK_SECRET) {
        logger.warn('Rejected webhook call due to invalid secret token');
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      await handleTelegramUpdate(req.body as Update);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  })
);

export default router;
