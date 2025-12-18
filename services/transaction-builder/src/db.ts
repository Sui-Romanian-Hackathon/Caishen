import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

async function ensureSchema(db: pg.Pool) {
  await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
}

export function initDb() {
  if (pool) return;

  // Prefer individual parameters to avoid URL-encoding issues with special chars in passwords
  const host = process.env.POSTGRES_HOST || process.env.PGHOST;
  const port = process.env.POSTGRES_PORT || process.env.PGPORT || '5432';
  const user = process.env.POSTGRES_USER || process.env.PGUSER;
  const password = process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD;
  const database = process.env.POSTGRES_DB || process.env.PGDATABASE;

  // Build connection string from POSTGRES_* when user is provided, even if DATABASE_URL exists.
  // This avoids breakage when DATABASE_URL has unsafe characters (e.g., unencoded '/').
  if (user) {
    const encodedPassword = password ? encodeURIComponent(password) : '';
    const connectionString =
      host && database
        ? `postgresql://${encodeURIComponent(user)}${encodedPassword ? `:${encodedPassword}` : ''}@${host}:${port}/${database}`
        : undefined;

    pool = new Pool({
      connectionString,
      host: host || undefined,
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

export function getDbPool(): pg.Pool {
  if (!pool) {
    initDb();
  }
  return pool!;
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

async function withTenant<T>(telegramId: string, fn: (client: pg.PoolClient) => Promise<T>) {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_telegram_id = $1', [telegramId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function ensureUser(telegramId: string) {
  await withTenant(telegramId, client =>
    client.query(
      `INSERT INTO users (telegram_id)
       VALUES ($1)
       ON CONFLICT (telegram_id) DO UPDATE SET last_seen_at = NOW()`,
      [telegramId]
    )
  );
}

export async function insertTransaction(params: {
  telegramId: string;
  txBytes?: string;
  status?: string;
  digest?: string;
}) {
  if (!params.telegramId) {
    throw new Error('telegramId is required for inserting transactions');
  }

  await ensureUser(params.telegramId);

  const result = await withTenant(params.telegramId, client =>
    client.query(
      `INSERT INTO transactions (telegram_id, tx_bytes, status, digest)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        params.telegramId,
        params.txBytes || null,
        params.status || 'pending',
        params.digest || null,
      ]
    )
  );
  return result.rows[0].id;
}

export async function updateTransactionStatus(params: { id: string; status: string; digest?: string; telegramId: string }) {
  if (!params.telegramId) {
    throw new Error('telegramId is required for updating transactions');
  }

  const result = await withTenant(params.telegramId, client =>
    client.query(
      `UPDATE transactions
       SET status = $1, digest = COALESCE($2, digest), updated_at = NOW()
       WHERE id = $3 AND telegram_id = $4`,
      [params.status, params.digest || null, params.id, params.telegramId]
    )
  );
  return result.rowCount! > 0;
}

export async function listTransactionsByTelegram(telegramId: string, limit = 50) {
  const result = await withTenant(telegramId, client =>
    client.query(
      `SELECT id, telegram_id, status, digest, created_at, updated_at
       FROM transactions
       WHERE telegram_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [telegramId, limit]
    )
  );
  return result.rows;
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
