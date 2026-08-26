import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

function decodeKey(encodedKey: string): Buffer {
  // Node's base64 decoder silently drops invalid characters, so a passphrase
  // of the right length would decode to 32 bytes and look like a valid key.
  // Require canonical base64 that round-trips exactly.
  const key = Buffer.from(encodedKey, 'base64');
  if (
    key.length !== KEY_BYTES ||
    !KEY_PATTERN.test(encodedKey) ||
    key.toString('base64') !== encodedKey
  ) {
    throw new Error(
      'Master key must be a canonical base64-encoded 32-byte value, ' +
        'for example the output of: openssl rand -base64 32',
    );
  }
  return key;
}

export function encryptSecret(plaintext: string, encodedKey: string): string {
  const key = decodeKey(encodedKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(envelope: string, encodedKey: string): string {
  return decryptSecretWithKey(envelope, decodeKey(encodedKey));
}

function decryptSecretWithKey(envelope: string, key: Buffer): string {
  const [version, ivText, tagText, ciphertextText, ...unexpected] =
    envelope.split('.');
  if (
    version !== VERSION ||
    ivText === undefined ||
    tagText === undefined ||
    ciphertextText === undefined ||
    unexpected.length > 0
  ) {
    throw new Error('Unsupported or malformed encrypted secret');
  }

  const iv = Buffer.from(ivText, 'base64url');
  const tag = Buffer.from(tagText, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    // GCM accepts short tags, which would weaken forgery resistance for an
    // attacker who can write to the database.
    throw new Error('Unsupported or malformed encrypted secret');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * Validates and decodes a master key once for a batch of encrypted values.
 * Large catalogue outputs can contain hundreds of thousands of URLs, so doing
 * the same base64 validation for every row adds avoidable latency.
 */
export function createSecretDecryptor(
  encodedKey: string,
): (envelope: string) => string {
  const key = decodeKey(encodedKey);
  return (envelope) => decryptSecretWithKey(envelope, key);
}
