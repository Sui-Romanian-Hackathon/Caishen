import express from 'express';
import pino from 'pino';

const PORT = Number(process.env.PORT || 3006);
const SERVICE_NAME = 'notification-service';
const logger = pino({ name: SERVICE_NAME });

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: SERVICE_NAME, timestamp: new Date().toISOString() });
});

// Placeholder for webhook + push delivery
app.post('/api/v1/notifications/dispatch', (req, res) => {
  logger.info({ body: req.body }, 'Received notification stub');
  res.json({
    status: 'stub',
    message: 'Notification service placeholder. Connect Redis/queues here.'
  });
});

app.listen(PORT, () => {
  logger.info(`${SERVICE_NAME} listening on port ${PORT}`);
});
