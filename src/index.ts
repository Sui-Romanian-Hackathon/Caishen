import { config } from './config/env';
import { createServer } from './server';
import logger from './utils/logger';
import { ensureWebhook } from './services/telegram/webhook';

async function bootstrap() {
  const app = createServer();

  app.listen(config.PORT, async () => {
    logger.info(`Server listening on port ${config.PORT}`);

    try {
      await ensureWebhook();
    } catch (err) {
      logger.error({ err }, 'Failed to ensure Telegram webhook');
    }
  });
}

bootstrap();
