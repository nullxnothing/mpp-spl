import { describe, it, expect } from 'vitest';
import { sha256, toHex } from './sha256-helper.js';

/**
 * Tests the synchronous pure-JS SHA-256 implementation used internally for PDA derivation.
 * Test vectors from FIPS 180-4 / NIST CAVS.
 */

function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

describe('sha256', () => {
  it('produces correct hash for empty input (NIST vector)', () => {
    const result = sha256(new Uint8Array(0));
    expect(toHex(result)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb924' +
      '27ae41e4649b934ca495991b7852b855',
    );
  });

  it('produces correct hash for "abc" (NIST vector)', () => {
    const result = sha256(encode('abc'));
    expect(toHex(result)).toBe(
      'ba7816bf8f01cfea414140de5dae2223' +
      'b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('produces correct hash for long multi-block input (NIST vector)', () => {
    // NIST SHA-256 test vector: 448-bit (56-byte) input spanning two blocks
    // Reference: FIPS 180-4, Section B.2 — SHA-256 example
    const msg = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    const result = sha256(encode(msg));
    expect(toHex(result)).toBe(
      '248d6a61d20638b8e5c026930c3e6039' +
      'a33ce45964ff2167f6ecedd419db06c1',
    );
    // Cross-check: the msg is exactly 56 characters / 448 bits
  });

  it('produces correct hash for "The quick brown fox jumps over the lazy dog"', () => {
    const result = sha256(encode('The quick brown fox jumps over the lazy dog'));
    expect(toHex(result)).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f' +
      '8d5651e46d3cdb762d02d0bf37c9e592',
    );
  });

  it('returns a 32-byte Uint8Array', () => {
    const result = sha256(encode('test'));
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(32);
  });

  it('is deterministic — same input always produces same output', () => {
    const input = encode('deterministic test input');
    const a = sha256(input);
    const b = sha256(input);
    expect(toHex(a)).toBe(toHex(b));
  });

  it('produces different hashes for different inputs', () => {
    const a = sha256(encode('input one'));
    const b = sha256(encode('input two'));
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it('handles binary input (all-zeros 32 bytes)', () => {
    // Known: SHA256 of 32 zero bytes
    const result = sha256(new Uint8Array(32));
    expect(toHex(result)).toBe(
      '66687aadf862bd776c8fc18b8e9f8e20' +
      '089714856ee233b3902a591d0d5f2925',
    );
  });
});
