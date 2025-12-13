import express from 'express';
import pino from 'pino';

const PORT = Number(process.env.PORT || 3002);
const SERVICE_NAME = 'nlp-service';
const logger = pino({ name: SERVICE_NAME });

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: SERVICE_NAME, timestamp: new Date().toISOString() });
});

// Placeholder endpoint until LLM tool orchestration is wired
app.post('/api/v1/nlp/intent', (req, res) => {
  logger.info({ body: req.body }, 'Received NLP stub request');
  res.json({
    intent: 'stub',
    message: 'NLP service placeholder. Wire Gemini/Caishen prompt here.',
    received: req.body ?? {}
  });
});

app.listen(PORT, () => {
  logger.info(`${SERVICE_NAME} listening on port ${PORT}`);
});
