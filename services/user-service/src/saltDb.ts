import crypto from 'crypto';
import pg from 'pg';

const { Pool } = pg;

type SaltRow = {
  provider: string;
  subject: string;
  salt: string;
  created_at: string | Date;
};

let pool: pg.Pool | null = null;

export function initSaltDb() {
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
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
  } else {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('Database config required: set POSTGRES_HOST/USER/DB or DATABASE_URL');
    }
    pool = new Pool({
      connectionString: dbUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
  }

  pool.on('error', (err: Error) => {
    console.error('Unexpected PostgreSQL pool error (salt):', err);
  });
}

function getDb(): pg.Pool {
  if (!pool) {
    initSaltDb();
  }
  return pool!;
}

function decodeJwtSubject(jwt?: string): string | null {
  if (!jwt) return null;
  try {
    const [, payloadB64] = jwt.split('.');
    if (!payloadB64) return null;

    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
      Math.ceil(payloadB64.length / 4) * 4,
      '='
    );
    const payloadJson = Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson) as { sub?: string };
    return payload.sub ?? null;
  } catch (err) {
    console.warn({ err }, 'Failed to decode JWT subject');
    return null;
  }
}

async function fetchSaltFromMysten(jwtToken: string): Promise<string> {
  const saltServiceUrl =
    process.env.ZKLOGIN_SALT_SERVICE_URL || 'https://salt.api.mystenlabs.com/get_salt';

  const response = await fetch(saltServiceUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jwt: jwtToken })
  });

  if (!response.ok) {
    throw new Error(`Salt service returned ${response.status}`);
  }

  const body = (await response.json()) as { salt?: string };
  if (!body?.salt) {
    throw new Error('Salt service did not return a salt');
  }

  return body.salt;
}

function normalizeSaltRow(row: SaltRow) {
  return {
    provider: row.provider,
    subject: row.subject,
    salt: row.salt,
    created_at: new Date(row.created_at).toISOString()
  };
}

export async function getOrCreateSalt(params: {
  telegramId: string;
  provider: string;
  subject?: string;
  jwt?: string;
}) {
  const db = getDb();
  const subject = params.subject ?? decodeJwtSubject(params.jwt);

  if (!subject) {
    throw new Error('subject or jwt (with sub) is required to bind salt');
  }

  const existing = await db.query<SaltRow>(
    `SELECT provider, subject, salt, created_at 
     FROM zklogin_salts 
     WHERE provider = $1 AND subject = $2`,
    [params.provider, subject]
  );

  if (existing.rows[0]) {
    return normalizeSaltRow(existing.rows[0]);
  }

  let salt: string | null = null;
  if (params.jwt) {
    try {
      salt = await fetchSaltFromMysten(params.jwt);
    } catch (err) {
      console.warn({ err }, 'Failed to fetch salt from Mysten Labs, falling back to random salt');
    }
  }

  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }

  const result = await db.query<SaltRow>(
    `INSERT INTO zklogin_salts (telegram_id, provider, subject, salt)
     VALUES ($1, $2, $3, $4)
     RETURNING provider, subject, salt, created_at`,
    [params.telegramId, params.provider, subject, salt]
  );

  return normalizeSaltRow(result.rows[0]);
}

export async function getSalt(provider: string, subject: string) {
  const db = getDb();
  const result = await db.query<{ salt: string }>(
    `SELECT salt FROM zklogin_salts WHERE provider = $1 AND subject = $2`,
    [provider, subject]
  );
  return result.rows[0]?.salt || null;
}

export async function verifySaltWithMysten(jwtToken: string): Promise<boolean> {
  try {
    await fetchSaltFromMysten(jwtToken);
    return true;
  } catch (err) {
    console.error({ err }, 'Failed to verify salt with Mysten Labs');
    return false;
  }
}

export async function closeSaltDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
