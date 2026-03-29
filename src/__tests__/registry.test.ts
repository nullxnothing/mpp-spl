import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getToken,
  registerToken,
  getAllTokens,
  tokenProgramAddress,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
} from '../../dist/index.js';

describe('registry', () => {
  describe('getToken', () => {
    it('returns token by symbol (exact case)', () => {
      const token = getToken('USDC');
      expect(token).toBeDefined();
      expect(token!.symbol).toBe('USDC');
      expect(token!.mint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    });

    it('returns token by symbol (lowercase)', () => {
      const token = getToken('usdc');
      expect(token).toBeDefined();
      expect(token!.symbol).toBe('USDC');
    });

    it('returns token by symbol (mixed case)', () => {
      const token = getToken('bOnK');
      expect(token).toBeDefined();
      expect(token!.symbol).toBe('BONK');
    });

    it('returns token by mint address', () => {
      const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const token = getToken(mint);
      expect(token).toBeDefined();
      expect(token!.symbol).toBe('USDC');
      expect(token!.mint).toBe(mint);
    });

    it('returns undefined for unknown symbol', () => {
      expect(getToken('NONEXISTENT')).toBeUndefined();
    });

    it('returns undefined for unknown mint address', () => {
      expect(getToken('11111111111111111111111111111111')).toBeUndefined();
    });

    it('returns SOL with 9 decimals', () => {
      const token = getToken('SOL');
      expect(token).toBeDefined();
      expect(token!.decimals).toBe(9);
    });
  });

  describe('registerToken', () => {
    it('adds a new token that can be retrieved by symbol', () => {
      registerToken({
        symbol: 'TESTTOKEN',
        name: 'Test Token',
        mint: 'TestMint111111111111111111111111111111111111',
        decimals: 6,
        program: 'spl',
      });
      const token = getToken('TESTTOKEN');
      expect(token).toBeDefined();
      expect(token!.name).toBe('Test Token');
    });

    it('added token can be retrieved by mint address', () => {
      const mint = 'TestMint222222222222222222222222222222222222';
      registerToken({
        symbol: 'TESTTOKEN2',
        name: 'Test Token 2',
        mint,
        decimals: 9,
        program: 'spl',
      });
      const token = getToken(mint);
      expect(token).toBeDefined();
      expect(token!.symbol).toBe('TESTTOKEN2');
    });

    it('overwrites existing symbol with different mint (emits console.warn)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      registerToken({
        symbol: 'WIF',
        name: 'dogwifhat overwritten',
        mint: 'NewMint111111111111111111111111111111111111',
        decimals: 6,
        program: 'spl',
      });

      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toContain('Overwriting token');

      const token = getToken('WIF');
      expect(token!.mint).toBe('NewMint111111111111111111111111111111111111');

      warnSpy.mockRestore();

      // Restore original for other tests
      registerToken({
        symbol: 'WIF',
        name: 'dogwifhat',
        mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
        decimals: 6,
        program: 'spl',
      });
    });

    it('does NOT warn when registering same symbol with same mint', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      registerToken({
        symbol: 'USDC',
        name: 'USD Coin',
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        decimals: 6,
        program: 'spl',
      });

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('getAllTokens', () => {
    it('returns an array', () => {
      expect(Array.isArray(getAllTokens())).toBe(true);
    });

    it('returns at least the built-in tokens', () => {
      const tokens = getAllTokens();
      const symbols = tokens.map((t) => t.symbol);
      expect(symbols).toContain('USDC');
      expect(symbols).toContain('USDT');
      expect(symbols).toContain('SOL');
      expect(symbols).toContain('BONK');
    });

    it('contains all required TokenEntry fields', () => {
      const tokens = getAllTokens();
      for (const token of tokens) {
        expect(token).toHaveProperty('symbol');
        expect(token).toHaveProperty('name');
        expect(token).toHaveProperty('mint');
        expect(token).toHaveProperty('decimals');
        expect(token).toHaveProperty('program');
      }
    });
  });

  describe('tokenProgramAddress', () => {
    it('returns TOKEN_PROGRAM for spl tokens', () => {
      const token = getToken('USDC')!;
      expect(token.program).toBe('spl');
      expect(tokenProgramAddress(token)).toBe(TOKEN_PROGRAM);
    });

    it('returns TOKEN_2022_PROGRAM for token2022 tokens', () => {
      const token = getToken('PYUSD')!;
      expect(token.program).toBe('token2022');
      expect(tokenProgramAddress(token)).toBe(TOKEN_2022_PROGRAM);
    });

    it('TOKEN_PROGRAM is the correct address', () => {
      expect(TOKEN_PROGRAM).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    });

    it('TOKEN_2022_PROGRAM is the correct address', () => {
      expect(TOKEN_2022_PROGRAM).toBe('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
    });
  });
});
