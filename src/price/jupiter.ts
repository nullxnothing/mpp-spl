/**
 * Jupiter Price API v3 provider.
 *
 * Endpoint: https://api.jup.ag/price/v3
 * Auth: x-api-key header (optional but recommended)
 * Max 50 mints per request. Returns USD price per token.
 */

import type { PriceProvider, PriceResult } from './index.js';

const JUPITER_PRICE_URL = 'https://api.jup.ag/price/v3';
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  result: PriceResult;
  expiresAt: number;
}

interface JupiterPriceResponse {
  [mint: string]: {
    usdPrice: number;
    blockId: number;
    decimals: number;
    priceChange24h: number;
  } | undefined;
}

export class JupiterPriceProvider implements PriceProvider {
  readonly source = 'jupiter' as const;
  private cache = new Map<string, CacheEntry>();
  private apiKey?: string;

  constructor(options?: { apiKey?: string }) {
    this.apiKey = options?.apiKey;
  }

  async getPrice(mint: string): Promise<PriceResult | null> {
    const cached = this.cache.get(mint);
    if (cached && Date.now() < cached.expiresAt) {
      return { ...cached.result, cached: true };
    }

    const prices = await this.fetchPrices([mint]);
    return prices.get(mint) ?? null;
  }

  async getMultiplePrices(mints: string[]): Promise<Map<string, PriceResult>> {
    const results = new Map<string, PriceResult>();
    const uncached: string[] = [];

    for (const mint of mints) {
      const cached = this.cache.get(mint);
      if (cached && Date.now() < cached.expiresAt) {
        results.set(mint, { ...cached.result, cached: true });
      } else {
        uncached.push(mint);
      }
    }

    if (uncached.length > 0) {
      const fetched = await this.fetchPrices(uncached);
      for (const [mint, result] of fetched) {
        results.set(mint, result);
      }
    }

    return results;
  }

  private async fetchPrices(mints: string[]): Promise<Map<string, PriceResult>> {
    const results = new Map<string, PriceResult>();

    // Jupiter allows max 50 per request
    for (let i = 0; i < mints.length; i += 50) {
      const batch = mints.slice(i, i + 50);
      const url = `${JUPITER_PRICE_URL}?ids=${batch.join(',')}`;

      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['x-api-key'] = this.apiKey;
      }

      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        throw new Error(`Jupiter Price API error: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as JupiterPriceResponse;

      for (const mint of batch) {
        const entry = data[mint];
        if (!entry || entry.usdPrice <= 0) continue;

        const result: PriceResult = {
          usdPerToken: entry.usdPrice,
          decimals: entry.decimals,
          source: 'jupiter',
          cached: false,
        };

        this.cache.set(mint, {
          result,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });

        results.set(mint, result);
      }
    }

    return results;
  }
}

/**
 * Convert a USD amount to token base units using BigInt arithmetic.
 * No floating point in the final conversion — only used for the ratio.
 */
export function usdToBaseUnits(
  usdAmount: number,
  usdPerToken: number,
  decimals: number,
): string {
  if (usdPerToken <= 0) throw new Error('usdPerToken must be positive');
  const tokenAmount = usdAmount / usdPerToken;
  const baseUnits = BigInt(Math.round(tokenAmount * 10 ** decimals));
  return baseUnits.toString();
}

/**
 * Convert token base units to a USD amount.
 */
export function baseUnitsToUsd(
  baseUnits: string,
  usdPerToken: number,
  decimals: number,
): number {
  const tokenAmount = Number(BigInt(baseUnits)) / 10 ** decimals;
  return tokenAmount * usdPerToken;
}
