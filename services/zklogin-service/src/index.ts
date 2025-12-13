import express from 'express';
import pino from 'pino';

const PORT = Number(process.env.PORT || 3004);
const SERVICE_NAME = 'zklogin-service';
const logger = pino({ name: SERVICE_NAME });

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: SERVICE_NAME, timestamp: new Date().toISOString() });
});

// Placeholder for zkLogin proof and salt workflows
app.post('/api/v1/zklogin/init', (req, res) => {
  logger.info({ body: req.body }, 'Received zkLogin init stub');
  res.json({
    status: 'stub',
    message: 'zkLogin service placeholder. Wire OAuth + prover integration here.',
    received: req.body ?? {}
  });
});

app.listen(PORT, () => {
  logger.info(`${SERVICE_NAME} listening on port ${PORT}`);
});
