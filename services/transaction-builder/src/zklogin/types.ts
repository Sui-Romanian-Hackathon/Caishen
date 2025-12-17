import type { JWK } from 'jose';

export interface SaltRequest {
  jwt: string;
  telegramId: string;
  provider?: string;
}

export interface SaltResponse {
  salt: string;
  provider: string;
  subject: string;
  derivedAddress: string;
  keyClaimName: string;
}

export interface SaltServiceConfig {
  masterSecret: string;
  allowedIssuers: string[];
  allowedAudiences: string[];
  saltLength: number;
  skipSignatureVerification?: boolean;
}

export interface JwtValidationResult {
  valid: boolean;
  claims?: JwtClaims;
  error?: string;
}

export interface JwtClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  [key: string]: unknown;
}

export interface JwksCacheState {
  keys: JWK[];
  fetchedAt: number;
  ttlMs: number;
}

export interface ProofRequest {
  jwt: string;
  extendedEphemeralPublicKey: string;
  maxEpoch: number;
  jwtRandomness: string;
  salt: string;
  keyClaimName: string;
  telegramId?: string;
}

export interface ProofResponse {
  proofPoints: {
    a: string[];
    b: string[][];
    c: string[];
  };
  issBase64Details: {
    value: string;
    indexMod4: number;
  };
  headerBase64: string;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  retryAfter?: number;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export interface ZkLoginRateLimitConfig {
  perIp: RateLimitConfig;
  perTelegramId: RateLimitConfig;
  global: RateLimitConfig;
}

export interface SaltRecord {
  telegramId: string;
  provider: string;
  subject: string;
  audience: string;
  salt: string;
  derivedAddress: string;
  keyClaimName: string;
}

export interface AddressVerificationResult {
  matches: boolean;
  linkedAddress: string | null;
  derivedAddress: string;
  error?: string;
  provider?: string;
  subject?: string;
  audience?: string | string[];
}

export interface ZkLoginConfig {
  salt: SaltServiceConfig;
  encryptionKey: string;
  jwksUrl: string;
  jwksCacheTtlMs: number;
  rateLimits: ZkLoginRateLimitConfig;
  proverUrl: string;
  proverTimeoutMs: number;
}

export class ZkLoginError extends Error {
  status: number;
  retryAfter?: number;

  constructor(message: string, status = 400, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.name = 'ZkLoginError';
  }
}
