import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';

import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch } from 'undici';

export class BlockedAddressError extends Error {
  constructor(message = 'Provider address is not permitted') {
    super(message);
    this.name = 'BlockedAddressError';
  }
}

/**
 * Ranges an operator may deliberately re-enable for a feed hosted on their own
 * network. Everything outside these — loopback, link-local (which carries the
 * cloud metadata address), multicast, reserved, and the transition ranges that
 * tunnel to other destinations — stays blocked even when a LAN range is
 * allowed, because nothing legitimate serves a playlist from them.
 */
const LAN_ALLOWABLE_RANGES = new Set([
  'private',
  'uniqueLocal',
  'carrierGradeNat',
]);

const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type ParsedCidr = [ipaddr.IPv4 | ipaddr.IPv6, number];

let cidrCacheKey: string | undefined;
let cidrCacheValue: ParsedCidr[] = [];

/**
 * Explicit CIDR exceptions, for example `192.168.1.0/24,10.8.0.0/16`. Entries
 * that fail to parse are ignored rather than silently widening the policy.
 */
function allowedCidrs(): ParsedCidr[] {
  const raw = process.env['IPTVMASTER_ALLOWED_SOURCE_CIDRS'] ?? '';
  if (raw === cidrCacheKey) return cidrCacheValue;
  const parsed: ParsedCidr[] = [];
  for (const entry of raw.split(/[\s,]+/).filter(Boolean)) {
    try {
      parsed.push(ipaddr.parseCIDR(entry) as ParsedCidr);
    } catch {
      // Ignored: an unparseable entry must not widen the policy.
    }
  }
  cidrCacheKey = raw;
  cidrCacheValue = parsed;
  return parsed;
}

/**
 * Deprecated blanket switch, kept working for existing deployments. Prefer
 * IPTVMASTER_ALLOWED_SOURCE_CIDRS, which names the exact networks allowed.
 */
function legacyPrivateAddressesAllowed(): boolean {
  return process.env['IPTVMASTER_ALLOW_PRIVATE_SOURCE_ADDRESSES'] === 'true';
}

function matchesAllowedCidr(address: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  return allowedCidrs().some((cidr) => {
    if (cidr[0].kind() !== address.kind()) return false;
    try {
      return address.match(cidr as never);
    } catch {
      return false;
    }
  });
}

export interface AddressDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Classifies a resolved address. Only public unicast is allowed by default;
 * LAN ranges require an explicit opt-in, and ranges that can never host a
 * legitimate feed are refused unconditionally.
 */
export function classifyAddress(address: string): AddressDecision {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    return { allowed: false, reason: `${address} is not a valid IP address` };
  }
  // An IPv4-mapped IPv6 address reaches the same host as its IPv4 form, in any
  // of its textual representations, so it is judged as that IPv4 address.
  if (parsed.kind() === 'ipv6') {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) parsed = v6.toIPv4Address();
  }
  const range = parsed.range();
  if (range === 'unicast') return { allowed: true };
  if (LAN_ALLOWABLE_RANGES.has(range)) {
    if (legacyPrivateAddressesAllowed() || matchesAllowedCidr(parsed)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason:
        `${address} is on a ${range} network. Add it to ` +
        'IPTVMASTER_ALLOWED_SOURCE_CIDRS if that is intended.',
    };
  }
  return {
    allowed: false,
    reason: `${address} is a ${range} address and is never permitted`,
  };
}

/**
 * The fetch implementation wraps a connector failure in a TypeError, so the
 * original refusal is only reachable through the cause chain.
 */
export function findBlockedAddressError(
  error: unknown,
): BlockedAddressError | undefined {
  for (let current = error, depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof BlockedAddressError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function isBlockedAddress(address: string): boolean {
  return !classifyAddress(address).allowed;
}

/**
 * Validates a URL before it is requested. Address literals are checked here
 * because a connection to a literal never performs a DNS lookup, so the
 * connector guard below would not see it.
 */
export function assertAllowedRequestUrl(url: URL): void {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new BlockedAddressError('Provider URL must use HTTP or HTTPS');
  }
  // Ports are deliberately unrestricted: IPTV providers commonly serve on
  // non-standard ports (2095, 8000, 25461, ...). Address range is the control.
  const literal = url.hostname.replace(/^\[|\]$/gu, '');
  if (isIP(literal)) {
    const decision = classifyAddress(literal);
    if (!decision.allowed) {
      throw new BlockedAddressError(decision.reason);
    }
  }
}

/**
 * DNS lookup that refuses addresses the policy does not allow. Used as an
 * undici connector so the address it validates is the one actually connected
 * to, which also defeats DNS rebinding between check and connect.
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
    const refused = entries
      .map((entry) => classifyAddress(entry.address))
      .find((decision) => !decision.allowed);
    if (refused) {
      callback(
        new BlockedAddressError(`${hostname}: ${refused.reason}`),
        address,
        family,
      );
      return;
    }
    callback(null, address, family);
  });
}) as unknown as typeof dnsLookup;

let guardedAgent: Agent | undefined;

export function guardedDispatcher(): Agent {
  guardedAgent ??= new Agent({ connect: { lookup: guardedLookup } });
  return guardedAgent;
}

function requestUrl(input: unknown): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return new URL(input.href);
  const candidate = (input as { url?: unknown }).url;
  if (typeof candidate === 'string') return new URL(candidate);
  throw new BlockedAddressError('Unsupported request target');
}

async function discardBody(response: { body?: unknown }): Promise<void> {
  const body = response.body as { cancel?: () => Promise<unknown> } | null;
  try {
    await body?.cancel?.();
  } catch {
    // The connection is being abandoned; nothing depends on a clean close.
  }
}

/**
 * Builds a fetch that validates the destination before every request it makes,
 * including each redirect hop.
 *
 * Redirects are followed here rather than by the HTTP client because the
 * client resolves a redirect target itself: a hop to an address literal never
 * performs a DNS lookup, so the connector guard would not see it and a feed
 * could bounce an accepted request straight into the local network.
 */
export function createGuardedFetch(
  underlyingFetch: typeof undiciFetch = undiciFetch,
): typeof fetch {
  return (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    let url = requestUrl(input);
    const visited = new Set<string>();
    for (let hop = 0; ; hop += 1) {
      assertAllowedRequestUrl(url);
      const response = await underlyingFetch(url.href, {
        ...(init as Parameters<typeof undiciFetch>[1]),
        redirect: 'manual',
        dispatcher: guardedDispatcher(),
      } as Parameters<typeof undiciFetch>[1]);
      if (!REDIRECT_STATUSES.has(response.status)) return response;

      const location = response.headers.get('location');
      if (location === null) return response;
      await discardBody(response);

      if (hop >= MAX_REDIRECTS) {
        throw new BlockedAddressError(
          `Provider redirected more than ${MAX_REDIRECTS} times`,
        );
      }
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new BlockedAddressError(
          'Provider sent an unusable redirect target',
        );
      }
      if (visited.has(next.href)) {
        throw new BlockedAddressError('Provider redirect loops');
      }
      visited.add(url.href);
      url = next;
    }
  }) as unknown as typeof fetch;
}

/**
 * Fetch bound to the guarded dispatcher and redirect policy. Imported from
 * undici directly so the dispatcher and the client come from the same copy of
 * the library.
 */
export const guardedFetch: typeof fetch = createGuardedFetch();
