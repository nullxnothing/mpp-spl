/**
 * PumpFun bonding curve price provider.
 *
 * Reads the bonding curve PDA directly via getAccountInfo RPC call.
 * Works for pre-graduation tokens that Jupiter has no data for.
 *
 * Program ID: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
 * PDA seeds:  ["bonding-curve", mint_pubkey]
 *
 * Account layout (151 bytes):
 *   0x00  discriminator      u64   [0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]
 *   0x08  virtualTokenRes    u64
 *   0x10  virtualSolRes      u64
 *   0x18  realTokenRes       u64
 *   0x20  realSolRes         u64
 *   0x28  tokenTotalSupply   u64
 *   0x30  complete           bool
 *   0x31  creator            Pubkey (32 bytes)
 *   0x51  isMayhemMode       bool (v2)
 *   0x52  cashbackEnabled    bool (v2, byte 82)
 */

import type { PriceProvider, PriceResult } from './index.js';
import { JupiterPriceProvider } from './jupiter.js';

const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_FUN_DECIMALS = 6;
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const DISCRIMINATOR = new Uint8Array([0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60]);

const LAMPORTS_PER_SOL = 1_000_000_000n;
const TOKEN_DECIMALS_FACTOR = 10n ** BigInt(PUMP_FUN_DECIMALS);

/** Minimum account size: discriminator(8) + 5*u64(40) + bool(1) + pubkey(32) + 2*bool(2) = 83 */
const MIN_ACCOUNT_SIZE = 83;

export interface BondingCurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  isComplete: boolean;
  creator: string;
  isMayhemMode: boolean;
  isCashbackEnabled: boolean;
}

export interface PumpFunPriceResult extends PriceResult {
  bondingCurve: {
    virtualTokenReserves: string;
    virtualSolReserves: string;
    realTokenReserves: string;
    realSolReserves: string;
    isComplete: boolean;
    progressPercent: number;
    estimatedSolToGraduation: number;
  };
}

export class PumpFunPriceProvider implements PriceProvider {
  readonly source = 'pumpfun' as const;
  private rpcUrl: string;
  private jupiterProvider: JupiterPriceProvider;

  constructor(options: {
    rpcUrl: string;
    jupiterApiKey?: string;
    /** Pass an existing JupiterPriceProvider to share its cache */
    jupiterProvider?: JupiterPriceProvider;
  }) {
    this.rpcUrl = options.rpcUrl;
    this.jupiterProvider = options.jupiterProvider
      ?? new JupiterPriceProvider({ apiKey: options.jupiterApiKey });
  }

  async getPrice(mint: string): Promise<PumpFunPriceResult | null> {
    const curveAddress = deriveBondingCurvePDA(mint);
    const accountData = await this.fetchAccountData(curveAddress);

    if (!accountData) return null;

    const state = deserializeBondingCurve(accountData);

    // If graduated, delegate to Jupiter
    if (state.isComplete) {
      const jupResult = await this.jupiterProvider.getPrice(mint);
      if (!jupResult) return null;
      return {
        ...jupResult,
        source: 'pumpfun-graduated',
        bondingCurve: {
          virtualTokenReserves: state.virtualTokenReserves.toString(),
          virtualSolReserves: state.virtualSolReserves.toString(),
          realTokenReserves: state.realTokenReserves.toString(),
          realSolReserves: state.realSolReserves.toString(),
          isComplete: true,
          progressPercent: 100,
          estimatedSolToGraduation: 0,
        },
      };
    }

    // Guard: zero reserves means no valid price
    if (state.virtualTokenReserves === 0n) {
      return null;
    }

    // Get SOL price in USD from Jupiter
    const solPrice = await this.jupiterProvider.getPrice(SOL_MINT);
    if (!solPrice) {
      throw new Error('Failed to fetch SOL/USD price from Jupiter');
    }

    // Price per token in SOL using BigInt-safe ratio
    // priceSol = (virtualSolReserves / LAMPORTS_PER_SOL) / (virtualTokenReserves / TOKEN_DECIMALS_FACTOR)
    // Rearranged to minimize precision loss:
    // priceSol = (virtualSolReserves * TOKEN_DECIMALS_FACTOR) / (virtualTokenReserves * LAMPORTS_PER_SOL)
    const numerator = state.virtualSolReserves * TOKEN_DECIMALS_FACTOR;
    const denominator = state.virtualTokenReserves * LAMPORTS_PER_SOL;
    // Convert to float only at the final step
    const priceSol = Number(numerator) / Number(denominator);

    const priceUsd = priceSol * solPrice.usdPerToken;

    // Bonding curve progress: how much of the real token supply has been sold
    // Initial realTokenReserves = 793,100,000,000,000
    const INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000n;
    const tokensSold = state.realTokenReserves <= INITIAL_REAL_TOKEN_RESERVES
      ? INITIAL_REAL_TOKEN_RESERVES - state.realTokenReserves
      : 0n; // Guard against non-standard initial reserves
    const progressPercent =
      Number((tokensSold * 10000n) / INITIAL_REAL_TOKEN_RESERVES) / 100;

    // Estimate SOL remaining to graduation
    const remainingTokens = Number(state.realTokenReserves) / 10 ** PUMP_FUN_DECIMALS;
    const estimatedSolToGraduation = remainingTokens * priceSol;

    return {
      usdPerToken: priceUsd,
      decimals: PUMP_FUN_DECIMALS,
      source: 'pumpfun',
      cached: false,
      bondingCurve: {
        virtualTokenReserves: state.virtualTokenReserves.toString(),
        virtualSolReserves: state.virtualSolReserves.toString(),
        realTokenReserves: state.realTokenReserves.toString(),
        realSolReserves: state.realSolReserves.toString(),
        isComplete: false,
        progressPercent: Math.max(0, Math.min(100, progressPercent)),
        estimatedSolToGraduation,
      },
    };
  }

