/**
 * Token registry — curated + runtime-extensible map of SPL tokens.
 *
 * Indexed by both symbol (uppercase) and mint address for O(1) lookups.
 */

export interface TokenEntry {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  /** "spl" for TOKEN_PROGRAM, "token2022" for TOKEN_2022_PROGRAM */
  program: 'spl' | 'token2022';
  /** Optional Jupiter price ID (defaults to mint address) */
  jupiterId?: string;
}

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const BUILTIN_TOKENS: TokenEntry[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    program: 'spl',
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
    program: 'spl',
  },
  {
    symbol: 'SOL',
    name: 'Wrapped SOL',
    mint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
    program: 'spl',
  },
  {
    symbol: 'BONK',
    name: 'Bonk',
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    decimals: 5,
    program: 'spl',
  },
  {
    symbol: 'WIF',
    name: 'dogwifhat',
    mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    decimals: 6,
    program: 'spl',
  },
  {
    symbol: 'JUP',
    name: 'Jupiter',
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    decimals: 6,
    program: 'spl',
  },
  {
    symbol: 'PYUSD',
    name: 'PayPal USD',
    mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
    decimals: 6,
    program: 'token2022',
  },
  {
    symbol: 'RAY',
    name: 'Raydium',
    mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    decimals: 6,
    program: 'spl',
  },
  {
    symbol: 'POPCAT',
    name: 'Popcat',
    mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
    decimals: 9,
    program: 'spl',
  },
  {
    symbol: 'MEW',
    name: 'cat in a dogs world',
    mint: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5',
    decimals: 5,
    program: 'spl',
  },
];

/** Symbol (uppercase) → TokenEntry */
const bySymbol = new Map<string, TokenEntry>();
/** Mint address → TokenEntry */
const byMint = new Map<string, TokenEntry>();

function index(token: TokenEntry): void {
  bySymbol.set(token.symbol.toUpperCase(), token);
  byMint.set(token.mint, token);
}

for (const token of BUILTIN_TOKENS) {
  index(token);
}

/**
 * Look up a token by symbol (case-insensitive) or mint address.
 * Returns undefined if not found.
 */
export function getToken(symbolOrMint: string): TokenEntry | undefined {
  return bySymbol.get(symbolOrMint.toUpperCase()) ?? byMint.get(symbolOrMint);
}

/**
 * Register a token at runtime. Overwrites any existing entry with the same
 * symbol or mint. Use this for pump.fun tokens launched minutes ago.
 */
export function registerToken(token: TokenEntry): void {
  const existing = bySymbol.get(token.symbol.toUpperCase());
  if (existing && existing.mint !== token.mint) {
    console.warn(
      `[mpp-spl] Overwriting token "${existing.symbol}" (${existing.mint}) with new mint ${token.mint}`,
    );
  }
  index(token);
}

/**
 * Returns all registered tokens (builtin + runtime-registered).
 */
export function getAllTokens(): TokenEntry[] {
  return [...byMint.values()];
}

/**
 * Resolve the on-chain token program address from a TokenEntry.
 */
export function tokenProgramAddress(token: TokenEntry): string {
  return token.program === 'token2022' ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;
}
