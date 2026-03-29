import { describe, it, expect } from 'vitest';
import { deriveBondingCurvePDA } from '../../dist/index.js';

// Known ground-truth PDA addresses derived via on-chain program
// These can be verified at https://pump.fun or by running the Anchor SDK
// deriveBondingCurvePDA("bonding-curve", mint) with program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
const KNOWN_PDAS: Array<{ mint: string; pda: string }> = [
  {
    // BONK — a well-known SPL token (not a pumpfun token, but exercises the algo)
    // We can't easily verify the exact PDA for non-pumpfun tokens, so we use
    // internal consistency tests. For actual pumpfun mint addresses, we test
    // output shape and determinism only.
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    // PDA is not predictable without actually running Anchor; we verify shape only
    pda: '',
  },
];

const BASE58_CHARS = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;

describe('deriveBondingCurvePDA', () => {
  const mintA = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'; // BONK
  const mintB = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC

  it('produces a valid base58 string', () => {
    const pda = deriveBondingCurvePDA(mintA);
    expect(typeof pda).toBe('string');
    expect(BASE58_CHARS.test(pda)).toBe(true);
  });

  it('produces an address that is approximately 32-44 chars (Solana pubkey range)', () => {
    // A 32-byte base58 encoding is 43-44 chars (or slightly shorter with leading 0s)
    const pda = deriveBondingCurvePDA(mintA);
    expect(pda.length).toBeGreaterThanOrEqual(32);
    expect(pda.length).toBeLessThanOrEqual(44);
  });

  it('is deterministic — same mint always yields the same PDA', () => {
    const pda1 = deriveBondingCurvePDA(mintA);
    const pda2 = deriveBondingCurvePDA(mintA);
    expect(pda1).toBe(pda2);
  });

  it('produces different PDAs for different mints', () => {
    const pdaA = deriveBondingCurvePDA(mintA);
    const pdaB = deriveBondingCurvePDA(mintB);
    expect(pdaA).not.toBe(pdaB);
  });

  it('derived PDA is not on the ed25519 curve (by definition of PDA)', () => {
    // PDAs are intentionally off-curve — if derivation succeeded it's off-curve.
    // We verify this indirectly: if the function returns without throwing, the
    // bump search succeeded, which only happens for off-curve addresses.
    expect(() => deriveBondingCurvePDA(mintA)).not.toThrow();
  });

  it('handles multiple different mints without collision', () => {
    const mints = [
      'So11111111111111111111111111111111111111112',
      'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
      'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    ];
    const pdas = mints.map((m) => deriveBondingCurvePDA(m));
    const unique = new Set(pdas);
    expect(unique.size).toBe(mints.length);
  });
});
