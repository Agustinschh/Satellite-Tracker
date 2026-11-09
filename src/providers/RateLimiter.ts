import type { DataProviderId } from '../types/satellite';

interface RateLimitConfig {
  maxRequestsPerWindow: number;
  windowMs: number;
  minIntervalMs: number;
}

/**
 * Provider rate limit policies enforced according to TP7 specification:
 * - CelesTrak: conservative (< 10 req/min, caches for 12-24h)
 * - Space-Track.org: < 30 req/min and < 300 req/hour
 * - N2YO: < 1000 transactions/hour (positions/TLE), < 100/hour (passes)
 * - Where the ISS at?: max 1 req/second
 */
const PROVIDER_LIMITS: Record<DataProviderId, RateLimitConfig> = {
  celestrak: {
    maxRequestsPerWindow: 15,
    windowMs: 60_000,
    minIntervalMs: 1_000,
  },
  spacetrack: {
    maxRequestsPerWindow: 25, // Strictly under 30 req/min
    windowMs: 60_000,
    minIntervalMs: 2_000,
  },
  n2yo: {
    maxRequestsPerWindow: 90,
    windowMs: 3_600_000,
    minIntervalMs: 500,
  },
  wheretheiss: {
    maxRequestsPerWindow: 50,
    windowMs: 60_000,
    minIntervalMs: 1_050, // Strictly <= 1 req/s
  },
};

export class RateLimiter {
  private history: Record<DataProviderId, number[]> = {
    celestrak: [],
    spacetrack: [],
    n2yo: [],
    wheretheiss: [],
  };

  /**
   * Checks whether a request to `provider` is permitted right now, or waits
   * until the minimum interval / window frees up.
   */
  async acquire(provider: DataProviderId): Promise<void> {
    const cfg = PROVIDER_LIMITS[provider];
    const now = Date.now();
    const timestamps = this.history[provider].filter((t) => now - t < cfg.windowMs);
    this.history[provider] = timestamps;

    if (timestamps.length >= cfg.maxRequestsPerWindow) {
      const oldest = timestamps[0];
      const waitMs = cfg.windowMs - (now - oldest) + 50;
      if (waitMs > 15_000) {
        throw new Error(
          `Rate limit alcanzado para ${provider} (${cfg.maxRequestsPerWindow} req / ${
            cfg.windowMs / 1000
          }s). Reintenta en ${Math.ceil(waitMs / 1000)}s.`
        );
      }
      await new Promise((r) => setTimeout(r, waitMs));
    }

    const lastRequest = timestamps[timestamps.length - 1];
    if (lastRequest && Date.now() - lastRequest < cfg.minIntervalMs) {
      const delay = cfg.minIntervalMs - (Date.now() - lastRequest);
      await new Promise((r) => setTimeout(r, delay));
    }

    this.history[provider].push(Date.now());
  }

  getUsageStats(provider: DataProviderId): {
    usedInWindow: number;
    maxInWindow: number;
    windowSeconds: number;
  } {
    const cfg = PROVIDER_LIMITS[provider];
    const now = Date.now();
    this.history[provider] = this.history[provider].filter(
      (t) => now - t < cfg.windowMs
    );
    return {
      usedInWindow: this.history[provider].length,
      maxInWindow: cfg.maxRequestsPerWindow,
      windowSeconds: Math.round(cfg.windowMs / 1000),
    };
  }
}

export const globalRateLimiter = new RateLimiter();

/**
 * Executes an HTTP fetch controlled by the provider's RateLimiter and
 * retries transient failures (429 / 5xx / network timeout) with exponential backoff.
 */
export async function fetchWithRetry(
  provider: DataProviderId,
  url: string,
  init?: RequestInit,
  maxRetries = 2,
  timeoutMs = 10_000
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await globalRateLimiter.acquire(provider);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        return response;
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status} desde ${provider}`);
      } else {
        throw new Error(`HTTP ${response.status} desde ${provider}`);
      }
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
    }

    if (attempt < maxRetries) {
      const backoffMs = Math.min(4000, 400 * Math.pow(2, attempt)) + Math.random() * 150;
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Fallo de red consultando ${provider}`);
}

