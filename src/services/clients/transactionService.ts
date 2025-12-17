import axios from 'axios';
import logger from '../../utils/logger';
import { config } from '../../config/env';

const client = axios.create({
  baseURL: config.TX_SERVICE_URL,
  timeout: 5000
});

export async function logTransaction(params: {
  telegramId: string;
  txBytes?: string;
  status?: string;
  digest?: string;
}) {
  try {
    const res = await client.post('/api/v1/tx/log', params);
    return res.data as { id: string };
  } catch (err) {
    logger.warn({ err }, 'Failed to log transaction');
    return null;
  }
}

export async function updateTransactionStatus(params: {
  id: string;
  status: string;
  digest?: string;
  telegramId: string;
}) {
  try {
    await client.post('/api/v1/tx/status', params);
    return true;
  } catch (err) {
    logger.warn({ err }, 'Failed to update transaction status');
    return false;
  }
}

export async function fetchHistory(telegramId: string, limit = 20) {
  try {
    const res = await client.get(`/api/v1/tx/history/${telegramId}`, { params: { limit } });
    return res.data as {
      history: Array<{
        id: string;
        status: string | null;
        digest: string | null;
        created_at: string;
        updated_at: string;
      }>;
    };
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch transaction history');
    return { history: [] };
  }
}
