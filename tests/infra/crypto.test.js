import { describe, expect, it } from 'vitest';
import { bytesToHex, hashPassword, hexToBytes, PBKDF2_ITERATIONS, randomHex, timingSafeEqual } from '../../src/infra/crypto.js';

describe('hashPassword', () => {
  it('matches the published PBKDF2-HMAC-SHA256 test vector', () => {
    // RFC 7914 §11, P="passwd", S="salt", c=1 (first 32 bytes). If this drifts, every
    // stored hash stops verifying and nobody can sign in.
    return expect(hashPassword('passwd', bytesToHex(new TextEncoder().encode('salt')), 1))
      .resolves.toBe('55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc');
  });

  it('uses 100,000 iterations by default', () => {
    expect(PBKDF2_ITERATIONS).toBe(100000);
  });

  it('gives different hashes for the same password under different salts', async () => {
    const [a, b] = await Promise.all([hashPassword('same', randomHex(16), 10), hashPassword('same', randomHex(16), 10)]);
    expect(a).not.toBe(b);
  });
});

describe('timingSafeEqual', () => {
  it('is false for strings of different length rather than comparing a prefix', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('is false for a non-string, such as the missing hash of an unknown user', () => {
    expect(timingSafeEqual('abc', undefined)).toBe(false);
  });

  it('is true only for identical strings', () => {
    expect(timingSafeEqual('a1b2', 'a1b2')).toBe(true);
    expect(timingSafeEqual('a1b2', 'a1b3')).toBe(false);
  });
});

describe('hex helpers', () => {
  it('round-trips bytes through hex, keeping leading zeros', () => {
    expect(bytesToHex(hexToBytes('00ff0a'))).toBe('00ff0a');
  });

  it('randomHex(n) gives 2n hex characters', () => {
    expect(randomHex(32)).toMatch(/^[0-9a-f]{64}$/);
  });
});
