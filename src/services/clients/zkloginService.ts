import axios from 'axios';
import logger from '../../utils/logger';
import { config } from '../../config/env';

const userServiceClient = axios.create({ baseURL: config.USER_SERVICE_URL, timeout: 5000 });
const txServiceClient = axios.create({
  baseURL: config.TX_SERVICE_URL,
  timeout: 5000
});
const proverClient = axios.create({
  baseURL:
    process.env.PROVER_URL || process.env.ZKLOGIN_PROVER_URL || 'https://prover-dev.mystenlabs.com/v1',
  timeout: 10000
});
const saltServiceUrl =
  process.env.ZKLOGIN_SALT_SERVICE_URL || 'https://salt.api.mystenlabs.com/get_salt';

type SaltRequest = {
  provider: string;
  telegramId: string;
  subject?: string;
  jwt?: string;
};

export async function getOrCreateSalt(params: SaltRequest) {
  // If we don't yet have an OAuth subject or JWT, skip and let the caller know.
  if (!params.subject && !params.jwt) {
    logger.debug('Skipping salt fetch: subject/jwt not provided');
    return null;
  }

  try {
    const res = await userServiceClient.post('/api/v1/zklogin/salt', params);
    return res.data as { provider: string; subject: string; salt: string; created_at: string };
  } catch (err) {
    logger.warn(
      { err },
      'Failed to get salt from user-service, attempting Mysten salt service directly'
    );

    if (!params.jwt) {
      return null;
    }

    try {
      const res = await axios.post(saltServiceUrl, { jwt: params.jwt }, { timeout: 5000 });
      return {
        provider: params.provider,
        subject: params.subject ?? 'unknown',
        salt: res.data?.salt ?? '',
        created_at: new Date().toISOString()
      };
    } catch (fallbackErr) {
      logger.error({ err: fallbackErr }, 'Failed to fetch salt from Mysten salt service');
      return null;
    }
  }
}

export async function requestSaltFromTxBuilder(params: { jwt: string; telegramId?: string }) {
  try {
    const res = await txServiceClient.post('/api/v1/zklogin/salt', params);
    return res.data as {
      salt: string;
      provider: string;
      subject: string;
      derivedAddress: string;
      keyClaimName: string;
    };
  } catch (err) {
    logger.error({ err }, 'Failed to fetch salt from transaction-builder');
    throw err;
  }
}

export async function requestProof(payload: Record<string, unknown>) {
  try {
    const res = await proverClient.post('', payload);
    return res.data;
  } catch (err) {
    logger.error({ err }, 'Failed to request proof from Mysten prover');
    throw err;
  }
}
