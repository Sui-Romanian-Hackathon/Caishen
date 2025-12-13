import express from 'express';
import cors from 'cors';
import telegramRouter from './routes/telegram';
import pendingTxRouter from './routes/pendingTx';
import linkingRouter from './routes/linking';
import logger from './utils/logger';

export function createServer() {
  const app = express();

  // Enable CORS for web-dapp requests
  app.use(cors({
    origin: [
      'https://caishen.iseethereaper.com',
      'http://localhost:5173', // Vite dev server
      'http://localhost:3000'
    ],
    methods: ['GET', 'DELETE'],
    credentials: false
  }));

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // API routes
  app.use(pendingTxRouter);
  app.use(linkingRouter);
  app.use(telegramRouter);

  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      logger.error({ err }, 'Unhandled error');
      res.status(500).json({ error: 'Internal server error' });
    }
  );

  return app;
}
