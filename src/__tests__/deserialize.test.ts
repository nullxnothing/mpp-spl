import { describe, it, expect } from 'vitest';
import { deserializeBondingCurve } from '../../dist/index.js';

/**
 * Account layout (offsets):
 *   0x00 (0)  discriminator      u64   [0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]
 *   0x08 (8)  virtualTokenRes    u64   (little-endian)
 *   0x10 (16) virtualSolRes      u64
 *   0x18 (24) realTokenRes       u64
 *   0x20 (32) realSolRes         u64
 *   0x28 (40) tokenTotalSupply   u64
 *   0x30 (48) complete           bool  (1 byte)
 *   0x31 (49) creator            Pubkey (32 bytes)
 *   0x51 (81) isMayhemMode       bool
 *   0x52 (82) isCashbackEnabled  bool
 *   Total minimum: 83 bytes. Tests use 151-byte buffers matching real accounts.
 */

const DISCRIMINATOR = [0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60];

function buildMockAccount(options: {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolRes: bigint;
  tokenTotalSupply: bigint;
  isComplete: boolean;
  creatorBytes: Uint8Array; // 32 bytes
  isMayhemMode: boolean;
  isCashbackEnabled: boolean;
  size?: number;
}): Uint8Array {
  const size = options.size ?? 151;
  const buf = new Uint8Array(size);
  const view = new DataView(buf.buffer);

  // discriminator
  for (let i = 0; i < 8; i++) buf[i] = DISCRIMINATOR[i];

  view.setBigUint64(8, options.virtualTokenReserves, true);
  view.setBigUint64(16, options.virtualSolReserves, true);
  view.setBigUint64(24, options.realTokenReserves, true);
  view.setBigUint64(32, options.realSolRes, true);
  view.setBigUint64(40, options.tokenTotalSupply, true);
  buf[48] = options.isComplete ? 1 : 0;
  buf.set(options.creatorBytes.slice(0, 32), 49);
  buf[81] = options.isMayhemMode ? 1 : 0;
  buf[82] = options.isCashbackEnabled ? 1 : 0;

  return buf;
}

// A 32-byte creator pubkey (all 2s for easy identification)
const CREATOR_BYTES = new Uint8Array(32).fill(2);

