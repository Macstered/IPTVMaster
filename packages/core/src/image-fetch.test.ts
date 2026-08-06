import { describe, expect, it, vi } from 'vitest';

import {
  detectImageType,
  fetchImage,
  ImageRejectedError,
} from './image-fetch.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0,
]);

function respondWith(
  bytes: Uint8Array,
  headers: Record<string, string> = {},
): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: bytes };
          },
          async cancel() {
            return undefined;
          },
        };
      },
    },
  })) as unknown as typeof fetch;
}

describe('image type detection', () => {
  it.each([
    [PNG, 'image/png'],
    [JPEG, 'image/jpeg'],
    [GIF, 'image/gif'],
    [WEBP, 'image/webp'],
  ])('recognises a raster signature', (bytes, expected) => {
    expect(detectImageType(bytes)).toBe(expected);
  });

  it.each([
    ['<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'SVG'],
    ['<!doctype html><html><body>login</body></html>', 'HTML'],
    ['{"error":"not found"}', 'JSON'],
    ['', 'empty'],
  ])('refuses %s content', (text) => {
    expect(detectImageType(new TextEncoder().encode(text))).toBeUndefined();
  });
});

describe('logo download', () => {
  it('returns the detected type rather than the declared one', async () => {
    const image = await fetchImage('https://logos.example/a.png', {
      fetchImplementation: respondWith(PNG, { 'content-type': 'text/html' }),
    });

    expect(image.contentType).toBe('image/png');
    expect(image.bytes).toEqual(PNG);
  });

  it('refuses content that is not a raster image', async () => {
    await expect(
      fetchImage('https://logos.example/a.svg', {
        fetchImplementation: respondWith(
          new TextEncoder().encode('<svg onload="alert(1)"/>'),
          { 'content-type': 'image/svg+xml' },
        ),
      }),
    ).rejects.toThrow(ImageRejectedError);
  });

  it('refuses a body larger than the ceiling', async () => {
    const oversized = new Uint8Array(2_048);
    oversized.set(PNG, 0);
    await expect(
      fetchImage('https://logos.example/big.png', {
        maxBytes: 1_024,
        fetchImplementation: respondWith(oversized),
      }),
    ).rejects.toThrow(/larger than the allowed size/u);
  });

  it('refuses an oversized declared length before reading', async () => {
    await expect(
      fetchImage('https://logos.example/big.png', {
        maxBytes: 1_024,
        fetchImplementation: respondWith(PNG, { 'content-length': '99999' }),
      }),
    ).rejects.toThrow(/larger than the allowed size/u);
  });

  it('propagates a failed request', async () => {
    const failing = vi.fn(async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
      body: null,
    })) as unknown as typeof fetch;

    await expect(
      fetchImage('https://logos.example/missing.png', {
        fetchImplementation: failing,
      }),
    ).rejects.toThrow(ImageRejectedError);
  });
});
