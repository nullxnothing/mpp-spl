/**
 * Server-side helpers for mpp-spl.
 *
 * resolveChargeConfig() combines the token registry + price providers to
 * produce everything @solana/mpp's solana.charge() needs.
 *
 * Middleware wrappers compose with mppx's Mppx.create() — they don't replace it.
 */

import { getToken, tokenProgramAddress, type TokenEntry } from './registry.js';
import { createPriceResolver, usdToBaseUnits } from './price/index.js';
import type { PriceResult } from './price/index.js';

// Re-export registry and price for convenience
export { getToken, registerToken, getAllTokens, tokenProgramAddress } from './registry.js';
export type { TokenEntry } from './registry.js';
export { usdToBaseUnits, baseUnitsToUsd } from './price/index.js';

export interface ResolveChargeConfigOptions {
  /** Token symbol (e.g. "BONK") or mint address */
  token: string;
  /** Recipient wallet pubkey */
  recipient: string;
  /** Charge in USD — amount floats with market price */
  usdAmount?: number;
  /** Charge in token base units — fixed quantity, no price lookup needed */
  tokenAmount?: string;
  /** Helius RPC URL — required for pump.fun token pricing */
  heliusRpcUrl?: string;
  /** Jupiter API key (optional, recommended for rate limits) */
  jupiterApiKey?: string;
}

export interface ResolvedChargeConfig {
  /** Mint address (or "sol" for native SOL) — maps to @solana/mpp currency */
  currency: string;
  /** Token decimals */
  decimals: number;
  /** Amount in base units as string — maps to @solana/mpp amount */
  amount: string;
  /** Human-readable display amount (e.g. "83400 BONK" or "1.00 USDC") */
  displayAmount: string;
  /** Recipient pubkey */
  recipient: string;
  /** Token program address */
  tokenProgram: string;
  /** Resolved token entry */
  token: TokenEntry;
  /** Price data used for conversion (null if tokenAmount mode) */
  price: PriceResult | null;
}

/**
 * Resolves everything needed to create an @solana/mpp charge.
 *
 * Two modes:
 * - `usdAmount`: converts USD to base units using live price (Jupiter or PumpFun)
 * - `tokenAmount`: uses the amount directly (no price lookup needed)
 *
 * @example
 * ```ts
 * const config = await resolveChargeConfig({
 *   token: 'BONK',
 *   recipient: 'RecipientPubkey...',
 *   usdAmount: 0.01,
 * })
 *
 * // Use with @solana/mpp:
 * solana.charge({
 *   recipient: config.recipient,
 *   currency: config.currency,
 *   decimals: config.decimals,
 * })
 * // Then in the charge handler:
 * mppx.charge({ amount: config.amount, currency: config.currency })
 * ```
 */
export async function resolveChargeConfig(
  options: ResolveChargeConfigOptions,
): Promise<ResolvedChargeConfig> {
  const { token: tokenRef, recipient, usdAmount, tokenAmount, heliusRpcUrl, jupiterApiKey } = options;

  if (usdAmount == null && !tokenAmount) {
    throw new Error('Either usdAmount or tokenAmount must be specified');
  }
  if (usdAmount != null && tokenAmount) {
    throw new Error('Cannot specify both usdAmount and tokenAmount');
  }
  if (usdAmount != null && usdAmount <= 0) {
    throw new Error('usdAmount must be a positive number');
  }

  // Resolve token from registry
  const token = getToken(tokenRef);
  if (!token) {
    throw new Error(
      `Token "${tokenRef}" not found in registry. ` +
      `Use registerToken() to add it first, or pass the mint address directly.`,
    );
  }

  const tokenProgram = tokenProgramAddress(token);

  // Fixed token amount mode — no price lookup
  if (tokenAmount) {
    const displayTokens = Number(BigInt(tokenAmount)) / 10 ** token.decimals;
    return {
      currency: token.mint,
      decimals: token.decimals,
      amount: tokenAmount,
      displayAmount: `${displayTokens} ${token.symbol}`,
      recipient,
      tokenProgram,
      token,
      price: null,
    };
  }

  // USD amount mode — need price
  const resolver = createPriceResolver({ jupiterApiKey, heliusRpcUrl });
  const price = await resolver.getPrice(token.mint);

  if (!price) {
    throw new Error(
      `No price data available for ${token.symbol} (${token.mint}). ` +
      (heliusRpcUrl
        ? 'Token may not be tradeable yet.'
        : 'Set heliusRpcUrl to enable pump.fun bonding curve pricing.'),
    );
  }

  const amount = usdToBaseUnits(usdAmount!, price.usdPerToken, token.decimals);
  const displayTokens = Number(BigInt(amount)) / 10 ** token.decimals;

  return {
    currency: token.mint,
    decimals: token.decimals,
    amount,
    displayAmount: `${displayTokens.toFixed(token.decimals > 6 ? 4 : 2)} ${token.symbol}`,
    recipient,
    tokenProgram,
    token,
    price,
  };
}

/**
 * Build the solana.charge() parameter object from a resolved config.
 * Pass this directly to @solana/mpp's server-side solana.charge().
 */
export function buildSolanaChargeParams(config: ResolvedChargeConfig) {
  return {
    recipient: config.recipient,
    currency: config.currency,
    decimals: config.decimals,
    tokenProgram: config.tokenProgram,
  };
}

/**
 * Creates a static charge middleware config. Resolves price once at startup.
 * Best for stable tokens (USDC, USDT) or fixed token amounts.
 */
export async function createChargeMiddleware(options: ResolveChargeConfigOptions) {
  const config = await resolveChargeConfig(options);
  return {
    chargeParams: buildSolanaChargeParams(config),
    amount: config.amount,
    currency: config.currency,
    config,
  };
}

/**
 * Creates a dynamic charge middleware that re-resolves price on every request.
 * Best for volatile tokens where price changes significantly between requests.
 */
export function createDynamicChargeMiddleware(options: ResolveChargeConfigOptions) {
  return {
    async resolve() {
      const config = await resolveChargeConfig(options);
      return {
        chargeParams: buildSolanaChargeParams(config),
        amount: config.amount,
        currency: config.currency,
        config,
      };
    },
  };
}