describe('deserializeBondingCurve', () => {
  it('deserializes all fields from a 151-byte mock account', () => {
    const mock = buildMockAccount({
      virtualTokenReserves: 1_073_000_000_000_000n,
      virtualSolReserves: 30_000_000_000n,
      realTokenReserves: 793_100_000_000_000n,
      realSolRes: 0n,
      tokenTotalSupply: 1_000_000_000_000_000n,
      isComplete: false,
      creatorBytes: CREATOR_BYTES,
      isMayhemMode: false,
      isCashbackEnabled: false,
    });

    const state = deserializeBondingCurve(mock);

    expect(state.virtualTokenReserves).toBe(1_073_000_000_000_000n);
    expect(state.virtualSolReserves).toBe(30_000_000_000n);
    expect(state.realTokenReserves).toBe(793_100_000_000_000n);
    expect(state.realSolReserves).toBe(0n);
    expect(state.tokenTotalSupply).toBe(1_000_000_000_000_000n);
    expect(state.isComplete).toBe(false);
    expect(state.isMayhemMode).toBe(false);
    expect(state.isCashbackEnabled).toBe(false);
  });

  it('correctly reads isComplete = true', () => {
    const mock = buildMockAccount({
      virtualTokenReserves: 100n,
      virtualSolReserves: 100n,
      realTokenReserves: 100n,
      realSolRes: 100n,
      tokenTotalSupply: 100n,
      isComplete: true,
      creatorBytes: CREATOR_BYTES,
      isMayhemMode: false,
      isCashbackEnabled: false,
    });

    const state = deserializeBondingCurve(mock);
    expect(state.isComplete).toBe(true);
  });

  it('correctly reads isMayhemMode = true', () => {
    const mock = buildMockAccount({
      virtualTokenReserves: 100n,
      virtualSolReserves: 100n,
      realTokenReserves: 100n,
      realSolRes: 100n,
      tokenTotalSupply: 100n,
      isComplete: false,
      creatorBytes: CREATOR_BYTES,
      isMayhemMode: true,
      isCashbackEnabled: false,
    });

    const state = deserializeBondingCurve(mock);
    expect(state.isMayhemMode).toBe(true);
    expect(state.isCashbackEnabled).toBe(false);
  });

  it('correctly reads isCashbackEnabled = true', () => {
    const mock = buildMockAccount({
      virtualTokenReserves: 100n,
      virtualSolReserves: 100n,
      realTokenReserves: 100n,
      realSolRes: 100n,
      tokenTotalSupply: 100n,
      isComplete: false,
      creatorBytes: CREATOR_BYTES,
      isMayhemMode: false,
      isCashbackEnabled: true,
    });

    const state = deserializeBondingCurve(mock);
    expect(state.isCashbackEnabled).toBe(true);
  });

  it('decodes creator as a non-empty base58 string', () => {
    const mock = buildMockAccount({
      virtualTokenReserves: 100n,
      virtualSolReserves: 100n,
      realTokenReserves: 100n,
      realSolRes: 100n,
      tokenTotalSupply: 100n,
      isComplete: false,
      creatorBytes: CREATOR_BYTES,
      isMayhemMode: false,
      isCashbackEnabled: false,
    });

    const state = deserializeBondingCurve(mock);
    expect(typeof state.creator).toBe('string');
    expect(state.creator.length).toBeGreaterThan(0);
    // Base58 characters only
    expect(state.creator).toMatch(/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/);
  });

  it('handles large u64 values (max safe BigInt range)', () => {
    const largeValue = 18_446_744_073_709_551_615n; // u64 max
    const mock = buildMockAccount({
      virtualTokenReserves: largeValue,
      virtualSolReserves: largeValue,
      realTokenReserves: largeValue,
      realSolRes: largeValue,
      tokenTotalSupply: largeValue,
      isComplete: false,
      creatorBytes: CREATOR_BYTES,
      isMayhemMode: false,
      isCashbackEnabled: false,
    });

    const state = deserializeBondingCurve(mock);
    expect(state.virtualTokenReserves).toBe(largeValue);
    expect(state.virtualSolReserves).toBe(largeValue);
  });

  describe('error cases', () => {
    it('throws when buffer is smaller than minimum size', () => {
      const tooSmall = new Uint8Array(50);
      for (let i = 0; i < 8; i++) tooSmall[i] = DISCRIMINATOR[i];

      expect(() => deserializeBondingCurve(tooSmall)).toThrow(
        /too small/i,
      );
    });

    it('throws when discriminator bytes are wrong', () => {
      const mock = buildMockAccount({
        virtualTokenReserves: 100n,
        virtualSolReserves: 100n,
        realTokenReserves: 100n,
        realSolRes: 100n,
        tokenTotalSupply: 100n,
        isComplete: false,
        creatorBytes: CREATOR_BYTES,
        isMayhemMode: false,
        isCashbackEnabled: false,
      });

      // Corrupt first discriminator byte
      mock[0] = 0xff;

      expect(() => deserializeBondingCurve(mock)).toThrow(
        /discriminator/i,
      );
    });

    it('throws when last discriminator byte is wrong', () => {
      const mock = buildMockAccount({
        virtualTokenReserves: 100n,
        virtualSolReserves: 100n,
        realTokenReserves: 100n,
        realSolRes: 100n,
        tokenTotalSupply: 100n,
        isComplete: false,
        creatorBytes: CREATOR_BYTES,
        isMayhemMode: false,
        isCashbackEnabled: false,
      });

      // Corrupt last discriminator byte (index 7)
      mock[7] = mock[7] ^ 0xff;

      expect(() => deserializeBondingCurve(mock)).toThrow(
        /discriminator/i,
      );
    });
  });
});
