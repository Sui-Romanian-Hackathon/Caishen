import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

async function ensureSchema(db: pg.Pool) {
  await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');

  await db.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      telegram_id text,
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

export function dbReady() {
  return Boolean(pool);
}

async function getDb(): Promise<pg.Pool> {
  if (!pool) {
    initDb();
  }
  if (!schemaReady) {
    schemaReady = ensureSchema(pool!);
  }
  await schemaReady;
  return pool!;
}

export async function insertTransaction(params: {
  telegramId?: string;
  txBytes?: string;
  status?: string;
  digest?: string;
}) {
  const db = await getDb();
  const result = await db.query(
    `INSERT INTO transactions (telegram_id, tx_bytes, status, digest)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      params.telegramId || null,
      params.txBytes || null,
      params.status || 'pending',
      params.digest || null,
    ]
  );
  return result.rows[0].id;
}

export async function updateTransactionStatus(params: { id: string; status: string; digest?: string }) {
  const db = await getDb();
  const result = await db.query(
    `UPDATE transactions
     SET status = $1, digest = COALESCE($2, digest), updated_at = NOW()
     WHERE id = $3`,
    [params.status, params.digest || null, params.id]
  );
  return result.rowCount! > 0;
}

export async function listTransactionsByTelegram(telegramId: string, limit = 50) {
  const db = await getDb();
  const result = await db.query(
    `SELECT id, telegram_id, status, digest, created_at, updated_at
     FROM transactions
     WHERE telegram_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [telegramId, limit]
  );
  return result.rows;
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
