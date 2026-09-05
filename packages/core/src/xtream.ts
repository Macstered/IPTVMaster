/**
 * Xtream Codes panels expose an M3U at `get.php` and an XMLTV guide at
 * `xmltv.php`, both authenticated by credentials in the query string. Building
 * those URLs from a server address and a login is the whole of what "Xtream
 * support" needs: the rest of the import path already handles what comes back.
 */

export interface XtreamAccount {
  /** Origin only, no path: `http://panel.example:2095`. */
  server: string;
  username: string;
  password: string;
}

export interface XtreamAccountStatus {
  status?: string;
  expiresAt?: string;
  activeConnections?: number;
  maxConnections?: number;
  trial?: boolean;
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Accepts what people actually have to hand: a bare host, a host with a port,
 * or a full `get.php` link copied from their provider. Anything carrying the
 * credentials already is decomposed, so a working URL does not have to be
 * taken apart by hand before it can be used.
 */
export function parseXtreamInput(input: string): Partial<XtreamAccount> {
  const trimmed = input.trim();
  if (trimmed === '') return {};

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return {};
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return {};

  const username = url.searchParams.get('username') ?? undefined;
  const password = url.searchParams.get('password') ?? undefined;

  return {
    server: url.origin,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };
}

/** Rejects anything that is not a usable http(s) origin. */
export function normalizeXtreamServer(server: string): string {
  const parsed = parseXtreamInput(server);
  if (!parsed.server) {
    throw new Error('The panel address must be an HTTP or HTTPS URL');
  }
  return parsed.server;
}

function endpoint(
  account: XtreamAccount,
  path: string,
  extra: Record<string, string> = {},
): string {
  const url = new URL(path, `${normalizeXtreamServer(account.server)}/`);
  url.searchParams.set('username', account.username);
  url.searchParams.set('password', account.password);
  for (const [key, value] of Object.entries(extra)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * `m3u_plus` is the only variant that carries tvg-id, tvg-logo and
 * group-title, which every grouping and guide-matching feature depends on.
 */
export function xtreamPlaylistUrl(
  account: XtreamAccount,
  output: 'ts' | 'm3u8' = 'ts',
): string {
  return endpoint(account, 'get.php', { type: 'm3u_plus', output });
}

export function xtreamGuideUrl(account: XtreamAccount): string {
  return endpoint(account, 'xmltv.php');
}

export function xtreamPlayerApiUrl(account: XtreamAccount): string {
  return endpoint(account, 'player_api.php');
}

export function xtreamStreamUrl(
  account: XtreamAccount,
  mediaType: 'live' | 'movie' | 'series',
  providerStreamId: string,
  containerExtension = 'ts',
): string {
  if (!/^\d{1,16}$/.test(providerStreamId)) {
    throw new Error('The Xtream stream identifier is invalid');
  }
  if (!/^[A-Za-z0-9]{1,8}$/.test(containerExtension)) {
    throw new Error('The Xtream stream extension is invalid');
  }
  const path = [
    mediaType,
    encodeURIComponent(account.username),
    encodeURIComponent(account.password),
    `${providerStreamId}.${containerExtension.toLowerCase()}`,
  ].join('/');
  return new URL(path, `${normalizeXtreamServer(account.server)}/`).toString();
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Panels are inconsistent about types: numbers arrive as strings, and the
 * expiry is a unix timestamp that is absent on unlimited accounts. Anything
 * unrecognised is left out rather than guessed at.
 */
export function parseXtreamAccountStatus(
  payload: unknown,
): XtreamAccountStatus {
  if (typeof payload !== 'object' || payload === null) return {};
  const info = (payload as Record<string, unknown>)['user_info'];
  if (typeof info !== 'object' || info === null) return {};
  const record = info as Record<string, unknown>;

  const expirySeconds = asNumber(record['exp_date']);
  const expiresAt =
    expirySeconds !== undefined && expirySeconds > 0
      ? new Date(expirySeconds * 1000).toISOString()
      : undefined;

  const status = record['status'];
  const trial = record['is_trial'];
  const active = asNumber(record['active_cons']);
  const maximum = asNumber(record['max_connections']);

  return {
    ...(typeof status === 'string' && status !== '' ? { status } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(active !== undefined ? { activeConnections: active } : {}),
    ...(maximum !== undefined ? { maxConnections: maximum } : {}),
    ...(trial !== undefined && trial !== null
      ? { trial: trial === '1' || trial === 1 || trial === true }
      : {}),
  };
}
