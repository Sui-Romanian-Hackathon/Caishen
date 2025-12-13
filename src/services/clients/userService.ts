import axios from 'axios';
import logger from '../../utils/logger';
import { config } from '../../config/env';

const client = axios.create({
  baseURL: config.USER_SERVICE_URL,
  timeout: 5000
});

export async function touchUser(params: { telegramId: string; username?: string }) {
  try {
    await client.post('/api/v1/users/init', params);
  } catch (err) {
    logger.warn({ err }, 'Failed to touch user in user-service');
  }
}

export async function upsertContact(params: {
  telegramId: string;
  alias: string;
  address: string;
  username?: string;
}) {
  try {
    const res = await client.post('/api/v1/users/contacts', params);
    return res.data as {
      contact: { id: string; alias: string; address: string; created_at: string };
      updated: boolean;
    };
  } catch (err) {
    logger.warn({ err }, 'Failed to upsert contact in user-service');
    return null;
  }
}

export async function listContacts(telegramId: string) {
  try {
    const res = await client.get(`/api/v1/users/contacts/${telegramId}`);
    return res.data as {
      contacts: Array<{ id: string; alias: string; address: string; created_at: string }>;
    };
  } catch (err) {
    logger.warn({ err }, 'Failed to list contacts from user-service');
    return { contacts: [] };
  }
}
