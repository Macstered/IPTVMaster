import { createHash } from 'node:crypto';

import {
  parseXmltv,
  type XmltvChannel,
  type XmltvIssue,
  type XmltvProgramme,
} from './xmltv.js';
import { ProviderHttpError } from './provider-error.js';
import { assertAllowedRequestUrl, guardedFetch } from './safe-fetch.js';

export interface XmltvInspection {
  fingerprint: string;
  totalBytes: number;
  channels: XmltvChannel[];
  programmes: XmltvProgramme[];
  issues: XmltvIssue[];
  issuesTruncated: boolean;
}

export interface XmltvInspectionOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxChannels?: number;
  maxProgrammes?: number;
  maxIssues?: number;
  fetchImplementation?: typeof fetch;
}

async function* limitedXmltvBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  state: { bytes: number; prefix: string },
  hash: ReturnType<typeof createHash>,
): AsyncGenerator<Uint8Array> {
  const decoder = new TextDecoder();
  for await (const chunk of body) {
    state.bytes += chunk.byteLength;
    if (state.bytes > maxBytes) {
      throw new Error(`XMLTV download exceeds the ${maxBytes}-byte limit`);
    }
    hash.update(chunk);
    if (state.prefix.length < 512) {
      state.prefix += decoder
        .decode(chunk, { stream: true })
        .slice(0, 512 - state.prefix.length);
    }
    yield chunk;
  }
}

export async function inspectRemoteXmltv(
  epgUrl: string,
  options: XmltvInspectionOptions = {},
): Promise<XmltvInspection> {
  const url = new URL(epgUrl);
  assertAllowedRequestUrl(url);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
  const response = await (options.fetchImplementation ?? guardedFetch)(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: 'application/xml, text/xml, text/plain;q=0.8, */*;q=0.1',
      'user-agent': 'IPTVMaster/0.1',
    },
  });
  if (!response.ok) throw new ProviderHttpError(response.status);
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (
    contentType.includes('text/html') ||
    contentType.includes('application/json')
  )
    throw new Error(`Provider returned an unexpected ${contentType} response`);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`XMLTV content length exceeds the ${maxBytes}-byte limit`);
  }
  if (!response.body) throw new Error('Provider returned an empty XMLTV body');

  const hash = createHash('sha256');
  const state = { bytes: 0, prefix: '' };
  const parsed = await parseXmltv(
    limitedXmltvBody(response.body, maxBytes, state, hash),
    {
      maxChannels: options.maxChannels,
      maxProgrammes: options.maxProgrammes,
      maxIssues: options.maxIssues,
    },
  );
  const prefix = state.prefix.replace(/^\uFEFF/, '').trimStart();
  if (!prefix.startsWith('<?xml') && !prefix.startsWith('<tv')) {
    throw new Error('Provider response is not XMLTV');
  }
  if (parsed.channels.length === 0) {
    throw new Error('XMLTV contains no valid channels');
  }
  return {
    fingerprint: hash.digest('hex'),
    totalBytes: state.bytes,
    ...parsed,
  };
}
