import { computeZkLoginAddress, jwtToAddress } from '@mysten/sui/zklogin';
import { JwtValidator } from './jwt.validator';
import { SaltStorage } from './salt.storage';
import { AddressVerificationResult, ZkLoginError } from './types';

interface AddressDerivationParams {
  jwt: string;
  salt: string;
  keyClaimName?: string;
}

interface AddressServiceOptions {
  validator: JwtValidator;
  storage: SaltStorage;
  logger?: { info: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
}

function normalizeAddress(address: string): string {
  if (!address) return address;
  const normalized = address.toLowerCase().replace(/^0x/, '');
  return `0x${normalized}`;
}

export class AddressService {
  constructor(private readonly options: AddressServiceOptions) {}

  async deriveAddress(params: AddressDerivationParams): Promise<string> {
    if (!params.jwt || !params.salt) {
      throw new ZkLoginError('jwt and salt are required', 400);
    }

    const keyClaimName = params.keyClaimName || 'sub';
    if (keyClaimName !== 'sub') {
      const claimsResult = await this.options.validator.validate(params.jwt);
      if (!claimsResult.valid || !claimsResult.claims) {
        throw new ZkLoginError(claimsResult.error || 'Invalid JWT', 401);
      }
      const claims = claimsResult.claims;
      const claimValue = (claims as Record<string, string | undefined>)[keyClaimName];
      if (!claimValue) {
        throw new ZkLoginError(`JWT missing claim ${keyClaimName}`, 400);
      }
      return computeZkLoginAddress({
        claimName: keyClaimName,
        claimValue,
        userSalt: params.salt,
        iss: claims.iss,
        aud: Array.isArray(claims.aud) ? claims.aud[0] : claims.aud
      });
    }

    return jwtToAddress(params.jwt.trim(), params.salt);
  }

  async verifyAddress(params: {
    telegramId: string;
    jwt: string;
    salt: string;
    keyClaimName?: string;
  }): Promise<AddressVerificationResult> {
    if (!params.telegramId) {
      throw new ZkLoginError('telegramId is required', 400);
    }
    if (!params.jwt) {
      throw new ZkLoginError('jwt is required', 400);
    }

    const validation = await this.options.validator.validate(params.jwt);
    if (!validation.valid || !validation.claims) {
      throw new ZkLoginError(validation.error || 'Invalid JWT', 401);
    }

    const derivedAddress = normalizeAddress(
      await this.deriveAddress({
        jwt: params.jwt,
        salt: params.salt,
        keyClaimName: params.keyClaimName
      })
    );

    const linked = await this.options.storage.findByTelegramId(params.telegramId);
    if (!linked) {
      return {
        matches: false,
        linkedAddress: null,
        derivedAddress,
        provider: validation.claims.iss,
        subject: validation.claims.sub,
        audience: validation.claims.aud,
        error: 'No linked wallet found'
      };
    }

    const linkedAddress = normalizeAddress(linked.derivedAddress);
    const matches = linkedAddress === derivedAddress;

    if (!matches) {
      return {
        matches: false,
        linkedAddress,
        derivedAddress,
        provider: linked.provider,
        subject: linked.subject,
        audience: linked.audience,
        error: 'Derived address does not match linked wallet'
      };
    }

    return {
      matches: true,
      linkedAddress,
      derivedAddress,
      provider: linked.provider,
      subject: linked.subject,
      audience: linked.audience
    };
  }
}
