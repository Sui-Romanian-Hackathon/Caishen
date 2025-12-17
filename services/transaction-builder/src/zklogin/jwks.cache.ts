import type { JWK } from 'jose';
import { JwksCacheState } from './types';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class JwksCache {
  private cache: JwksCacheState | null = null;

  constructor(
    private readonly url: string,
    private readonly ttlMs: number,
    private readonly fetchFn: FetchLike = fetch
  ) {}

  isExpired(): boolean {
    if (!this.cache) return true;
    return Date.now() - this.cache.fetchedAt > this.cache.ttlMs;
  }

  clear() {
    this.cache = null;
  }

  snapshot(): JwksCacheState | null {
    return this.cache ? { ...this.cache, keys: [...this.cache.keys] } : null;
  }

  async get(forceRefresh = false): Promise<JWK[]> {
    if (!forceRefresh && this.cache && !this.isExpired()) {
      return this.cache.keys;
    }

    const response = await this.fetchFn(this.url, {
      headers: { accept: 'application/json' }
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Failed to fetch JWKS (${response.status}): ${text || response.statusText}`);
    }

    const body = await response.json();
    if (!body || !Array.isArray(body.keys)) {
      throw new Error('Invalid JWKS response: missing keys array');
    }

    this.cache = {
      keys: body.keys,
      fetchedAt: Date.now(),
      ttlMs: this.ttlMs
    };

    return body.keys;
  }
}
