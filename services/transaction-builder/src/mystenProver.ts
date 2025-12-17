import { ProofRequest, ProofResponse } from './zklogin/types';

const DEFAULT_PROVER_URL = process.env.PROVER_URL || 'https://prover-dev.mystenlabs.com/v1';

export async function submitProofRequest(
  payload: ProofRequest,
  proverUrl: string = DEFAULT_PROVER_URL,
  timeoutMs = 30_000
): Promise<ProofResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(proverUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Prover error: ${res.status} ${res.statusText} ${body}`);
    }

    return (await res.json()) as ProofResponse;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error('Prover request timeout');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
