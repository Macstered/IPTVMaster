import { guardedFetch } from './safe-fetch.js';

export interface FetchedImage {
  bytes: Uint8Array;
  contentType: string;
}

export class ImageRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageRejectedError';
  }
}

export interface FetchImageOptions {
  timeoutMs?: number;
  maxBytes?: number;
  fetchImplementation?: typeof fetch;
}

/**
 * Raster formats only. SVG is deliberately absent: it can carry script and
 * external references, so serving one from our own origin would hand a feed
 * a same-origin foothold.
 */
const SIGNATURES: Array<{
  contentType: string;
  matches: (bytes: Uint8Array) => boolean;
}> = [
  {
    contentType: 'image/png',
    matches: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    contentType: 'image/jpeg',
    matches: (b) =>
      b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    contentType: 'image/gif',
    matches: (b) =>
      b.length > 6 &&
      b[0] === 0x47 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x38,
  },
  {
    contentType: 'image/webp',
    matches: (b) =>
      b.length > 12 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
];

/**
 * Identifies the format from the leading bytes rather than the declared
 * content type, so a feed cannot pass HTML, JSON, or SVG through by labelling
 * it as an image.
 */
export function detectImageType(bytes: Uint8Array): string | undefined {
  return SIGNATURES.find((signature) => signature.matches(bytes))?.contentType;
}

/**
 * Downloads a channel logo through the guarded fetch, enforcing a short
 * timeout and a hard byte ceiling, and accepting only real raster images.
 */
export async function fetchImage(
  imageUrl: string,
  options: FetchImageOptions = {},
): Promise<FetchedImage> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const fetchImplementation = options.fetchImplementation ?? guardedFetch;

  const response = await fetchImplementation(imageUrl, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: 'image/png, image/jpeg, image/gif, image/webp;q=0.9, */*;q=0.1',
      'user-agent': 'IPTVMaster/0.1',
    },
  });
  if (!response.ok) {
    throw new ImageRejectedError(
      `Logo request returned HTTP ${response.status}`,
    );
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ImageRejectedError('Logo is larger than the allowed size');
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const body = response.body;
  if (!body) throw new ImageRejectedError('Logo response has no body');
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ImageRejectedError('Logo is larger than the allowed size');
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const contentType = detectImageType(bytes);
  if (!contentType) {
    throw new ImageRejectedError('Logo is not a supported image format');
  }
  return { bytes, contentType };
}
