import express from 'express';
import pino from 'pino';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import {
  dbReady,
  initDb,
  insertTransaction,
  listTransactionsByTelegram,
  updateTransactionStatus
} from './db';

const PORT = Number(process.env.PORT || 3003);
const SUI_NETWORK = (process.env.SUI_NETWORK as 'mainnet' | 'testnet' | 'devnet') || 'testnet';

// Sui client for gas estimation
const suiClient = new SuiClient({ url: getFullnodeUrl(SUI_NETWORK) });

// Gas budget defaults
const DEFAULT_SUI_TRANSFER_GAS = 15_000_000;
const DEFAULT_TOKEN_TRANSFER_GAS = 20_000_000;

async function estimateGasBudget(params: { type: 'sui' | 'token' | 'nft'; sender: string }) {
  const referenceGasPrice = await suiClient.getReferenceGasPrice();
  const base =
    params.type === 'sui'
      ? DEFAULT_SUI_TRANSFER_GAS
      : params.type === 'token'
        ? DEFAULT_TOKEN_TRANSFER_GAS
        : DEFAULT_SUI_TRANSFER_GAS;

  return {
    suggestedGasBudget: base,
    referenceGasPrice
  };
}
const SERVICE_NAME = 'transaction-builder';
const logger = pino({ name: SERVICE_NAME });

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: SERVICE_NAME,
    dbReady: dbReady(),
    timestamp: new Date().toISOString()
  });
});

// Placeholder for unsigned tx construction
app.post('/api/v1/tx/preview', (req, res) => {
  logger.info({ body: req.body }, 'Received transaction build stub');
  res.json({
    status: 'stub',
    message: 'Transaction builder placeholder. Wire Sui SDK here.',
    received: req.body ?? {}
  });
});

app.post('/api/v1/tx/log', (req, res) => {
  const { telegramId, txBytes, status, digest } = req.body ?? {};
  try {
    const id = insertTransaction({
      telegramId: telegramId ? String(telegramId) : undefined,
      txBytes: txBytes ? String(txBytes) : undefined,
      status: status ? String(status) : undefined,
      digest: digest ? String(digest) : undefined
    });
    res.status(201).json({ id });
  } catch (err) {
    logger.error({ err }, 'Failed to insert transaction log');
    res.status(500).json({ error: 'Failed to log transaction' });
  }
});

app.post('/api/v1/tx/status', (req, res) => {
  const { id, status, digest } = req.body ?? {};
  if (!id || !status) {
    res.status(400).json({ error: 'id and status are required' });
    return;
  }

  try {
    const updated = updateTransactionStatus({
      id: String(id),
      status: String(status),
      digest: digest ? String(digest) : undefined
    });
    if (!updated) {
      res.status(404).json({ error: 'transaction not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Failed to update transaction status');
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

app.get('/api/v1/tx/history/:telegramId', (req, res) => {
  const telegramId = req.params.telegramId;
  const limit = Number(req.query.limit ?? 50);
  if (!telegramId) {
    res.status(400).json({ error: 'telegramId required' });
    return;
  }
  try {
    const history = listTransactionsByTelegram(
      String(telegramId),
      Number.isFinite(limit) ? limit : 50
    );
    res.json({ history });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch history');
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

app.post('/api/v1/tx/estimate', async (req, res) => {
  const { sender, type } = req.body ?? {};
  if (!sender || !type) {
    res.status(400).json({ error: 'sender and type are required' });
    return;
  }
  try {
    const result = await estimateGasBudget({ type, sender });
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Failed to estimate gas');
    res.status(500).json({ error: 'Failed to estimate gas' });
  }
});

function start() {
  try {
    initDb();
    logger.info('PostgreSQL pool initialized');
  } catch (err) {
    logger.error({ err }, 'Failed to initialize database');
    process.exit(1);
  }

  app.listen(PORT, () => {
    logger.info(`${SERVICE_NAME} listening on port ${PORT}`);
  });
}

start();
