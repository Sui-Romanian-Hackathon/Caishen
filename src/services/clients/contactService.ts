import axios from 'axios';
import logger from '../../utils/logger';
import { config } from '../../config/env';

const client = axios.create({ baseURL: config.USER_SERVICE_URL, timeout: 5000 });

export interface ContactDto {
  id: string;
  alias: string;
  address: string;
  created_at: string;
}

export async function listContacts(userId: string) {
  try {
    const res = await client.get(`/api/v1/users/contacts/${userId}`);
    return (res.data.contacts as ContactDto[]) ?? [];
  } catch (err) {
    logger.warn({ err }, 'Failed to list contacts via user-service');
    return [];
  }
}

export async function addContact(params: {
  userId: string;
  alias: string;
  address: string;
  username?: string;
}) {
  try {
    await client.post('/api/v1/users/contacts', {
      telegramId: params.userId,
      alias: params.alias,
      address: params.address,
      username: params.username
    });
    return true;
  } catch (err) {
    logger.warn({ err }, 'Failed to add contact via user-service');
    return false;
  }
}

export async function resolveContact(userId: string, query: string): Promise<string | null> {
  if (isLikelySuiAddress(query)) return query;
  const contacts = await listContacts(userId);
  const hit = contacts.find((c) => c.alias.toLowerCase() === query.toLowerCase());
  return hit ? hit.address : null;
}

function isLikelySuiAddress(address: string) {
  return /^0x[a-fA-F0-9]{40,64}$/.test(address);
}
