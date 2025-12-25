import crypto from 'crypto';
import { jwtToAddress } from '@mysten/sui/zklogin';
import { JwtValidator } from './jwt.validator';
import { SaltStorage } from './salt.storage';
import {
  SaltRequest,
  SaltResponse,
  SaltServiceConfig,
  ZkLoginError,
  JwtClaims
} from './types';

const ENOKI_API_URL = 'https://api.enoki.mystenlabs.com/v1/zklogin';

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

  /**
   * Fetch salt from Enoki API
   */
  private async fetchSaltFromEnoki(jwt: string): Promise<{ salt: string; address: string }> {
    const apiKey = this.options.config.enokiApiKey;
    if (!apiKey) {
      throw new ZkLoginError('Enoki API key not configured', 500);
    }

    const response = await fetch(ENOKI_API_URL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'zklogin-jwt': jwt
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ZkLoginError(`Enoki salt fetch failed: ${errorText}`, response.status);
    }

    const data = await response.json();
    if (!data?.data?.salt) {
      throw new ZkLoginError('Enoki did not return a salt', 500);
    }

    return {
      salt: data.data.salt,
      address: data.data.address
    };
  }

  async getSalt(request: SaltRequest): Promise<SaltResponse> {
    const start = Date.now();

    if (!request.jwt) {
      throw new ZkLoginError('jwt is required', 400);
    }

    const validation = await this.options.validator.validate(request.jwt);
    if (!validation.valid || !validation.claims) {
      throw new ZkLoginError(validation.error || 'Invalid JWT', 401);
    }

    const claims = validation.claims;
    const audience = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;

    // Check if we already have a salt stored for this user
    if (request.telegramId) {
      const existing = await this.options.storage.getSalt(
        claims.iss,
        claims.sub,
        audience,
        request.telegramId
      );
      if (existing) {
        this.options.logger?.info(
          {
            endpoint: '/api/v1/zklogin/salt',
            telegramId: request.telegramId,
            provider: existing.provider,
            durationMs: Date.now() - start,
            success: true,
            source: 'cache'
          },
          'Salt request completed (from cache)'
        );
        return {
          salt: existing.salt,
          provider: existing.provider,
          subject: existing.subject,
          derivedAddress: existing.derivedAddress,
          keyClaimName: existing.keyClaimName
        };
      }
    }

    // Determine salt: use Enoki if configured, otherwise derive locally
    let salt: string;
    let derivedAddress: string;

    if (this.options.config.enokiApiKey) {
      // Fetch salt from Enoki
      const enokiResult = await this.fetchSaltFromEnoki(request.jwt);
      salt = enokiResult.salt;
      derivedAddress = enokiResult.address;
      this.options.logger?.info({ source: 'enoki' }, 'Salt fetched from Enoki');
    } else {
      // Derive salt locally (legacy behavior)
      salt = deriveSalt({
        masterSecret: this.options.config.masterSecret,
        issuer: claims.iss,
        audience: claims.aud,
        subject: claims.sub,
        saltLength: this.options.config.saltLength
      });
      derivedAddress = jwtToAddress(request.jwt.trim(), salt);
    }

    const baseRecord = {
      telegramId: request.telegramId ?? 'anonymous',
      provider: claims.iss,
      subject: claims.sub,
      audience,
      salt,
      derivedAddress,
      keyClaimName: this.keyClaimName
    };

    // Store the salt if we have a telegramId
    const record = request.telegramId
      ? await this.options.storage.saveSalt(baseRecord)
      : baseRecord;

    this.options.logger?.info(
      {
        endpoint: '/api/v1/zklogin/salt',
        telegramId: request.telegramId,
        provider: record.provider,
        durationMs: Date.now() - start,
        success: true,
        source: this.options.config.enokiApiKey ? 'enoki' : 'derived'
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