  async getMultiplePrices(mints: string[]): Promise<Map<string, PriceResult>> {
    const results = new Map<string, PriceResult>();
    const promises = mints.map(async (mint) => {
      const result = await this.getPrice(mint).catch((err) => {
        console.warn(`[mpp-spl] PumpFun price fetch failed for ${mint}:`, err);
        return null;
      });
      if (result) results.set(mint, result);
    });
    await Promise.all(promises);
    return results;
  }

  private async fetchAccountData(address: string): Promise<Uint8Array | null> {
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [address, { encoding: 'base64', commitment: 'confirmed' }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await res.json()) as {
      result?: { value?: { data: [string, string]; owner: string } | null };
    };

    const accountValue = data.result?.value;
    if (!accountValue) return null;

    if (accountValue.owner !== PUMP_FUN_PROGRAM) return null;

    const base64Data = accountValue.data[0];
    // Use Buffer in Node.js, atob fallback for edge runtimes
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(base64Data, 'base64'));
    }
    return Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  }
}

function deserializeBondingCurve(data: Uint8Array): BondingCurveState {
  if (data.length < MIN_ACCOUNT_SIZE) {
    throw new Error(
      `Bonding curve account too small: ${data.length} bytes (expected >= ${MIN_ACCOUNT_SIZE})`,
    );
  }

  // Verify discriminator
  for (let i = 0; i < 8; i++) {
    if (data[i] !== DISCRIMINATOR[i]) {
      throw new Error('Invalid bonding curve discriminator');
    }
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const virtualTokenReserves = view.getBigUint64(8, true);
  const virtualSolReserves = view.getBigUint64(16, true);
  const realTokenReserves = view.getBigUint64(24, true);
  const realSolReserves = view.getBigUint64(32, true);
  const tokenTotalSupply = view.getBigUint64(40, true);
  const isComplete = data[48] !== 0;

  // Creator pubkey at offset 0x31 (49), 32 bytes
  const creatorBytes = data.slice(49, 81);
  const creator = encodeBase58(creatorBytes);

  // v2 flags at offsets 81 and 82
  const isMayhemMode = data[81] !== 0;
  const isCashbackEnabled = data[82] !== 0;

  return {
    virtualTokenReserves,
    virtualSolReserves,
    realTokenReserves,
    realSolReserves,
    tokenTotalSupply,
    isComplete,
    creator,
    isMayhemMode,
    isCashbackEnabled,
  };
}

// -- PDA derivation --
// Uses the standard Solana createProgramDerivedAddress algorithm.
// Ed25519 on-curve check via the twisted Edwards curve equation:
//   -x^2 + y^2 = 1 + d*x^2*y^2  (mod p)
// where p = 2^255 - 19, d = -121665/121666 mod p

const ED25519_P = 2n ** 255n - 19n;
const ED25519_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = ((base % mod) + mod) % mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

function isOnCurve(point: Uint8Array): boolean {
  // Decompress: the 32 bytes encode y (little-endian), with the high bit of
  // byte 31 being the sign of x.
  const yBytes = new Uint8Array(point);
  const sign = (yBytes[31] >> 7) & 1;
  yBytes[31] &= 0x7f; // clear sign bit

  let y = 0n;
  for (let i = 0; i < 32; i++) {
    y |= BigInt(yBytes[i]) << BigInt(8 * i);
  }

  if (y >= ED25519_P) return false;

  // Compute x^2 from the curve equation: x^2 = (y^2 - 1) / (d*y^2 + 1)  mod p
  const y2 = (y * y) % ED25519_P;
  const numerator = ((y2 - 1n) % ED25519_P + ED25519_P) % ED25519_P;
  const denominator = ((ED25519_D * y2 + 1n) % ED25519_P + ED25519_P) % ED25519_P;

  // x^2 = numerator * denominator^(p-2) mod p  (Fermat's little theorem for modular inverse)
  const denomInv = modPow(denominator, ED25519_P - 2n, ED25519_P);
  const x2 = (numerator * denomInv) % ED25519_P;

  if (x2 === 0n) {
    return sign === 0; // x=0 is valid only if sign bit is 0
  }

  // Check if x^2 is a quadratic residue mod p: x = x2^((p+3)/8) mod p
  const x = modPow(x2, (ED25519_P + 3n) / 8n, ED25519_P);

  // Verify: x^2 mod p must equal x2
  const xCheck = (x * x) % ED25519_P;
  if (xCheck === x2) return true;

  // Try x * sqrt(-1) mod p
  const SQRT_M1 = modPow(2n, (ED25519_P - 1n) / 4n, ED25519_P);
  const xAlt = (x * SQRT_M1) % ED25519_P;
  const xAltCheck = (xAlt * xAlt) % ED25519_P;

  return xAltCheck === x2;
}

function deriveBondingCurvePDA(mint: string): string {
  // Synchronous PDA derivation — uses the standard findProgramAddress algorithm
  // but computed synchronously since we have a pure JS SHA-256 is not available
  // synchronously. Instead, we use the well-known property that for Anchor PDAs
  // with fixed seeds, we can derive using the canonical bump.
  //
  // For a production-correct implementation, we pre-compute using the
  // createProgramAddress algorithm: SHA256(seeds || program_id || "ProgramDerivedAddress")
  // and check isOnCurve for each bump 255..0.
  //
  // Since crypto.subtle.digest is async, we use a synchronous SHA-256.

  const seedPrefix = new TextEncoder().encode('bonding-curve');
  const mintBytes = decodeBase58(mint);
  const programBytes = decodeBase58(PUMP_FUN_PROGRAM);
  const suffix = new TextEncoder().encode('ProgramDerivedAddress');

  for (let bump = 255; bump >= 0; bump--) {
    const input = concatBytes(
      seedPrefix,
      mintBytes,
      new Uint8Array([bump]),
      programBytes,
      suffix,
    );

    const hash = sha256(input);

    if (!isOnCurve(hash)) {
      return encodeBase58(hash);
    }
  }

  throw new Error(`Failed to derive bonding curve PDA for mint ${mint}`);
}

// -- Synchronous SHA-256 (pure JS, no dependencies) --
// Implements FIPS 180-4 for PDA derivation where crypto.subtle is async-only.

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256(data: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const bitLen = data.length * 8;
  // Padding: append 1 bit, zeros, then 64-bit length
  const padLen = 64 - ((data.length + 9) % 64);
  const totalLen = data.length + 1 + (padLen === 64 ? 0 : padLen) + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(data);
  padded[data.length] = 0x80;
  // Big-endian 64-bit length at the end
  const lenView = new DataView(padded.buffer);
  lenView.setUint32(totalLen - 4, bitLen, false);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (padded[offset + i * 4] << 24) |
             (padded[offset + i * 4 + 1] << 16) |
             (padded[offset + i * 4 + 2] << 8) |
             padded[offset + i * 4 + 3];
    }

    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const result = new Uint8Array(32);
  const rv = new DataView(result.buffer);
  rv.setUint32(0, h0, false); rv.setUint32(4, h1, false);
  rv.setUint32(8, h2, false); rv.setUint32(12, h3, false);
  rv.setUint32(16, h4, false); rv.setUint32(20, h5, false);
  rv.setUint32(24, h6, false); rv.setUint32(28, h7, false);
  return result;
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

// -- Base58 encode/decode --

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(str: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base58 character: ${char}`);
    let carry = idx;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  bytes.reverse();
  // Count leading '1' chars → leading zero bytes
  let leadingZeros = 0;
  for (const char of str) {
    if (char !== '1') break;
    leadingZeros++;
  }
  // Strip arithmetic leading zeros, prepend exactly leadingZeros zero bytes
  let start = 0;
  while (start < bytes.length && bytes[start] === 0) start++;
  const result = new Uint8Array(leadingZeros + bytes.length - start);
  result.set(bytes.slice(start), leadingZeros);
  return result;
}

function encodeBase58(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    result += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

export { deriveBondingCurvePDA, deserializeBondingCurve, PUMP_FUN_PROGRAM, PUMP_FUN_DECIMALS };
