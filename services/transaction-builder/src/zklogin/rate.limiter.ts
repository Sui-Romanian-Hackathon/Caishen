import { RateLimitCheckResult } from './types';

interface RateLimitStoreRecord {
  count: number;
  windowStart: number;
}

export class RateLimiter {
  private store: Record<string, RateLimitStoreRecord> = {};

  constructor(
    public readonly windowMs: number,
    public readonly maxRequests: number
  ) {}

  check(key: string): RateLimitCheckResult {
    const now = Date.now();
    const record = this.store[key];

    if (!record || now - record.windowStart > this.windowMs) {
      this.store[key] = { count: 1, windowStart: now };
      return { allowed: true, remaining: this.maxRequests - 1 };
    }

    if (record.count >= this.maxRequests) {
      const retryAfter = Math.ceil((record.windowStart + this.windowMs - now) / 1000);
      return { allowed: false, remaining: 0, retryAfter };
    }

    record.count += 1;
    return { allowed: true, remaining: this.maxRequests - record.count };
  }

  reset() {
    this.store = {};
  }
}
