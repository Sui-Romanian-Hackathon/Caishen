import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const DEFAULT_ROUNDS = 12;

export function generateNonce(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

export async function hashSecret(value: string, rounds = DEFAULT_ROUNDS) {
  const salt = await bcrypt.genSalt(rounds);
  return bcrypt.hash(value, salt);
}

export async function verifySecret(value: string, hash: string) {
  return bcrypt.compare(value, hash);
}
