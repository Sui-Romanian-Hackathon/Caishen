import crypto from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { SaltRecord, ZkLoginError } from './types';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

export interface SaltStorageOptions {
  encryptionKey: string;
  db?: Pool;
  useInMemory?: boolean;
}

interface SaltRow {
  telegram_id: string;
  provider: string;
  subject: string;
  audience: string;
  salt?: string;
  salt_encrypted?: Buffer;
  encryption_iv?: Buffer;
  derived_address: string;
  key_claim_name: string;
}

export class SaltStorage {
  private readonly key: Buffer;
  private readonly useInMemory: boolean;
  private memoryStore: Map<string, SaltRecord> = new Map();
  private db?: Pool;

  constructor(options: SaltStorageOptions) {
    if (!options.encryptionKey) {
      throw new Error('Encryption key is required for SaltStorage');
    }

    const keyBuffer = Buffer.from(options.encryptionKey, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error('ZKLOGIN_ENCRYPTION_KEY must be 32 bytes hex');
    }
    this.key = keyBuffer;
    this.db = options.db;
    this.useInMemory = Boolean(options.useInMemory || !options.db);
  }

  private static cacheKey(provider: string, subject: string, audience: string) {
    return `${provider}:${subject}:${audience}`;
  }

  private encryptSalt(salt: string): { encrypted: Buffer; iv: Buffer } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(salt, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return { encrypted, iv };
  }

  private decryptSalt(encrypted: Buffer, iv: Buffer): string {
    const authTag = encrypted.slice(-16);
    const data = encrypted.slice(0, -16);
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  }

  private mapRowToRecord(row: SaltRow): SaltRecord {
    const saltValue =
      row.salt ??
      (row.salt_encrypted && row.encryption_iv
        ? this.decryptSalt(row.salt_encrypted, row.encryption_iv)
        : null);

    if (!saltValue) {
      throw new Error('Salt missing from database row');
    }

    return {
      telegramId: row.telegram_id,
      provider: row.provider,
      subject: row.subject,
      audience: row.audience,
      salt: saltValue,
      derivedAddress: row.derived_address,
      keyClaimName: row.key_claim_name
    };
  }

  private async withTenant<T>(telegramId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.db) {
      throw new Error('Database not configured for SaltStorage');
    }
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Use set_config() instead of SET LOCAL - supports parameterized queries
      await client.query('SELECT set_config($1, $2, true)', ['app.current_telegram_id', telegramId]);
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

  private async ensureUser(client: PoolClient, telegramId: string) {
    await client.query(
      `INSERT INTO users (telegram_id)
       VALUES ($1)
       ON CONFLICT (telegram_id) DO UPDATE SET last_seen_at = NOW()`,
      [telegramId]
    );
  }

  async getSalt(
    provider: string,
    subject: string,
    audience: string,
    telegramId: string
  ): Promise<SaltRecord | null> {
    const key = SaltStorage.cacheKey(provider, subject, audience);
    if (this.useInMemory) {
      return this.memoryStore.get(key) ?? null;
    }

    const result = await this.withTenant(telegramId, async client =>
      client.query<SaltRow>(
        `SELECT telegram_id, provider, subject, audience, salt, salt_encrypted, encryption_iv, derived_address, key_claim_name
         FROM zklogin_salts
         WHERE provider = $1 AND subject = $2 AND audience = $3
         LIMIT 1`,
        [provider, subject, audience]
      )
    );

    if (result.rows.length === 0) {
      return null;
    }
    return this.mapRowToRecord(result.rows[0]);
  }

  async findByTelegramId(telegramId: string): Promise<SaltRecord | null> {
    if (this.useInMemory) {
      const found = Array.from(this.memoryStore.values()).find(r => r.telegramId === telegramId);
      return found ?? null;
    }

    const result = await this.withTenant(telegramId, async client =>
      client.query<SaltRow>(
        `SELECT telegram_id, provider, subject, audience, salt, salt_encrypted, encryption_iv, derived_address, key_claim_name
         FROM zklogin_salts
         WHERE telegram_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [telegramId]
      )
    );

    if (result.rows.length === 0) {
      return null;
    }
    return this.mapRowToRecord(result.rows[0]);
  }

  async saveSalt(record: SaltRecord): Promise<SaltRecord> {
    const key = SaltStorage.cacheKey(record.provider, record.subject, record.audience);

    if (this.useInMemory) {
      this.memoryStore.set(key, record);
      return record;
    }

    const { encrypted, iv } = this.encryptSalt(record.salt);

    const result = await this.withTenant(record.telegramId, async client => {
      await this.ensureUser(client, record.telegramId);
      return client.query<SaltRow>(
        `INSERT INTO zklogin_salts (
          telegram_id, provider, subject, audience, salt, salt_encrypted, encryption_iv, derived_address, key_claim_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (provider, subject, audience) DO UPDATE SET
          telegram_id = EXCLUDED.telegram_id,
          salt = EXCLUDED.salt,
          salt_encrypted = EXCLUDED.salt_encrypted,
          encryption_iv = EXCLUDED.encryption_iv,
          derived_address = EXCLUDED.derived_address,
          key_claim_name = EXCLUDED.key_claim_name,
          updated_at = NOW()
        RETURNING telegram_id, provider, subject, audience, salt, salt_encrypted, encryption_iv, derived_address, key_claim_name`,
        [
          record.telegramId,
          record.provider,
          record.subject,
          record.audience,
          record.salt,
          encrypted,
          iv,
          record.derivedAddress,
          record.keyClaimName
        ]
      );
    });

    return this.mapRowToRecord(result.rows[0]);
  }

  async getOrCreate(record: SaltRecord): Promise<SaltRecord> {
    const existing = await this.getSalt(record.provider, record.subject, record.audience, record.telegramId);
    if (existing) {
      return existing;
    }
    return this.saveSalt(record);
  }
}

export function encryptSaltForTest(value: string, keyHex: string) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { encrypted, iv };
}

export function decryptSaltForTest(encrypted: Buffer, iv: Buffer, keyHex: string) {
  const key = Buffer.from(keyHex, 'hex');
  const authTag = encrypted.slice(-16);
  const data = encrypted.slice(0, -16);
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}
