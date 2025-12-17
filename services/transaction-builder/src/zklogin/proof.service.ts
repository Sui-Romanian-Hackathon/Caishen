import { RateLimiter } from './rate.limiter';
import { ProofRequest, ProofResponse, ZkLoginError, ZkLoginRateLimitConfig } from './types';
import { submitProofRequest } from '../mystenProver';

interface ProofServiceOptions {
  rateLimits: ZkLoginRateLimitConfig;
  proverUrl: string;
  timeoutMs: number;
  logger?: { info: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
}

export class ProofService {
  private readonly ipLimiter: RateLimiter;
  private readonly telegramLimiter: RateLimiter;
  private readonly globalLimiter: RateLimiter;

  constructor(private readonly options: ProofServiceOptions) {
    this.ipLimiter = new RateLimiter(options.rateLimits.perIp.windowMs, options.rateLimits.perIp.maxRequests);
    this.telegramLimiter = new RateLimiter(
      options.rateLimits.perTelegramId.windowMs,
      options.rateLimits.perTelegramId.maxRequests
    );
    this.globalLimiter = new RateLimiter(options.rateLimits.global.windowMs, options.rateLimits.global.maxRequests);
  }

  private validateRequest(req: ProofRequest) {
    const required: (keyof ProofRequest)[] = [
      'jwt',
      'extendedEphemeralPublicKey',
      'maxEpoch',
      'jwtRandomness',
      'salt',
      'keyClaimName'
    ];
    const missing = required.filter(field => req[field] === undefined || req[field] === null || req[field] === '');
    if (missing.length > 0) {
      throw new ZkLoginError(`Missing required field: ${missing[0]}`, 400);
    }

    if (typeof req.maxEpoch !== 'number' || req.maxEpoch < 0) {
      throw new ZkLoginError('maxEpoch must be a positive number', 400);
    }

    if (!/^\d+$/.test(String(req.jwtRandomness))) {
      throw new ZkLoginError('jwtRandomness must be a numeric string', 400);
    }
  }

  private enforceRateLimits(ip?: string, telegramId?: string) {
    const globalResult = this.globalLimiter.check('global');
    if (!globalResult.allowed) {
      throw new ZkLoginError('Rate limit exceeded', 429, globalResult.retryAfter);
    }

    if (ip) {
      const ipResult = this.ipLimiter.check(ip);
      if (!ipResult.allowed) {
        throw new ZkLoginError('Rate limit exceeded', 429, ipResult.retryAfter);
      }
    }

    if (telegramId) {
      const tgResult = this.telegramLimiter.check(telegramId);
      if (!tgResult.allowed) {
        throw new ZkLoginError('Rate limit exceeded', 429, tgResult.retryAfter);
      }
    }
  }

  async generateProof(req: ProofRequest, meta: { ip?: string } = {}): Promise<ProofResponse> {
    const start = Date.now();
    this.validateRequest(req);
    this.enforceRateLimits(meta.ip, req.telegramId);

    try {
      const result = await submitProofRequest(req, this.options.proverUrl, this.options.timeoutMs);
      this.options.logger?.info(
        {
          endpoint: '/api/v1/zklogin/proof',
          telegramId: req.telegramId,
          ip: meta.ip,
          durationMs: Date.now() - start,
          success: true
        },
        'Proof request completed'
      );
      return result;
    } catch (err) {
      const error = err as Error;
      this.options.logger?.error(
        {
          endpoint: '/api/v1/zklogin/proof',
          telegramId: req.telegramId,
          ip: meta.ip,
          durationMs: Date.now() - start,
          error: error.message
        },
        'Proof request failed'
      );

      if (error.message.toLowerCase().includes('timeout')) {
        throw new ZkLoginError('Prover timeout', 504);
      }

      throw new ZkLoginError('Prover unavailable', 502);
    }
  }
}
