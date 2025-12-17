import crypto from 'crypto';
import { jwtToAddress } from '@mysten/sui/zklogin';
import { JwtValidator } from './jwt.validator';
import { SaltStorage } from './salt.storage';
import {
  SaltRequest,
  SaltResponse,
  SaltServiceConfig,
  ZkLoginError
} from './types';

export function deriveSalt(params: {
  masterSecret: string;
  issuer: string;
  audience: string | string[];
  subject: string;
  saltLength: number;
}): string {
  const audience = Array.isArray(params.audience) ? params.audience[0] : params.audience;
  const input = `${params.issuer}:${audience}:${params.subject}`;
  const hmac = crypto.createHmac('sha256', params.masterSecret);
  hmac.update(input);
  const hash = hmac.digest();
  const saltBytes = hash.slice(0, params.saltLength);
  const saltBigInt = BigInt('0x' + saltBytes.toString('hex'));
  return saltBigInt.toString();
}

interface SaltServiceOptions {
  config: SaltServiceConfig;
  validator: JwtValidator;
  storage: SaltStorage;
  logger?: { info: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
}

export class SaltService {
  private readonly keyClaimName = 'sub';

  constructor(private readonly options: SaltServiceOptions) {}

  async getSalt(request: SaltRequest): Promise<SaltResponse> {
    const start = Date.now();

    if (!request.jwt) {
      throw new ZkLoginError('jwt is required', 400);
    }
    if (!request.telegramId) {
      throw new ZkLoginError('telegramId is required', 400);
    }

    const validation = await this.options.validator.validate(request.jwt);
    if (!validation.valid || !validation.claims) {
      throw new ZkLoginError(validation.error || 'Invalid JWT', 401);
    }

    const claims = validation.claims;
    const salt = deriveSalt({
      masterSecret: this.options.config.masterSecret,
      issuer: claims.iss,
      audience: claims.aud,
      subject: claims.sub,
      saltLength: this.options.config.saltLength
    });

    const derivedAddress = jwtToAddress(request.jwt.trim(), salt);

    const record = await this.options.storage.getOrCreate({
      telegramId: request.telegramId,
      provider: claims.iss,
      subject: claims.sub,
      audience: Array.isArray(claims.aud) ? claims.aud[0] : claims.aud,
      salt,
      derivedAddress,
      keyClaimName: this.keyClaimName
    });

    this.options.logger?.info(
      {
        endpoint: '/api/v1/zklogin/salt',
        telegramId: request.telegramId,
        provider: record.provider,
        durationMs: Date.now() - start,
        success: true
      },
      'Salt request completed'
    );

    return {
      salt: record.salt,
      provider: record.provider,
      subject: record.subject,
      derivedAddress: record.derivedAddress,
      keyClaimName: record.keyClaimName
    };
  }
}
