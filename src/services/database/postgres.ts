import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Initialize PostgreSQL connection pool
 * Supports individual env vars (POSTGRES_*) or DATABASE_URL
 */
export function initDatabase(connectionString?: string): pg.Pool {
  if (pool) return pool;

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
    const dbUrl = connectionString || process.env.DATABASE_URL;
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

  pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err);
  });

  return pool;
}

/**
 * Get the database pool instance
 */
export function getPool(): pg.Pool {
  if (!pool) {
    return initDatabase();
  }
  return pool;
}

/**
 * Close the database pool
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Execute a query with parameters
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const client = getPool();
  const result = await client.query(text, params);
  return result as pg.QueryResult<T>;
}

/**
 * Get a single row
 */
export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] || null;
}

/**
 * Get all rows
 */
export async function queryAll<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

/**
 * Execute a transaction
 */
export async function transaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Ensure user exists in database
 */
export async function ensureUser(telegramId: string, username?: string): Promise<void> {
  await query(
    `INSERT INTO users (telegram_id, username, last_seen_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (telegram_id) DO UPDATE SET
       username = COALESCE($2, users.username),
       last_seen_at = NOW()`,
    [telegramId, username || null]
  );
}

/**
 * Get user by telegram ID
 */
export async function getUser(telegramId: string): Promise<{
  telegram_id: string;
  username: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
} | null> {
  return queryOne(
    'SELECT telegram_id, username, first_seen_at, last_seen_at FROM users WHERE telegram_id = $1',
    [telegramId]
  );
}

/**
 * Get user's primary wallet address
 */
export async function getUserWallet(telegramId: string): Promise<string | null> {
  const result = await queryOne<{ address: string }>(
    `SELECT address FROM wallet_links 
     WHERE telegram_id = $1 
     ORDER BY created_at ASC 
     LIMIT 1`,
    [telegramId]
  );
  return result?.address || null;
}

/**
 * Link a wallet to user
 */
export async function linkWallet(
  telegramId: string,
  address: string,
  linkedVia: 'manual' | 'zklogin' = 'manual',
  label?: string
): Promise<void> {
  await query(
    `INSERT INTO wallet_links (telegram_id, address, linked_via, label)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (telegram_id, address) DO UPDATE SET
       label = COALESCE($4, wallet_links.label)`,
    [telegramId, address, linkedVia, label || null]
  );
}

export default {
  initDatabase,
  getPool,
  closeDatabase,
  query,
  queryOne,
  queryAll,
  transaction,
  ensureUser,
  getUser,
  getUserWallet,
  linkWallet,
};
