import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveChargeConfig,
  buildSolanaChargeParams,
  registerToken,
  getToken,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
} from '../../dist/index.js';

// Stub fetch globally to avoid real network calls
function mockFetch(usdPrice: number, decimals = 6) {
  const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const urlStr = url.toString();
    // Jupiter Price API
    if (urlStr.includes('jup.ag/price')) {
      const params = new URL(urlStr).searchParams.get('ids') ?? '';
      const response: Record<string, unknown> = {};
      for (const id of params.split(',')) {
        response[id] = { usdPrice, decimals, blockId: 1, priceChange24h: 0 };
      }
      return new Response(JSON.stringify(response), { status: 200 });
    }
    throw new Error(`Unexpected fetch to: ${urlStr}`);
  });
}

const RECIPIENT = 'RecipientPubkey1111111111111111111111111111';

describe('resolveChargeConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when neither usdAmount nor tokenAmount is specified', async () => {
    await expect(
      resolveChargeConfig({ token: 'USDC', recipient: RECIPIENT }),
    ).rejects.toThrow('Either usdAmount or tokenAmount must be specified');
  });

  it('throws when both usdAmount and tokenAmount are specified', async () => {
    await expect(
      resolveChargeConfig({
        token: 'USDC',
        recipient: RECIPIENT,
        usdAmount: 1.0,
        tokenAmount: '1000000',
      }),
    ).rejects.toThrow('Cannot specify both usdAmount and tokenAmount');
  });

  it('throws when usdAmount is 0', async () => {
    await expect(
      resolveChargeConfig({ token: 'USDC', recipient: RECIPIENT, usdAmount: 0 }),
    ).rejects.toThrow('usdAmount must be a positive number');
  });

  it('throws when usdAmount is negative', async () => {
    await expect(
      resolveChargeConfig({ token: 'USDC', recipient: RECIPIENT, usdAmount: -5 }),
    ).rejects.toThrow('usdAmount must be a positive number');
  });

  it('throws when token is not in registry', async () => {
    await expect(
      resolveChargeConfig({
        token: 'NOTAREATOKEN',
        recipient: RECIPIENT,
        tokenAmount: '1000000',
      }),
    ).rejects.toThrow(/not found in registry/i);
  });

  it('resolves with tokenAmount mode (no price lookup needed)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const config = await resolveChargeConfig({
      token: 'USDC',
      recipient: RECIPIENT,
      tokenAmount: '5000000', // 5 USDC
    });

    // No network calls for token amount mode
    expect(fetchSpy).not.toHaveBeenCalled();

    const usdcToken = getToken('USDC')!;
    expect(config.currency).toBe(usdcToken.mint);
    expect(config.decimals).toBe(6);
    expect(config.amount).toBe('5000000');
    expect(config.displayAmount).toContain('USDC');
    expect(config.recipient).toBe(RECIPIENT);
    expect(config.tokenProgram).toBe(TOKEN_PROGRAM);
    expect(config.price).toBeNull();
  });

  it('tokenAmount mode displayAmount shows correct token quantity', async () => {
    const config = await resolveChargeConfig({
      token: 'USDC',
      recipient: RECIPIENT,
      tokenAmount: '2500000', // 2.5 USDC
    });
    // 2500000 / 10^6 = 2.5
    expect(config.displayAmount).toContain('2.5');
    expect(config.displayAmount).toContain('USDC');
  });

  it('tokenAmount mode with BONK (5 decimals)', async () => {
    const config = await resolveChargeConfig({
      token: 'BONK',
      recipient: RECIPIENT,
      tokenAmount: '100000000', // 1000 BONK
    });
    expect(config.amount).toBe('100000000');
    expect(config.decimals).toBe(5);
    expect(config.displayAmount).toContain('BONK');
    expect(config.price).toBeNull();
  });

  it('usdAmount mode fetches price and converts correctly', async () => {
    // Mock USDC at $1.00
    mockFetch(1.0, 6);

    const config = await resolveChargeConfig({
      token: 'USDC',
      recipient: RECIPIENT,
      usdAmount: 2.0,
    });

    expect(config.amount).toBe('2000000'); // 2 USDC at $1.00 = 2000000 base units
    expect(config.currency).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(config.price).not.toBeNull();
    expect(config.price!.source).toBe('jupiter');
  });

  it('uses TOKEN_2022_PROGRAM for token2022 tokens', async () => {
    const config = await resolveChargeConfig({
      token: 'PYUSD',
      recipient: RECIPIENT,
      tokenAmount: '1000000',
    });
    expect(config.tokenProgram).toBe(TOKEN_2022_PROGRAM);
  });
});

describe('buildSolanaChargeParams', () => {
  it('returns correct structure from a resolved config', async () => {
    const config = await resolveChargeConfig({
      token: 'USDC',
      recipient: RECIPIENT,
      tokenAmount: '1000000',
    });

    const params = buildSolanaChargeParams(config);

    expect(params).toEqual({
      recipient: RECIPIENT,
      currency: config.currency,
      decimals: config.decimals,
      tokenProgram: config.tokenProgram,
    });
  });

  it('returned object has exactly the four expected keys', async () => {
    const config = await resolveChargeConfig({
      token: 'SOL',
      recipient: RECIPIENT,
      tokenAmount: '1000000000',
    });

    const params = buildSolanaChargeParams(config);
    const keys = Object.keys(params).sort();

    expect(keys).toEqual(['currency', 'decimals', 'recipient', 'tokenProgram']);
  });
});
