import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function decodeKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error('Master key must be a base64-encoded 32-byte value');
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

  const key = decodeKey(encodedKey);
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivText, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
