import express from 'express';
import pino from 'pino';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { dbReady, getDbPool, initDb, insertTransaction, listTransactionsByTelegram, updateTransactionStatus } from './db';
import { loadZkLoginConfig } from './config/zklogin.config';
import {
  AddressService,
  JwksCache,
  JwtValidator,
  ProofService,
  SaltRequest,
  SaltService,
  SaltStorage,
  ZkLoginError
} from './zklogin';

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
let saltService: SaltService;
let proofService: ProofService;
let addressService: AddressService;
let jwksCache: JwksCache | null = null;

function getRequestIp(req: express.Request): string | undefined {
  const headerIp = req.headers['x-forwarded-for'];
  if (typeof headerIp === 'string') {
    return headerIp.split(',')[0].trim();
  }
  if (Array.isArray(headerIp) && headerIp.length > 0) {
    return headerIp[0];
  }
  return req.ip;
}

function handleZkLoginError(err: unknown, res: express.Response, message: string) {
  if (err instanceof ZkLoginError) {
    if (err.retryAfter) {
      res.setHeader('Retry-After', String(err.retryAfter));
    }
    res.status(err.status).json({ error: err.message, retryAfter: err.retryAfter });
    return;
  }
  logger.error({ err }, message);
  res.status(500).json({ error: 'Internal server error' });
}

function bootstrapZkLogin() {
  const config = loadZkLoginConfig();
  jwksCache = new JwksCache(config.jwksUrl, config.jwksCacheTtlMs);

  const validator = new JwtValidator({
    allowedIssuers: config.salt.allowedIssuers,
    allowedAudiences: config.salt.allowedAudiences,
    jwksCache,
    skipSignatureVerification: config.salt.skipSignatureVerification
  });

  const dbPool = getDbPool();
  const storage = new SaltStorage({
    encryptionKey: config.encryptionKey,
    db: dbPool,
    useInMemory: process.env.NODE_ENV === 'test'
  });

  saltService = new SaltService({
    config: config.salt,
    validator,
    storage,
    logger
  });

  proofService = new ProofService({
    rateLimits: config.rateLimits,
    proverUrl: config.proverUrl,
    timeoutMs: config.proverTimeoutMs,
    logger
  });

  addressService = new AddressService({
    validator,
    storage,
    logger
  });
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  const jwksStatus = jwksCache
    ? {
        healthy: true,
        expired: jwksCache.isExpired(),
        cachedKeys: jwksCache.snapshot()?.keys.length ?? 0
      }
    : { healthy: false };

  const healthy = dbReady() && jwksStatus.healthy;
  res.json({
    status: healthy ? 'ok' : 'degraded',
    service: SERVICE_NAME,
    dbReady: dbReady(),
    jwksCache: jwksStatus,
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

app.post('/api/v1/tx/log', async (req, res) => {
  const { telegramId, txBytes, status, digest } = req.body ?? {};
  if (!telegramId) {
    res.status(400).json({ error: 'telegramId is required' });
    return;
  }
  try {
    const id = await insertTransaction({
      telegramId: String(telegramId),
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

app.post('/api/v1/tx/status', async (req, res) => {
  const { id, status, digest, telegramId } = req.body ?? {};
  if (!id || !status || !telegramId) {
    res.status(400).json({ error: 'id, telegramId, and status are required' });
    return;
  }

  try {
    const updated = await updateTransactionStatus({
      id: String(id),
      status: String(status),
      digest: digest ? String(digest) : undefined,
      telegramId: String(telegramId)
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

app.get('/api/v1/tx/history/:telegramId', async (req, res) => {
  const telegramId = req.params.telegramId;
  const limit = Number(req.query.limit ?? 50);
  if (!telegramId) {
    res.status(400).json({ error: 'telegramId required' });
    return;
  }
  try {
    const history = await listTransactionsByTelegram(
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

app.post('/api/v1/zklogin/salt', async (req, res) => {
  try {
    const payload = req.body as SaltRequest;
    const result = await saltService.getSalt(payload);
    res.json(result);
  } catch (err) {
    handleZkLoginError(err, res, 'Salt request failed');
  }
});

app.post('/api/v1/zklogin/proof', async (req, res) => {
  try {
    const ip = getRequestIp(req);
    const result = await proofService.generateProof(req.body, { ip });
    res.json(result);
  } catch (err) {
    handleZkLoginError(err, res, 'Proof request failed');
  }
});

app.post('/api/v1/zklogin/verify-address', async (req, res) => {
  try {
    const { telegramId, jwt, salt, keyClaimName } = req.body ?? {};
    const result = await addressService.verifyAddress({
      telegramId,
      jwt,
      salt,
      keyClaimName
    });
    if (!result.matches) {
      res.status(403).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    handleZkLoginError(err, res, 'Address verification failed');
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

  try {
    bootstrapZkLogin();
    logger.info('zkLogin services initialized');
  } catch (err) {
    logger.error({ err }, 'Failed to initialize zkLogin services');
    process.exit(1);
  }

  app.listen(PORT, () => {
    logger.info(`${SERVICE_NAME} listening on port ${PORT}`);
  });
}

start();
