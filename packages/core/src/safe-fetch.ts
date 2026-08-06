import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';

import { Agent, fetch as undiciFetch } from 'undici';

export class BlockedAddressError extends Error {
  constructor(message = 'Provider address is not permitted') {
    super(message);
    this.name = 'BlockedAddressError';
  }
}

const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

/**
 * Some operators legitimately run a provider or guide generator on their own
 * network. Private addresses stay blocked by default so a hostile feed cannot
 * turn the server into a LAN prober, and this opts back in deliberately.
 */
function privateAddressesAllowed(): boolean {
  return process.env['IPTVMASTER_ALLOW_PRIVATE_SOURCE_ADDRESSES'] === 'true';
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  const [a = 0, b = 0] = parts;
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
    return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 and 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const value = address.toLowerCase().split('%', 1)[0] ?? '';
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(value)) return true; // unique local
  if (value.startsWith('ff')) return true; // multicast
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped?.[1]) return isBlockedIpv4(mapped[1]);
  return false;
}

/**
 * Rejects addresses that are not public unicast. Provider feeds are fetched
 * from operator-supplied URLs, and this application typically runs inside a
 * home network, so an unchecked fetch would let a provider (or a redirect it
 * controls) probe the operator's LAN and cloud metadata endpoints.
 */
export function isBlockedAddress(address: string): boolean {
  if (privateAddressesAllowed()) return false;
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

export function assertAllowedRequestUrl(url: URL): void {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new BlockedAddressError('Provider URL must use HTTP or HTTPS');
  }
  const port = url.port
    ? Number(url.port)
    : url.protocol === 'https:'
      ? 443
      : 80;
  if (!privateAddressesAllowed() && !ALLOWED_PORTS.has(port)) {
    throw new BlockedAddressError(
      `Provider port ${port} is not permitted. Set ` +
        'IPTVMASTER_ALLOW_PRIVATE_SOURCE_ADDRESSES=true to allow it.',
    );
  }
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal) && isBlockedAddress(literal)) {
    throw new BlockedAddressError(
      'Provider address is on a private or reserved network. Set ' +
        'IPTVMASTER_ALLOW_PRIVATE_SOURCE_ADDRESSES=true if that is intended.',
    );
  }
}

/**
 * DNS lookup that refuses private, loopback, link-local, and reserved
 * addresses. Passed to an undici connector so it runs for the initial request
 * and again for every redirect hop, and the address it validates is the one
 * actually connected to, which also defeats DNS rebinding.
 */
export const guardedLookup = ((
  hostname: string,
  options: unknown,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: unknown,
    family?: number,
  ) => void,
) => {
  (
    dnsLookup as unknown as (
      host: string,
      opts: unknown,
      cb: (
        error: NodeJS.ErrnoException | null,
        address: unknown,
        family?: number,
      ) => void,
    ) => void
  )(hostname, options, (error, address, family) => {
    if (error) {
      callback(error, address, family);
      return;
    }
    const entries = Array.isArray(address)
      ? (address as Array<{ address: string }>)
      : [{ address: address as string }];
    if (entries.some((entry) => isBlockedAddress(entry.address))) {
      callback(
        new BlockedAddressError(
          `${hostname} resolves to a private or reserved address. Set ` +
            'IPTVMASTER_ALLOW_PRIVATE_SOURCE_ADDRESSES=true if that is ' +
            'intended.',
        ),
        address,
        family,
      );
      return;
    }
    callback(null, address, family);
  });
}) as unknown as typeof dnsLookup;

let guardedAgent: Agent | undefined;

/**
 * Shared undici agent whose connector re-validates the resolved address for
 * the initial request and for every redirect hop, and connects to exactly the
 * address it validated. Redirects are capped so a provider cannot chain them
 * indefinitely.
 */
export function guardedDispatcher(): Agent {
  guardedAgent ??= new Agent({ connect: { lookup: guardedLookup } });
  return guardedAgent;
}

/**
 * Fetch bound to the guarded dispatcher. Imported from undici directly so the
 * dispatcher and the client come from the same copy of the library.
 */
export const guardedFetch: typeof fetch = ((
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) =>
  undiciFetch(
    input as Parameters<typeof undiciFetch>[0],
    {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher: guardedDispatcher(),
      maxRedirections: 3,
    } as Parameters<typeof undiciFetch>[1],
  )) as unknown as typeof fetch;
