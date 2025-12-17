import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import type { JWK } from 'jose';
import { JwksCache } from './jwks.cache';
import { JwtClaims, JwtValidationResult } from './types';

interface JwtValidatorOptions {
  allowedIssuers: string[];
  allowedAudiences: string[];
  jwksCache: JwksCache;
  clockToleranceSeconds?: number;
  skipSignatureVerification?: boolean;
}

export class JwtValidator {
  private readonly clockToleranceSeconds: number;
  private readonly skipSignatureVerification: boolean;

  constructor(private readonly options: JwtValidatorOptions) {
    this.clockToleranceSeconds = options.clockToleranceSeconds ?? 60;
    this.skipSignatureVerification = Boolean(options.skipSignatureVerification);
  }

  private async getKeyForKid(kid: string): Promise<JWK> {
    const keys = await this.options.jwksCache.get(false);
    let found = keys.find(k => k.kid === kid);
    if (found) return found;

    // Refresh once on miss (rotation support)
    const refreshed = await this.options.jwksCache.get(true);
    found = refreshed.find(k => k.kid === kid);
    if (!found) {
      throw new Error(`JWKS key not found for kid=${kid}`);
    }
    return found;
  }

  private validateClaims(claims: JwtClaims): string | null {
    const now = Math.floor(Date.now() / 1000);
    const skew = this.clockToleranceSeconds;

    if (!claims.iss || !this.options.allowedIssuers.includes(claims.iss)) {
      return 'Invalid issuer';
    }

    const audArray = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audArray.some(a => this.options.allowedAudiences.includes(a))) {
      return 'Invalid audience';
    }

    if (!claims.sub) {
      return 'Missing subject';
    }

    if (typeof claims.exp !== 'number' || claims.exp + skew <= now) {
      return 'JWT expired';
    }

    if (typeof claims.iat !== 'number' || claims.iat - skew > now) {
      return 'JWT issued in the future';
    }

    return null;
  }

  private decodeWithoutVerification(token: string): JwtClaims {
    return decodeJwt(token) as JwtClaims;
  }

  async validate(token: string): Promise<JwtValidationResult> {
    const normalized = token?.trim();
    if (!normalized) {
      return { valid: false, error: 'jwt is required' };
    }

    let header;
    try {
      header = decodeProtectedHeader(normalized);
    } catch (err) {
      return { valid: false, error: `Invalid JWT: ${(err as Error).message}` };
    }

    if (!header.kid) {
      return { valid: false, error: 'JWT missing kid header' };
    }
    if (header.alg !== 'RS256') {
      return { valid: false, error: 'Unsupported alg' };
    }

    let claims: JwtClaims;
    try {
      if (this.skipSignatureVerification) {
        claims = this.decodeWithoutVerification(normalized);
      } else {
        const jwk = await this.getKeyForKid(header.kid);
        const key = await importJWK(jwk, 'RS256');
        const verified = await jwtVerify(normalized, key, {
          clockTolerance: this.clockToleranceSeconds,
          issuer: this.options.allowedIssuers,
          audience: this.options.allowedAudiences
        });
        claims = verified.payload as JwtClaims;
      }
    } catch (err) {
      if (err instanceof Error) {
        return { valid: false, error: err.message };
      }
      return { valid: false, error: 'Invalid JWT' };
    }

    const validationError = this.validateClaims(claims);
    if (validationError) {
      return { valid: false, error: validationError };
    }

    return { valid: true, claims };
  }
}
