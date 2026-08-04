import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret } from './secrets.js';

describe('secret envelopes', () => {
  it('round-trips a provider configuration without exposing plaintext', () => {
    const key = randomBytes(32).toString('base64');
    const url = new URL('/get.php', 'http://provider.test');
    url.searchParams.set('username', 'synthetic-user');
    url.searchParams.set('password', 'synthetic-secret');
    const plaintext = JSON.stringify({
      playlistUrl: url.toString(),
    });
    const encrypted = encryptSecret(plaintext, key);

    expect(encrypted).not.toContain('provider.test');
    expect(encrypted).not.toContain('secret');
    expect(decryptSecret(encrypted, key)).toBe(plaintext);
  });

  it('rejects an invalid key length', () => {
    expect(() => encryptSecret('value', 'not-a-valid-key')).toThrow(/32-byte/);
  });

  it('detects tampering through the GCM authentication tag', () => {
    const key = randomBytes(32).toString('base64');
    const encrypted = encryptSecret('value', key);
    const parts = encrypted.split('.');
    const tag = Buffer.from(parts[2] ?? '', 'base64url');
    tag[0] = (tag[0] ?? 0) ^ 1;
    parts[2] = tag.toString('base64url');
    const tampered = parts.join('.');

    expect(() => decryptSecret(tampered, key)).toThrow();
  });
});
