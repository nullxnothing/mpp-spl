/**
 * Price provider interface and auto-detection.
 *
 * Tries Jupiter first. If the token is not found on Jupiter and a Helius
 * RPC URL is configured, falls back to the PumpFun bonding curve reader.
 */

export interface PriceResult {
  usdPerToken: number;
  decimals: number;
  source: string;
  cached: boolean;
}

export interface PriceProvider {
  readonly source: string;
  getPrice(mint: string): Promise<PriceResult | null>;
  getMultiplePrices(mints: string[]): Promise<Map<string, PriceResult>>;
}

export { JupiterPriceProvider, usdToBaseUnits, baseUnitsToUsd } from './jupiter.js';
export { PumpFunPriceProvider, deriveBondingCurvePDA, deserializeBondingCurve } from './pumpfun.js';
export type { BondingCurveState, PumpFunPriceResult } from './pumpfun.js';

import { JupiterPriceProvider } from './jupiter.js';
import { PumpFunPriceProvider } from './pumpfun.js';

export interface ResolvePriceOptions {
  /** Token mint address */
  mint: string;
  /** Jupiter API key (optional, recommended) */
  jupiterApiKey?: string;
  /** Helius RPC URL — required for pump.fun fallback */
  heliusRpcUrl?: string;
}

/**
 * Auto-resolves price for any SPL token.
 *
 * 1. Tries Jupiter Price API v3
 * 2. If Jupiter returns nothing and heliusRpcUrl is set, tries PumpFun bonding curve
 * 3. Returns null if neither source has data
 */
export async function resolvePrice(options: ResolvePriceOptions): Promise<PriceResult | null> {
  const { mint, jupiterApiKey, heliusRpcUrl } = options;

  // Try Jupiter first (covers graduated tokens, major SPL tokens)
  const jupiter = new JupiterPriceProvider({ apiKey: jupiterApiKey });
  const jupiterResult = await jupiter.getPrice(mint);

  if (jupiterResult) return jupiterResult;

  // Fall back to PumpFun bonding curve if Helius RPC is available
  if (heliusRpcUrl) {
    const pumpfun = new PumpFunPriceProvider({
      rpcUrl: heliusRpcUrl,
      jupiterApiKey,
    });
    return pumpfun.getPrice(mint);
  }

  return null;
}

/**
 * Create a reusable price resolver with cached provider instances.
 * Use this when making multiple price lookups to avoid re-creating providers.
 */
export function createPriceResolver(options: {
  jupiterApiKey?: string;
  heliusRpcUrl?: string;
}) {
  const jupiter = new JupiterPriceProvider({ apiKey: options.jupiterApiKey });
  const pumpfun = options.heliusRpcUrl
    ? new PumpFunPriceProvider({
        rpcUrl: options.heliusRpcUrl,
        jupiterProvider: jupiter, // Share cache with Jupiter provider
      })
    : null;

  return {
    jupiter,
    pumpfun,

    async getPrice(mint: string): Promise<PriceResult | null> {
      const jupiterResult = await jupiter.getPrice(mint);
      if (jupiterResult) return jupiterResult;
      if (pumpfun) return pumpfun.getPrice(mint);
      return null;
    },
  };
}
