import { describe, expect, it } from 'vitest';

import {
  assertAllowedRequestUrl,
  BlockedAddressError,
  isBlockedAddress,
} from './safe-fetch.js';

describe('address filtering', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '192.168.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:192.168.0.1',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['1.1.1.1', '8.8.8.8', '203.0.113.10', '2606:4700::1111'])(
    'allows public address %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it('blocks values that are not addresses at all', () => {
    expect(isBlockedAddress('not-an-address')).toBe(true);
  });
});

describe('request URL policy', () => {
  it.each([
    'http://provider.example/list.m3u',
    'https://provider.example/guide.xml',
    'http://provider.example:8080/list.m3u',
  ])('accepts %s', (value) => {
    expect(() => assertAllowedRequestUrl(new URL(value))).not.toThrow();
  });

  it.each([
    'ftp://provider.example/list.m3u',
    'file:///etc/passwd',
    'http://provider.example:22/list.m3u',
    'http://127.0.0.1/list.m3u',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/list.m3u',
  ])('rejects %s', (value) => {
    expect(() => assertAllowedRequestUrl(new URL(value))).toThrow(
      BlockedAddressError,
    );
  });
});
