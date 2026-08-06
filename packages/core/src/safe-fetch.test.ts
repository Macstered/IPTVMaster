import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertAllowedRequestUrl,
  BlockedAddressError,
  classifyAddress,
  createGuardedFetch,
  isBlockedAddress,
} from './safe-fetch.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('address classification', () => {
  it.each([
    ['127.0.0.1', 'IPv4 loopback'],
    ['127.255.255.254', 'IPv4 loopback edge'],
    ['0.0.0.0', 'unspecified'],
    ['10.0.0.5', 'private class A'],
    ['172.16.0.1', 'private class B start'],
    ['172.31.255.255', 'private class B end'],
    ['192.168.1.1', 'private class C'],
    ['169.254.169.254', 'cloud metadata'],
    ['169.254.0.1', 'link-local'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['192.0.2.1', 'documentation TEST-NET-1'],
    ['198.51.100.1', 'documentation TEST-NET-2'],
    ['203.0.113.10', 'documentation TEST-NET-3'],
    ['198.18.0.1', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['fe80::1', 'IPv6 link-local'],
    ['fe90::1', 'IPv6 link-local above fe80'],
    ['febf::1', 'IPv6 link-local top of range'],
    ['fc00::1', 'IPv6 unique local'],
    ['fd12:3456::1', 'IPv6 unique local'],
    ['ff02::1', 'IPv6 multicast'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback, dotted'],
    ['::ffff:7f00:1', 'IPv4-mapped loopback, hex'],
    ['::ffff:192.168.0.1', 'IPv4-mapped private'],
    ['::ffff:a9fe:a9fe', 'IPv4-mapped metadata, hex'],
    ['64:ff9b::7f00:1', 'NAT64 translation range'],
    ['2002::1', '6to4 transition'],
    ['not-an-address', 'garbage'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    '1.1.1.1',
    '8.8.8.8',
    '9.9.9.9',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ])('allows public address %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('LAN exceptions', () => {
  it('allows only the configured CIDR', () => {
    process.env['IPTVMASTER_ALLOWED_SOURCE_CIDRS'] = '192.168.1.0/24';
    expect(isBlockedAddress('192.168.1.50')).toBe(false);
    expect(isBlockedAddress('192.168.2.50')).toBe(true);
    expect(isBlockedAddress('10.0.0.1')).toBe(true);
  });

  it('accepts several entries and ignores unparseable ones', () => {
    process.env['IPTVMASTER_ALLOWED_SOURCE_CIDRS'] =
      'nonsense, 10.8.0.0/16 fd00::/8';
    expect(isBlockedAddress('10.8.1.1')).toBe(false);
    expect(isBlockedAddress('fd00::5')).toBe(false);
    expect(isBlockedAddress('10.9.1.1')).toBe(true);
  });

  it('never allows loopback, link-local, metadata, or multicast', () => {
    process.env['IPTVMASTER_ALLOWED_SOURCE_CIDRS'] = '0.0.0.0/0,::/0';
    for (const address of [
      '127.0.0.1',
      '169.254.169.254',
      'fe80::1',
      '224.0.0.1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
  });

  it('still honours the deprecated blanket switch for private ranges', () => {
    process.env['IPTVMASTER_ALLOW_PRIVATE_SOURCE_ADDRESSES'] = 'true';
    expect(isBlockedAddress('192.168.1.50')).toBe(false);
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
  });

  it('explains why an address was refused', () => {
    expect(classifyAddress('10.0.0.1').reason).toContain(
      'IPTVMASTER_ALLOWED_SOURCE_CIDRS',
    );
    expect(classifyAddress('127.0.0.1').reason).toContain('never permitted');
  });
});

describe('request URL policy', () => {
  it.each([
    'http://provider.example/list.m3u',
    'https://provider.example/guide.xml',
    'http://provider.example:2095/list.m3u',
    'http://provider.example:25461/list.m3u',
  ])('accepts %s', (value) => {
    expect(() => assertAllowedRequestUrl(new URL(value))).not.toThrow();
  });

  it.each([
    'ftp://provider.example/list.m3u',
    'file:///etc/passwd',
    'http://127.0.0.1/list.m3u',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/list.m3u',
    'http://[::ffff:7f00:1]/list.m3u',
    'http://[fe90::1]/list.m3u',
  ])('rejects %s', (value) => {
    expect(() => assertAllowedRequestUrl(new URL(value))).toThrow(
      BlockedAddressError,
    );
  });
});

interface StubResponse {
  status: number;
  headers: Map<string, string>;
}

function stubFetch(
  routes: Record<string, { status: number; location?: string }>,
) {
  const seen: string[] = [];
  const cancel = vi.fn(async () => undefined);
  const implementation = vi.fn(async (target: unknown, options?: unknown) => {
    void options;
    const href = String(target);
    seen.push(href);
    const route = routes[href] ?? { status: 200 };
    const headers = new Map<string, string>();
    if (route.location) headers.set('location', route.location);
    return {
      status: route.status,
      headers: { get: (name: string) => headers.get(name) ?? null },
      body: { cancel },
    } as unknown as StubResponse;
  });
  return { implementation, seen, cancel };
}

describe('redirect handling', () => {
  it('follows a public redirect chain and returns the final response', async () => {
    const { implementation, seen } = stubFetch({
      'http://a.example/one': { status: 302, location: 'http://b.example/two' },
      'http://b.example/two': { status: 200 },
    });
    const fetcher = createGuardedFetch(implementation as never);

    const response = await fetcher('http://a.example/one');

    expect(response.status).toBe(200);
    expect(seen).toEqual(['http://a.example/one', 'http://b.example/two']);
  });

  it('resolves a relative redirect against the current URL', async () => {
    const { implementation, seen } = stubFetch({
      'http://a.example/dir/one': { status: 302, location: '../two' },
      'http://a.example/two': { status: 200 },
    });
    const fetcher = createGuardedFetch(implementation as never);

    await fetcher('http://a.example/dir/one');

    expect(seen[1]).toBe('http://a.example/two');
  });

  it('validates every hop and refuses a redirect into the network', async () => {
    for (const target of [
      'http://127.0.0.1/internal',
      'http://[::1]/internal',
      'http://[::ffff:7f00:1]/internal',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.1.1/router',
    ]) {
      const { implementation, seen } = stubFetch({
        'http://a.example/one': { status: 302, location: target },
      });
      const fetcher = createGuardedFetch(implementation as never);

      await expect(fetcher('http://a.example/one')).rejects.toThrow(
        BlockedAddressError,
      );
      expect(seen).toEqual(['http://a.example/one']);
    }
  });

  it('refuses a redirect into a LAN range that is not allowed', async () => {
    process.env['IPTVMASTER_ALLOWED_SOURCE_CIDRS'] = '10.8.0.0/16';
    const { implementation } = stubFetch({
      'http://a.example/one': { status: 302, location: 'http://10.9.0.1/x' },
    });
    const fetcher = createGuardedFetch(implementation as never);

    await expect(fetcher('http://a.example/one')).rejects.toThrow(
      BlockedAddressError,
    );
  });

  it('allows a redirect into an explicitly allowed LAN range', async () => {
    process.env['IPTVMASTER_ALLOWED_SOURCE_CIDRS'] = '10.8.0.0/16';
    const { implementation } = stubFetch({
      'http://a.example/one': { status: 302, location: 'http://10.8.0.1/x' },
      'http://10.8.0.1/x': { status: 200 },
    });
    const fetcher = createGuardedFetch(implementation as never);

    await expect(fetcher('http://a.example/one')).resolves.toMatchObject({
      status: 200,
    });
  });

  it('accepts three redirects and rejects the fourth', async () => {
    const routes: Record<string, { status: number; location?: string }> = {
      'http://a.example/0': { status: 302, location: 'http://a.example/1' },
      'http://a.example/1': { status: 302, location: 'http://a.example/2' },
      'http://a.example/2': { status: 302, location: 'http://a.example/3' },
      'http://a.example/3': { status: 200 },
    };
    await expect(
      createGuardedFetch(stubFetch(routes).implementation as never)(
        'http://a.example/0',
      ),
    ).resolves.toMatchObject({ status: 200 });

    routes['http://a.example/3'] = {
      status: 302,
      location: 'http://a.example/4',
    };
    await expect(
      createGuardedFetch(stubFetch(routes).implementation as never)(
        'http://a.example/0',
      ),
    ).rejects.toThrow(/redirected more than/u);
  });

  it('detects a redirect loop', async () => {
    const { implementation } = stubFetch({
      'http://a.example/one': { status: 302, location: 'http://a.example/two' },
      'http://a.example/two': { status: 302, location: 'http://a.example/one' },
    });
    const fetcher = createGuardedFetch(implementation as never);

    await expect(fetcher('http://a.example/one')).rejects.toThrow(
      BlockedAddressError,
    );
  });

  it('releases the body of each redirect response', async () => {
    const { implementation, cancel } = stubFetch({
      'http://a.example/one': { status: 302, location: 'http://a.example/two' },
      'http://a.example/two': { status: 200 },
    });
    const fetcher = createGuardedFetch(implementation as never);

    await fetcher('http://a.example/one');

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('returns a redirect that carries no location header', async () => {
    const { implementation } = stubFetch({
      'http://a.example/one': { status: 302 },
    });
    const fetcher = createGuardedFetch(implementation as never);

    await expect(fetcher('http://a.example/one')).resolves.toMatchObject({
      status: 302,
    });
  });

  it('passes the caller signal through so timeouts span every hop', async () => {
    const { implementation } = stubFetch({
      'http://a.example/one': { status: 302, location: 'http://a.example/two' },
      'http://a.example/two': { status: 200 },
    });
    const fetcher = createGuardedFetch(implementation as never);
    const signal = AbortSignal.timeout(5_000);

    await fetcher('http://a.example/one', { signal });

    for (const call of implementation.mock.calls) {
      const options = call[1] as {
        signal?: AbortSignal;
        redirect?: string;
      };
      expect(options.signal).toBe(signal);
      expect(options.redirect).toBe('manual');
    }
  });
});
