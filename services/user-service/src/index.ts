import express from 'express';
import pino from 'pino';
import { ensureUser, initDb, listContacts, storeSession, upsertContact } from './db';
import { getOrCreateSalt, initSaltDb } from './saltDb';

const PORT = Number(process.env.PORT || 3005);
const SERVICE_NAME = 'user-service';
const logger = pino({ name: SERVICE_NAME });
const DB_INFO = process.env.DATABASE_URL || 'postgres';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: SERVICE_NAME,
    db: DB_INFO,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/v1/users/contacts/:telegramId', async (req, res) => {
  const telegramId = req.params.telegramId;
  if (!telegramId) {
    res.status(400).json({ error: 'telegramId required' });
    return;
  }
  try {
    const contacts = await listContacts(telegramId);
    res.json({ contacts });
  } catch (err) {
    logger.error({ err }, 'Failed to list contacts');
    res.status(500).json({ error: 'Failed to list contacts' });
  }
});

app.post('/api/v1/users/contacts', async (req, res) => {
  const { telegramId, alias, address, username } = req.body ?? {};
  if (!telegramId || !alias || !address) {
    res.status(400).json({ error: 'telegramId, alias, and address are required' });
    return;
  }

  try {
    await ensureUser(String(telegramId), username ? String(username) : undefined);
    const { contact, updated } = await upsertContact({
      telegramId: String(telegramId),
      alias: String(alias),
      address: String(address)
    });
    res.status(updated ? 200 : 201).json({ contact, updated });
  } catch (err) {
    logger.error({ err }, 'Failed to upsert contact');
    res.status(500).json({ error: 'Failed to upsert contact' });
  }
});

app.post('/api/v1/users/init', async (req, res) => {
  const { telegramId, username } = req.body ?? {};
  if (!telegramId) {
    res.status(400).json({ error: 'telegramId is required' });
    return;
  }
  try {
    await ensureUser(String(telegramId), username ? String(username) : undefined);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Failed to init user');
    res.status(500).json({ error: 'Failed to init user' });
  }
});

app.post('/api/v1/users/session', async (req, res) => {
  const { telegramId, tokenHash, expiresAt, username } = req.body ?? {};

  if (!telegramId || !tokenHash || !expiresAt) {
    res.status(400).json({ error: 'telegramId, tokenHash, and expiresAt are required' });
    return;
  }

  try {
    await ensureUser(String(telegramId), username ? String(username) : undefined);
    const id = await storeSession({
      telegramId: String(telegramId),
      tokenHash: String(tokenHash),
      expiresAt: String(expiresAt)
    });
    res.status(201).json({ id });
  } catch (err) {
    logger.error({ err }, 'Failed to store session');
    res.status(500).json({ error: 'Failed to store session' });
  }
});

app.post('/api/v1/zklogin/salt', async (req, res) => {
  const { telegramId, provider, subject, jwt } = req.body ?? {};
  if (!telegramId || !provider || (!subject && !jwt)) {
    res.status(400).json({ error: 'telegramId, provider and (subject or jwt) are required' });
    return;
  }
  try {
    await ensureUser(String(telegramId));
    const record = await getOrCreateSalt({
      telegramId: String(telegramId),
      provider: String(provider),
      subject: subject ? String(subject) : undefined,
      jwt: jwt ? String(jwt) : undefined
    });
    res.json(record);
  } catch (err) {
    logger.error({ err }, 'Failed to get/create salt');
    res.status(500).json({ error: 'Failed to get salt' });
  }
});

function start() {
  try {
    initDb();
    initSaltDb();
    logger.info({ database: DB_INFO }, 'Databases initialized');
  } catch (err) {
    logger.error({ err }, 'Failed to initialize database connections');
    process.exit(1);
  }

  app.listen(PORT, () => {
    logger.info(`${SERVICE_NAME} listening on port ${PORT}`);
  });
}

start();
