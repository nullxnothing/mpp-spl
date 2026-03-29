import { describe, it, expect } from 'vitest';
import { usdToBaseUnits, baseUnitsToUsd } from '../../dist/index.js';

describe('price conversions', () => {
  describe('usdToBaseUnits', () => {
    it('converts 1 USD of USDC (6 decimals, price=1)', () => {
      // 1 USD / 1.00 per token = 1 token = 1_000_000 base units
      expect(usdToBaseUnits(1, 1.0, 6)).toBe('1000000');
    });

    it('converts 0.01 USD of BONK at price 0.00003 (5 decimals)', () => {
      // 0.01 / 0.00003 = 333.333 tokens → 33_333_300 base units (rounded)
      const result = usdToBaseUnits(0.01, 0.00003, 5);
      const asNumber = Number(BigInt(result));
      // ~333 BONK expressed in 5-decimal base units
      expect(asNumber).toBeGreaterThan(33_000_000);
      expect(asNumber).toBeLessThan(34_000_000);
    });

    it('converts 0.01 USD of BONK at 0.000025 (5 decimals)', () => {
      // 0.01 / 0.000025 = 400 tokens = 40_000_000 base units
      expect(usdToBaseUnits(0.01, 0.000025, 5)).toBe('40000000');
    });

    it('converts USD for SOL (9 decimals)', () => {
      // 1 USD at SOL price $150 → 0.006666... SOL → 6_666_667 lamports
      const result = usdToBaseUnits(1, 150, 9);
      const asNumber = Number(BigInt(result));
      expect(asNumber).toBeGreaterThan(6_600_000);
      expect(asNumber).toBeLessThan(6_700_000);
    });

    it('handles very small pump.fun token price (0.0000001)', () => {
      // 0.01 USD at 0.0000001 per token = 100_000 tokens
      // With 6 decimals: 100_000 * 1_000_000 = 100_000_000_000 base units
      const result = usdToBaseUnits(0.01, 0.0000001, 6);
      expect(result).toBe('100000000000');
    });

    it('handles extremely small token price (1e-10)', () => {
      const result = usdToBaseUnits(0.01, 1e-10, 6);
      // 0.01 / 1e-10 = 1e8 tokens → 1e8 * 1e6 = 1e14 base units
      expect(BigInt(result)).toBeGreaterThan(0n);
    });

    it('throws when usdPerToken is 0', () => {
      expect(() => usdToBaseUnits(1, 0, 6)).toThrow('usdPerToken must be positive');
    });

    it('throws when usdPerToken is negative', () => {
      expect(() => usdToBaseUnits(1, -0.5, 6)).toThrow('usdPerToken must be positive');
    });

    it('handles large decimals (9 for SOL)', () => {
      // 100 USD at $200/SOL = 0.5 SOL = 500_000_000 lamports
      expect(usdToBaseUnits(100, 200, 9)).toBe('500000000');
    });

    it('returns string (not number)', () => {
      expect(typeof usdToBaseUnits(1, 1, 6)).toBe('string');
    });
  });

  describe('baseUnitsToUsd', () => {
    it('converts USDC base units to USD (6 decimals, price=1)', () => {
      // 1_000_000 base units = 1 USDC = 1 USD
      expect(baseUnitsToUsd('1000000', 1.0, 6)).toBeCloseTo(1.0);
    });

    it('converts BONK base units at given price', () => {
      // 40_000_000 base units = 400 BONK at 0.000025/BONK = 0.01 USD
      expect(baseUnitsToUsd('40000000', 0.000025, 5)).toBeCloseTo(0.01);
    });

    it('is inverse of usdToBaseUnits (round-trip USDC)', () => {
      const baseUnits = usdToBaseUnits(5.25, 1.0, 6);
      const backToUsd = baseUnitsToUsd(baseUnits, 1.0, 6);
      expect(backToUsd).toBeCloseTo(5.25, 4);
    });

    it('is inverse of usdToBaseUnits (round-trip SOL)', () => {
      const baseUnits = usdToBaseUnits(10, 150, 9);
      const backToUsd = baseUnitsToUsd(baseUnits, 150, 9);
      expect(backToUsd).toBeCloseTo(10, 2);
    });

    it('handles large base unit strings', () => {
      // 100_000_000_000 base units of a 6-decimal token at 0.0000001/token
      // = 100_000 tokens * 0.0000001 = 0.01 USD
      const result = baseUnitsToUsd('100000000000', 0.0000001, 6);
      expect(result).toBeCloseTo(0.01, 6);
    });

    it('returns 0 for 0 base units', () => {
      expect(baseUnitsToUsd('0', 1.0, 6)).toBe(0);
    });
  });
});
