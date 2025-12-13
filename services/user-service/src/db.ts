import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

async function ensureSchema(db: pg.Pool) {
  await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');

  // Ensure contacts upsert works and transactions table exists for shared use
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_telegram_alias ON contacts (telegram_id, alias);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      telegram_id text REFERENCES users(telegram_id) ON DELETE SET NULL,
      tx_bytes text,
      status text NOT NULL DEFAULT 'pending',
      digest text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_transactions_telegram_id ON transactions (telegram_id);`
  );
}

export function initDb() {
  if (pool) return;

  // Prefer individual parameters to avoid URL-encoding issues with special chars in passwords
  const host = process.env.POSTGRES_HOST || process.env.PGHOST;
  const port = process.env.POSTGRES_PORT || process.env.PGPORT;
  const user = process.env.POSTGRES_USER || process.env.PGUSER;
  const password = process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD;
  const database = process.env.POSTGRES_DB || process.env.PGDATABASE;

  if (host && user && database) {
    pool = new Pool({
      host,
      port: port ? parseInt(port, 10) : 5432,
      user,
      password,
      database,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  } else {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('Database config required: set POSTGRES_HOST/USER/DB or DATABASE_URL');
    }
    pool = new Pool({
      connectionString: dbUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  pool.on('error', (err: Error) => {
    console.error('Unexpected PostgreSQL pool error:', err);
  });

  schemaReady = ensureSchema(pool);
}

function getDb(): pg.Pool {
  if (!pool) {
    initDb();
  }
  return pool!;
}

async function waitSchema() {
  if (!schemaReady) {
    schemaReady = ensureSchema(getDb());
  }
  await schemaReady;
}

export async function ensureUser(telegramId: string, username?: string) {
  const db = getDb();
  await waitSchema();
  await db.query(
    `INSERT INTO users (telegram_id, username, last_seen_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (telegram_id) DO UPDATE SET
       username = COALESCE($2, users.username),
       last_seen_at = NOW()`,
    [telegramId, username || null]
  );
}

export async function upsertContact(params: { telegramId: string; alias: string; address: string }) {
  const db = getDb();
  await waitSchema();
  
  // Ensure user exists first
  await ensureUser(params.telegramId);

  // Case-insensitive alias lookup to avoid duplicates before a unique index exists
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM contacts WHERE telegram_id = $1 AND lower(alias) = lower($2) LIMIT 1`,
    [params.telegramId, params.alias]
  );

  if (existing.rows[0]) {
    const result = await db.query(
      `UPDATE contacts SET address = $1 WHERE id = $2
       RETURNING id, alias, address, created_at`,
      [params.address, existing.rows[0].id]
    );
    return {
      contact: result.rows[0],
      updated: true
    };
  }

  const result = await db.query(
    `INSERT INTO contacts (telegram_id, alias, address)
     VALUES ($1, $2, $3)
     RETURNING id, alias, address, created_at`,
    [params.telegramId, params.alias, params.address]
  );

  return {
    contact: result.rows[0],
    updated: false
  };
}

export async function listContacts(telegramId: string) {
  const db = getDb();
  await waitSchema();
  const result = await db.query(
    `SELECT id, alias, address, created_at 
     FROM contacts 
     WHERE telegram_id = $1 
     ORDER BY created_at DESC`,
    [telegramId]
  );
  return result.rows;
}

export async function deleteContact(telegramId: string, alias: string) {
  const db = getDb();
  await waitSchema();
  const result = await db.query(
    'DELETE FROM contacts WHERE telegram_id = $1 AND alias = $2 RETURNING id',
    [telegramId, alias]
  );
  return result.rowCount! > 0;
}

export async function storeSession(params: { telegramId: string; tokenHash: string; expiresAt: string }) {
  const db = getDb();
  await waitSchema();
  const result = await db.query(
    `INSERT INTO sessions (telegram_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [params.telegramId, params.tokenHash, params.expiresAt]
  );
  return result.rows[0].id;
}

export async function validateSession(tokenHash: string): Promise<string | null> {
  const db = getDb();
  await waitSchema();
  const result = await db.query(
    `SELECT telegram_id FROM sessions 
     WHERE token_hash = $1 AND expires_at > NOW()`,
    [tokenHash]
  );
  return result.rows[0]?.telegram_id || null;
}

export async function deleteExpiredSessions() {
  const db = getDb();
  await waitSchema();
  await db.query('DELETE FROM sessions WHERE expires_at < NOW()');
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
