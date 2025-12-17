import { ZkLoginConfig, ZkLoginRateLimitConfig } from '../zklogin/types';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const DEFAULT_SALT_BYTES = 16;
const DEFAULT_JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_PROVER_TIMEOUT_MS = 30_000;

function parseNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getAllowedIssuers(): string[] {
  const raw = process.env.ZKLOGIN_ALLOWED_ISSUERS;
  if (raw) {
    return raw
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
  }
  return ['https://accounts.google.com'];
}

function getAllowedAudiences(): string[] {
  const raw = process.env.ZKLOGIN_ALLOWED_AUDIENCES || process.env.GOOGLE_CLIENT_ID;
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function getRateLimits(): ZkLoginRateLimitConfig {
  return {
    perIp: {
      windowMs: parseNumberEnv('RATE_LIMIT_PER_IP_WINDOW_MS', 60_000),
      maxRequests: parseNumberEnv('RATE_LIMIT_PER_IP_MAX_REQUESTS', 10)
    },
    perTelegramId: {
      windowMs: parseNumberEnv('RATE_LIMIT_PER_USER_WINDOW_MS', 60_000),
      maxRequests: parseNumberEnv('RATE_LIMIT_PER_USER_MAX_REQUESTS', 5)
    },
    global: {
      windowMs: parseNumberEnv('RATE_LIMIT_GLOBAL_WINDOW_MS', 60_000),
      maxRequests: parseNumberEnv('RATE_LIMIT_GLOBAL_MAX_REQUESTS', 100)
    }
  };
}

export function loadZkLoginConfig(): ZkLoginConfig {
  const masterSecret = process.env.ZKLOGIN_MASTER_SECRET;
  if (!masterSecret) {
    throw new Error('ZKLOGIN_MASTER_SECRET is required for salt derivation');
  }

  const encryptionKey = process.env.ZKLOGIN_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('ZKLOGIN_ENCRYPTION_KEY is required for salt encryption');
  }

  const allowedAudiences = getAllowedAudiences();
  if (allowedAudiences.length === 0) {
    throw new Error('At least one allowed audience is required (set GOOGLE_CLIENT_ID)');
  }

  const skipSignatureVerification =
    process.env.ZKLOGIN_SKIP_SIGNATURE === 'true' || process.env.NODE_ENV === 'test';

  return {
    salt: {
      masterSecret,
      allowedIssuers: getAllowedIssuers(),
      allowedAudiences,
      saltLength: DEFAULT_SALT_BYTES,
      skipSignatureVerification
    },
    encryptionKey,
    jwksUrl: process.env.ZKLOGIN_JWKS_URL || GOOGLE_JWKS_URL,
    jwksCacheTtlMs: parseNumberEnv('JWKS_CACHE_TTL_MS', DEFAULT_JWKS_TTL_MS),
    rateLimits: getRateLimits(),
    proverUrl: process.env.PROVER_URL || 'https://prover-dev.mystenlabs.com/v1',
    proverTimeoutMs: parseNumberEnv('PROVER_TIMEOUT_MS', DEFAULT_PROVER_TIMEOUT_MS)
  };
}

export const zkloginDefaults = {
  GOOGLE_JWKS_URL,
  DEFAULT_SALT_BYTES,
  DEFAULT_JWKS_TTL_MS,
  DEFAULT_PROVER_TIMEOUT_MS
};
