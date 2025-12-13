import axios from 'axios';

const PROVER_URL = process.env.PROVER_URL || 'https://prover-dev.mystenlabs.com/v1';

export async function submitProofRequest(payload: Record<string, unknown>) {
  const res = await axios.post(PROVER_URL, payload, { timeout: 10000 });
  return res.data;
}
