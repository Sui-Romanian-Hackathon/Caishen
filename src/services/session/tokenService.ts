import { generateNonce, hashSecret, verifySecret } from '../../utils/security';

interface TokenRecord {
  hash: string;
  expiresAt: number;
}

const linkTokens = new Map<string, TokenRecord>();
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function issueLinkToken(userId: string) {
  const token = generateNonce(24);
  const hash = await hashSecret(token);
  linkTokens.set(userId, { hash, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

export async function verifyLinkToken(userId: string, token: string) {
  const record = linkTokens.get(userId);
  if (!record) return false;
  if (Date.now() > record.expiresAt) {
    linkTokens.delete(userId);
    return false;
  }

  const ok = await verifySecret(token, record.hash);
  if (ok) {
    linkTokens.delete(userId);
  }
  return ok;
}
