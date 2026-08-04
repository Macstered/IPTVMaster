import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import {
  applyEventGroupPolicy,
  applyOutputGroupPolicies,
  DEFAULT_PLACEHOLDER_PATTERNS,
  inspectRemotePlaylist,
  localizeEventName,
  parseM3uText,
  redactStreamUrl,
  serializeM3u,
  serializeXmltv,
  SnapshotRejectedError,
  type EventGroupPolicy,
  type M3uEntry,
  type PlaylistInspection,
  type XmltvInspection,
} from '@iptvmaster/core';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import {
  ManualMatchConflictError,
  PostgresSourceRepository,
  SnapshotActivationConflictError,
  type SourceRepository,
} from './source-repository.js';
import {
  PlaylistRefreshCoordinator,
  PlaylistScheduler,
  SourceNotFoundError,
} from './playlist-refresh.js';
import {
  EpgNotConfiguredError,
  EpgRefreshCoordinator,
  EpgScheduler,
} from './epg-refresh.js';
import {
  AdministratorAlreadyConfiguredError,
  AuthService,
  InvalidCredentialsError,
  LoginRateLimiter,
  PostgresAuthRepository,
  type AuthRepository,
  type CreatedAuthSession,
} from './auth.js';
import { MaintenanceScheduler } from './maintenance.js';

const SESSION_COOKIE = 'iptvmaster_session';
const CSRF_COOKIE = 'iptvmaster_csrf';

const timePolicySchema = z.object({
  sourceTimeZone: z.string().min(1).default('Europe/Stockholm'),
  displayTimeZone: z.string().min(1).default('Europe/Helsinki'),
  numericDateOrder: z.enum(['month-day', 'day-month']).default('month-day'),
  referenceDate: z.iso.date(),
});

const eventPreviewSchema = z.object({
  name: z.string().min(1).max(1_000),
  policy: timePolicySchema,
});

const playlistPreviewSchema = z.object({
  playlist: z.string().min(1).max(10_000_000),
  eventGroups: z
    .array(
      z.object({
        groupName: z.string().min(1),
        outputGroupName: z.string().min(1).optional(),
        enabled: z.boolean().default(true),
        hidePlaceholders: z.boolean().default(true),
        placeholderPatterns: z.array(z.string().min(1)).optional(),
        timePolicy: timePolicySchema.optional(),
      }),
    )
    .default([]),
});

const createSourceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sourceType: z.enum(['m3u', 'xtream']).default('m3u'),
  playlistUrl: z.url().max(4_000),
  epgUrl: z.url().max(4_000).optional(),
  sourceTimezone: z.string().min(1).default('Europe/Stockholm'),
  displayTimezone: z.string().min(1).default('Europe/Helsinki'),
});

const groupPolicySchema = z.object({
  groupName: z.string().min(1).max(500),
  behavior: z.enum(['permanent', 'event']),
  enabled: z.boolean().default(true),
  outputGroupName: z.string().trim().min(1).max(500).optional(),
  hidePlaceholders: z.boolean().default(true),
  placeholderPatterns: z
    .array(z.string().trim().min(1).max(200))
    .max(100)
    .optional(),
  sourceTimeZone: z.string().min(1).default('Europe/Stockholm'),
  displayTimeZone: z.string().min(1).default('Europe/Helsinki'),
  numericDateOrder: z.enum(['month-day', 'day-month']).default('month-day'),
});

const outputProfileSchema = z.object({
  sourceId: z.uuid(),
  name: z.string().trim().min(1).max(120).default('TiviMate'),
});

const channelListSchema = z.object({
  search: z.string().trim().max(200).optional(),
  group: z.string().max(500).optional(),
  status: z.enum(['matched', 'new', 'missing', 'ambiguous']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const nullableChannelText = (maximum: number) =>
  z.union([z.string().trim().min(1).max(maximum), z.null()]).optional();

const channelUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    customName: nullableChannelText(500),
    customGroup: nullableChannelText(500),
    customLogoUrl: z.union([z.url().max(4_000), z.null()]).optional(),
    sortOrder: z.number().int().min(0).max(2_147_483_647).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one channel field is required',
  });

const bulkChannelUpdateSchema = z.object({
  channelIds: z.array(z.uuid()).min(1).max(500),
  update: z
    .object({
      enabled: z.boolean().optional(),
      customGroup: nullableChannelText(500),
      customLogoUrl: z.union([z.url().max(4_000), z.null()]).optional(),
    })
    .refine(
      (value) => Object.values(value).some((item) => item !== undefined),
      {
        message: 'At least one bulk update field is required',
      },
    ),
});

const reconciliationReviewSchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const sourceHistorySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const eventReviewSchema = z.object({
  referenceDate: z.iso.date().optional(),
  group: z.string().trim().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const manualMatchSchema = z.object({
  upstreamItemId: z.uuid(),
});

const epgMappingReviewSchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const epgChannelSearchSchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const manualEpgMappingSchema = z.object({
  epgChannelId: z.string().trim().min(1).max(500),
});

const administratorUsernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(
    /^[A-Za-z0-9._-]+$/,
    'Use letters, numbers, dots, underscores, or hyphens',
  );

const administratorSetupSchema = z.object({
  username: administratorUsernameSchema,
  password: z.string().min(12).max(128),
});

const administratorLoginSchema = z.object({
  username: administratorUsernameSchema,
  password: z.string().min(1).max(128),
});

export interface BuildAppOptions {
  sourceRepository?: SourceRepository;
  authRepository?: AuthRepository;
  playlistInspector?: (playlistUrl: string) => Promise<PlaylistInspection>;
  epgInspector?: (epgUrl: string) => Promise<XmltvInspection>;
  enablePlaylistScheduler?: boolean;
  enableEpgScheduler?: boolean;
  playlistRefreshIntervalMs?: number;
  playlistRefreshInitialDelayMs?: number;
  epgRefreshIntervalMs?: number;
  epgRefreshInitialDelayMs?: number;
  providerRetryAttempts?: number;
  providerRetryInitialDelayMs?: number;
  providerRetryMaxDelayMs?: number;
  enableMaintenanceScheduler?: boolean;
  maintenanceIntervalMs?: number;
  maintenanceInitialDelayMs?: number;
  sessionTtlMs?: number;
  secureCookies?: boolean;
  developmentMode?: boolean;
}

function safeEntry(entry: M3uEntry) {
  return {
    name: entry.name,
    group: entry.attributes['group-title'] ?? '',
    tvgId: entry.attributes['tvg-id'] ?? '',
    mediaType: entry.mediaType,
    streamUrl: redactStreamUrl(entry.url),
  };
}

function validationMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
}

function currentDateInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value['year']}-${value['month']}-${value['day']}`;
}

function positiveEnvironmentNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function requestCookies(request: FastifyRequest): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = request.headers.cookie;
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookie values.
    }
  }
  return cookies;
}

function cookieValue(
  name: string,
  value: string,
  options: { httpOnly: boolean; maxAge: number; secure: boolean },
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${options.maxAge}`,
    'SameSite=Strict',
    ...(options.httpOnly ? ['HttpOnly'] : []),
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}

function setSessionCookies(
  reply: FastifyReply,
  session: CreatedAuthSession,
  sessionTtlMs: number,
  secure: boolean,
): void {
  const maxAge = Math.max(1, Math.floor(sessionTtlMs / 1_000));
  reply.header('set-cookie', [
    cookieValue(SESSION_COOKIE, session.sessionToken, {
      httpOnly: true,
      maxAge,
      secure,
    }),
    cookieValue(CSRF_COOKIE, session.csrfToken, {
      httpOnly: false,
      maxAge,
      secure,
    }),
  ]);
}

function clearSessionCookies(reply: FastifyReply, secure: boolean): void {
  reply.header('set-cookie', [
    cookieValue(SESSION_COOKIE, '', { httpOnly: true, maxAge: 0, secure }),
    cookieValue(CSRF_COOKIE, '', { httpOnly: false, maxAge: 0, secure }),
  ]);
}

function isSameOrigin(
  request: FastifyRequest,
  allowDevelopmentLoopback: boolean,
): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const host = request.headers.host;
    if (host && originUrl.host === host) return true;
    if (!allowDevelopmentLoopback) return false;
    const loopback = new Set(['localhost', '127.0.0.1', '::1']);
    return loopback.has(originUrl.hostname) && loopback.has(request.hostname);
  } catch {
    return false;
  }
}

function clientRateLimitKey(request: FastifyRequest): string {
  return `login|${request.ip}`;
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.body.playlist',
          'req.body.url',
          'req.body.playlistUrl',
          'req.body.epgUrl',
          'req.body.password',
          'password',
          '*.password',
          '*.url',
        ],
        censor: '[redacted]',
      },
    },
    bodyLimit: 10_500_000,
  });

  let sourceRepository = options.sourceRepository;
  const playlistInspector = options.playlistInspector ?? inspectRemotePlaylist;
  const epgInspector = options.epgInspector;
  let ownsSourceRepository = false;
  const databaseUrl = process.env['DATABASE_URL'];
  const masterKey = process.env['IPTVMASTER_MASTER_KEY'];
  if (!sourceRepository && databaseUrl && masterKey) {
    sourceRepository = new PostgresSourceRepository(databaseUrl, masterKey);
    ownsSourceRepository = true;
  }
  let authRepository = options.authRepository;
  let ownsAuthRepository = false;
  if (!authRepository && databaseUrl) {
    authRepository = new PostgresAuthRepository(databaseUrl);
    ownsAuthRepository = true;
  }
  const sessionTtlMs =
    options.sessionTtlMs ??
    positiveEnvironmentNumber('IPTVMASTER_SESSION_HOURS', 168) *
      60 *
      60 *
      1_000;
  const secureCookies =
    options.secureCookies ??
    process.env['IPTVMASTER_SECURE_COOKIES'] === 'true';
  const developmentMode =
    options.developmentMode ?? process.env['NODE_ENV'] !== 'production';
  const authService = authRepository
    ? new AuthService(authRepository, sessionTtlMs)
    : undefined;
  const loginRateLimiter = new LoginRateLimiter();
  const providerRetryOptions = {
    maxAttempts:
      options.providerRetryAttempts ??
      positiveEnvironmentNumber('PROVIDER_RETRY_ATTEMPTS', 3),
    initialDelayMs:
      options.providerRetryInitialDelayMs ??
      positiveEnvironmentNumber('PROVIDER_RETRY_INITIAL_DELAY_SECONDS', 2) *
        1_000,
    maxDelayMs:
      options.providerRetryMaxDelayMs ??
      positiveEnvironmentNumber('PROVIDER_RETRY_MAX_DELAY_SECONDS', 30) * 1_000,
  };

  const refreshCoordinator = sourceRepository
    ? new PlaylistRefreshCoordinator(
        sourceRepository,
        playlistInspector,
        providerRetryOptions,
      )
    : undefined;
  const schedulerEnabled =
    refreshCoordinator !== undefined &&
    (options.enablePlaylistScheduler ??
      (ownsSourceRepository &&
        process.env['PLAYLIST_REFRESH_ENABLED'] !== 'false'));
  const playlistScheduler =
    schedulerEnabled && sourceRepository && refreshCoordinator
      ? new PlaylistScheduler(sourceRepository, refreshCoordinator, app.log, {
          intervalMs:
            options.playlistRefreshIntervalMs ??
            positiveEnvironmentNumber(
              'PLAYLIST_REFRESH_INTERVAL_MINUTES',
              120,
            ) * 60_000,
          initialDelayMs:
            options.playlistRefreshInitialDelayMs ??
            positiveEnvironmentNumber(
              'PLAYLIST_REFRESH_INITIAL_DELAY_SECONDS',
              30,
            ) * 1_000,
        })
      : undefined;
  const epgRefreshCoordinator = sourceRepository
    ? new EpgRefreshCoordinator(
        sourceRepository,
        epgInspector ?? undefined,
        providerRetryOptions,
      )
    : undefined;
  const epgSchedulerEnabled =
    epgRefreshCoordinator !== undefined &&
    (options.enableEpgScheduler ??
      (ownsSourceRepository && process.env['EPG_REFRESH_ENABLED'] !== 'false'));
  const epgScheduler =
    epgSchedulerEnabled && sourceRepository && epgRefreshCoordinator
      ? new EpgScheduler(sourceRepository, epgRefreshCoordinator, app.log, {
          intervalMs:
            options.epgRefreshIntervalMs ??
            positiveEnvironmentNumber('EPG_REFRESH_INTERVAL_MINUTES', 720) *
              60_000,
          initialDelayMs:
            options.epgRefreshInitialDelayMs ??
            positiveEnvironmentNumber('EPG_REFRESH_INITIAL_DELAY_SECONDS', 60) *
              1_000,
        })
      : undefined;
  const maintenanceSchedulerEnabled =
    authService !== undefined &&
    (options.enableMaintenanceScheduler ??
      (ownsAuthRepository && process.env['MAINTENANCE_ENABLED'] !== 'false'));
  const maintenanceScheduler =
    maintenanceSchedulerEnabled && authService
      ? new MaintenanceScheduler(authService, app.log, {
          intervalMs:
            options.maintenanceIntervalMs ??
            positiveEnvironmentNumber('MAINTENANCE_INTERVAL_MINUTES', 1_440) *
              60_000,
          initialDelayMs:
            options.maintenanceInitialDelayMs ??
            positiveEnvironmentNumber(
              'MAINTENANCE_INITIAL_DELAY_SECONDS',
              300,
            ) * 1_000,
        })
      : undefined;
  maintenanceScheduler?.start();
  epgScheduler?.start();
  playlistScheduler?.start();
  if (
    playlistScheduler ||
    epgScheduler ||
    maintenanceScheduler ||
    (ownsSourceRepository && sourceRepository?.close) ||
    ownsAuthRepository
  ) {
    app.addHook('onClose', async () => {
      await playlistScheduler?.stop();
      await epgScheduler?.stop();
      await maintenanceScheduler?.stop();
      if (ownsSourceRepository) await sourceRepository?.close?.();
      if (ownsAuthRepository) await authService?.close();
    });
  }

  await app.register(cors, {
    origin: developmentMode
      ? /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
      : false,
    credentials: developmentMode,
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header(
      'permissions-policy',
      'camera=(), microphone=(), geolocation=()',
    );
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('cross-origin-resource-policy', 'same-origin');
    reply.header(
      'content-security-policy',
      "default-src 'self'; base-uri 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: http: https:; object-src 'none'; script-src 'self'; style-src 'self'",
    );
    if (secureCookies) {
      reply.header(
        'strict-transport-security',
        'max-age=31536000; includeSubDomains',
      );
    }
    if (request.url.startsWith('/api/')) {
      reply.header('cache-control', 'no-store');
    }
    return payload;
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!authService) return;
    const path = request.url.split('?', 1)[0] ?? request.url;
    if (!path.startsWith('/api/v1/') || path.startsWith('/api/v1/auth/')) {
      return;
    }
    const cookies = requestCookies(request);
    const session = await authService.authenticate(cookies[SESSION_COOKIE]);
    if (!session) {
      clearSessionCookies(reply, secureCookies);
      return reply.code(401).send({ error: 'Authentication required' });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const csrfHeader = request.headers['x-iptvmaster-csrf'];
      const csrfCookie = cookies[CSRF_COOKIE];
      if (
        !isSameOrigin(request, developmentMode) ||
        typeof csrfHeader !== 'string' ||
        !csrfCookie ||
        csrfHeader !== csrfCookie ||
        !authService.verifyCsrf(session, csrfHeader)
      ) {
        return reply.code(403).send({ error: 'CSRF validation failed' });
      }
    }
  });

  app.get('/health', async () => ({ status: 'ok', service: 'iptvmaster-api' }));

  app.get('/ready', async (_request, reply) => {
    if (!sourceRepository) {
      return reply.code(503).send({
        status: 'not-ready',
        database: false,
        reason: 'Source persistence is not configured',
      });
    }
    try {
      await authService?.healthCheck();
      return {
        status: 'ready',
        database: true,
        administratorSetupRequired:
          (await authService?.isSetupRequired()) ?? false,
      };
    } catch {
      return reply.code(503).send({
        status: 'not-ready',
        database: false,
        reason: 'Database is unavailable',
      });
    }
  });

  app.get('/api/v1/auth/status', async (request, reply) => {
    if (!authService) {
      return {
        enabled: false,
        setupRequired: false,
        authenticated: true,
      };
    }
    const setupRequired = await authService.isSetupRequired();
    const cookies = requestCookies(request);
    const session = await authService.authenticate(cookies[SESSION_COOKIE]);
    const csrfToken = cookies[CSRF_COOKIE];
    if (session && csrfToken && authService.verifyCsrf(session, csrfToken)) {
      return {
        enabled: true,
        setupRequired,
        authenticated: true,
        username: session.username,
      };
    }
    if (cookies[SESSION_COOKIE]) {
      await authService.logout(cookies[SESSION_COOKIE]);
      clearSessionCookies(reply, secureCookies);
    }
    return {
      enabled: true,
      setupRequired,
      authenticated: false,
    };
  });

  app.post('/api/v1/auth/setup', async (request, reply) => {
    if (!authService) {
      return reply.code(404).send({ error: 'Authentication is not enabled' });
    }
    if (!isSameOrigin(request, developmentMode)) {
      return reply.code(403).send({ error: 'Origin validation failed' });
    }
    const parsed = administratorSetupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: validationMessage(parsed.error) });
    }
    const rateLimitKey = `setup|${request.ip}`;
    const retryAfter = loginRateLimiter.retryAfterSeconds(rateLimitKey);
    if (retryAfter > 0) {
      return reply
        .header('retry-after', retryAfter)
        .code(429)
        .send({ error: 'Too many setup attempts; try again later' });
    }
    try {
      const session = await authService.setup(
        parsed.data.username,
        parsed.data.password,
      );
      loginRateLimiter.reset(rateLimitKey);
      setSessionCookies(reply, session, sessionTtlMs, secureCookies);
      return reply.code(201).send({
        enabled: true,
        setupRequired: false,
        authenticated: true,
        username: session.username,
      });
    } catch (error) {
      if (error instanceof AdministratorAlreadyConfiguredError) {
        loginRateLimiter.recordFailure(rateLimitKey);
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    if (!authService) {
      return reply.code(404).send({ error: 'Authentication is not enabled' });
    }
    if (!isSameOrigin(request, developmentMode)) {
      return reply.code(403).send({ error: 'Origin validation failed' });
    }
    const parsed = administratorLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: validationMessage(parsed.error) });
    }
    if (await authService.isSetupRequired()) {
      return reply.code(409).send({ error: 'Administrator setup is required' });
    }
    const rateLimitKey = clientRateLimitKey(request);
    const retryAfter = loginRateLimiter.retryAfterSeconds(rateLimitKey);
    if (retryAfter > 0) {
      return reply
        .header('retry-after', retryAfter)
        .code(429)
        .send({ error: 'Too many login attempts; try again later' });
    }
    try {
      const session = await authService.login(
        parsed.data.username,
        parsed.data.password,
      );
      loginRateLimiter.reset(rateLimitKey);
      setSessionCookies(reply, session, sessionTtlMs, secureCookies);
      return {
        enabled: true,
        setupRequired: false,
        authenticated: true,
        username: session.username,
      };
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        const blockedFor = loginRateLimiter.recordFailure(rateLimitKey);
        if (blockedFor > 0) reply.header('retry-after', blockedFor);
        return reply
          .code(blockedFor > 0 ? 429 : 401)
          .send({ error: error.message });
      }
      throw error;
    }
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    if (!authService) return reply.code(204).send();
    const cookies = requestCookies(request);
    const session = await authService.authenticate(cookies[SESSION_COOKIE]);
    const csrfHeader = request.headers['x-iptvmaster-csrf'];
    const csrfCookie = cookies[CSRF_COOKIE];
    if (
      !session ||
      !isSameOrigin(request, developmentMode) ||
      typeof csrfHeader !== 'string' ||
      !csrfCookie ||
      csrfHeader !== csrfCookie ||
      !authService.verifyCsrf(session, csrfHeader)
    ) {
      return reply.code(403).send({ error: 'CSRF validation failed' });
    }
    await authService.logout(cookies[SESSION_COOKIE]);
    clearSessionCookies(reply, secureCookies);
    return reply.code(204).send();
  });

  app.get('/api/v1/system/capabilities', async () => ({
    sourcePersistence: sourceRepository !== undefined,
    databaseConfigured: databaseUrl !== undefined,
    encryptionConfigured: masterKey !== undefined,
    playlistAutomation: playlistScheduler !== undefined,
    epgAutomation: epgScheduler !== undefined,
    maintenanceAutomation: maintenanceScheduler !== undefined,
  }));

  app.get('/api/v1/automation/status', async () => ({
    ...(playlistScheduler?.status() ?? {
      enabled: false,
      running: false,
      intervalMinutes: 0,
      sourceStates: refreshCoordinator?.listStates() ?? [],
    }),
    epg: epgScheduler?.status() ?? {
      enabled: false,
      running: false,
      intervalMinutes: 0,
      sourceStates: epgRefreshCoordinator?.listStates() ?? [],
    },
    maintenance: maintenanceScheduler?.status() ?? {
      enabled: false,
      running: false,
      intervalMinutes: 0,
    },
  }));

  app.get('/api/v1/sources', async (_request, reply) => {
    if (!sourceRepository) {
      return reply
        .code(503)
        .send({ error: 'Source persistence is not configured' });
    }
    return { sources: await sourceRepository.listSources() };
  });

  app.post('/api/v1/sources', async (request, reply) => {
    if (!sourceRepository) {
      return reply
        .code(503)
        .send({ error: 'Source persistence is not configured' });
    }
    const parsed = createSourceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: validationMessage(parsed.error) });
    }

    for (const [label, value] of [
      ['playlistUrl', parsed.data.playlistUrl],
      ['epgUrl', parsed.data.epgUrl],
    ] as const) {
      if (value && !['http:', 'https:'].includes(new URL(value).protocol)) {
        return reply
          .code(400)
          .send({ error: `${label} must use HTTP or HTTPS` });
      }
    }

    const source = await sourceRepository.createSource({
      name: parsed.data.name,
      sourceType: parsed.data.sourceType,
      credentials: {
        playlistUrl: parsed.data.playlistUrl,
        ...(parsed.data.epgUrl ? { epgUrl: parsed.data.epgUrl } : {}),
      },
      sourceTimezone: parsed.data.sourceTimezone,
      displayTimezone: parsed.data.displayTimezone,
    });
    return reply.code(201).send({ source });
  });

  app.post<{ Params: { sourceId: string } }>(
    '/api/v1/sources/:sourceId/preview-import',
    async (request, reply) => {
      if (!sourceRepository) {
        return reply
          .code(503)
          .send({ error: 'Source persistence is not configured' });
      }
      const sourceId = z.uuid().safeParse(request.params.sourceId);
      if (!sourceId.success) {
        return reply.code(400).send({ error: 'sourceId must be a UUID' });
      }
      const credentials = await sourceRepository.getSourceCredentials(
        sourceId.data,
      );
      if (!credentials)
        return reply.code(404).send({ error: 'Source not found' });

      const inspection = await playlistInspector(credentials.playlistUrl);
      return {
        summary: {
          fingerprint: inspection.fingerprint,
          totalBytes: inspection.totalBytes,
          retainedLiveEntries: inspection.entries.length,
          skippedEntries: inspection.skippedEntries,
          mediaCounts: inspection.mediaCounts,
          issues: inspection.issues.length,
        },
        entries: inspection.entries.slice(0, 200).map(safeEntry),
        truncated: inspection.entries.length > 200,
      };
    },
  );

  app.post<{ Params: { sourceId: string } }>(
    '/api/v1/sources/:sourceId/import',
    async (request, reply) => {
      if (!sourceRepository) {
        return reply
          .code(503)
          .send({ error: 'Source persistence is not configured' });
      }
      const sourceId = z.uuid().safeParse(request.params.sourceId);
      if (!sourceId.success) {
        return reply.code(400).send({ error: 'sourceId must be a UUID' });
      }
      if (!refreshCoordinator) {
        return reply
          .code(503)
          .send({ error: 'Playlist refresh is not configured' });
      }
      try {
        const result = await refreshCoordinator.refresh(sourceId.data);
        if (result.status === 'already-running') {
          return reply.code(202).send({
            status: result.status,
            sourceId: result.sourceId,
            startedAt: result.startedAt,
          });
        }
        const { inspection, snapshot } = result;
        if (!inspection || !snapshot) {
          throw new Error('Completed refresh is missing its result');
        }
        return reply.code(snapshot.unchanged ? 200 : 201).send({
          snapshot,
          summary: {
            fingerprint: inspection.fingerprint,
            totalBytes: inspection.totalBytes,
            retainedLiveEntries: inspection.entries.length,
            skippedEntries: inspection.skippedEntries,
            mediaCounts: inspection.mediaCounts,
            issues: inspection.issues.length,
          },
        });
      } catch (error) {
        if (error instanceof SourceNotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        if (error instanceof SnapshotRejectedError) {
          return reply.code(422).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { sourceId: string } }>(
    '/api/v1/sources/:sourceId/groups',
    async (request, reply) => {
      if (!sourceRepository) {
        return reply
          .code(503)
          .send({ error: 'Source persistence is not configured' });
      }
      const sourceId = z.uuid().safeParse(request.params.sourceId);
      if (!sourceId.success) {
        return reply.code(400).send({ error: 'sourceId must be a UUID' });
      }
      return { groups: await sourceRepository.listGroups(sourceId.data) };
    },
  );

  app.post<{ Params: { sourceId: string } }>(
    '/api/v1/sources/:sourceId/epg/import',
    async (request, reply) => {
      if (!sourceRepository || !epgRefreshCoordinator) {
        return reply
          .code(503)
          .send({ error: 'EPG persistence is not configured' });
      }
      const sourceId = z.uuid().safeParse(request.params.sourceId);
      if (!sourceId.success) {
        return reply.code(400).send({ error: 'sourceId must be a UUID' });
      }
      try {
        const result = await epgRefreshCoordinator.refresh(sourceId.data);
        if (result.status === 'already-running') {
          return reply.code(202).send({
            status: result.status,
            sourceId: result.sourceId,
            startedAt: result.startedAt,
          });
        }
        const { inspection, summary } = result;
        if (!inspection || !summary) {
          throw new Error('Completed EPG refresh is missing its result');
        }
        return reply.code(summary.unchanged ? 200 : 201).send({
          summary,
          inspection: {
            fingerprint: inspection.fingerprint,
            totalBytes: inspection.totalBytes,
            channelCount: inspection.channels.length,
            programmeCount: inspection.programmes.length,
            issueCount: inspection.issues.length,
            issuesTruncated: inspection.issuesTruncated,
          },
        });
      } catch (error) {
        if (error instanceof EpgNotConfiguredError) {
          return reply.code(404).send({ error: error.message });
        }
        if (error instanceof SnapshotRejectedError) {
          return reply.code(422).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.put<{ Params: { sourceId: string } }>(
    '/api/v1/sources/:sourceId/group-policies',
    async (request, reply) => {
      if (!sourceRepository) {
        return reply
          .code(503)
          .send({ error: 'Source persistence is not configured' });
      }
      const sourceId = z.uuid().safeParse(request.params.sourceId);
      const policy = groupPolicySchema.safeParse(request.body);
      if (!sourceId.success) {
        return reply.code(400).send({ error: 'sourceId must be a UUID' });
      }
      if (!policy.success) {
        return reply.code(400).send({ error: validationMessage(policy.error) });
      }
      const saved = await sourceRepository.saveGroupPolicy(
        sourceId.data,
        policy.data,
      );
      return { group: saved };
    },
  );

  app.get<{
    Params: { sourceId: string };
    Querystring: Record<string, string | undefined>;
  }>('/api/v1/sources/:sourceId/events', async (request, reply) => {
    if (!sourceRepository) {
      return reply
        .code(503)
        .send({ error: 'Source persistence is not configured' });
    }
    const sourceId = z.uuid().safeParse(request.params.sourceId);
    const query = eventReviewSchema.safeParse(request.query);
    if (!sourceId.success) {
      return reply.code(400).send({ error: 'sourceId must be a UUID' });
    }
    if (!query.success) {
      return reply.code(400).send({ error: validationMessage(query.error) });
    }
    const referenceDate =
      query.data.referenceDate ?? currentDateInZone('Europe/Stockholm');
    const [entries, policies] = await Promise.all([
      sourceRepository.getLatestPlaylistEntries(sourceId.data),
      sourceRepository.listOutputGroupPolicies(sourceId.data, referenceDate),
    ]);
    const eventPolicies = policies.filter(
      (policy) =>
        policy.behavior === 'event' &&
        (!query.data.group || policy.groupName === query.data.group),
    );
    let totalEntries = 0;
    let hiddenEntries = 0;
    let localizedEntries = 0;
    let warningEntries = 0;
    let truncated = false;
    const groups = eventPolicies.map((policy) => {
      const reviewed = entries
        .filter(
          (entry) =>
            (entry.attributes['group-title'] ?? '') === policy.groupName,
        )
        .map((entry, index) => {
          const applied = applyEventGroupPolicy(entry, policy);
          return {
            id: `${entry.lineNumber}-${index}`,
            originalName: entry.name,
            localizedName: applied.time.localizedName,
            status: applied.time.status,
            hidden: applied.hidden,
            ...(applied.hideReason ? { hideReason: applied.hideReason } : {}),
            ...(applied.time.sourceDateTime
              ? { sourceDateTime: applied.time.sourceDateTime }
              : {}),
            ...(applied.time.displayDateTime
              ? { displayDateTime: applied.time.displayDateTime }
              : {}),
            crossedDateBoundary: applied.time.crossedDateBoundary,
            ...(applied.time.warning ? { warning: applied.time.warning } : {}),
            sourceOrder: entry.lineNumber,
          };
        })
        .sort(
          (left, right) =>
            (left.displayDateTime
              ? Date.parse(left.displayDateTime)
              : Number.POSITIVE_INFINITY) -
              (right.displayDateTime
                ? Date.parse(right.displayDateTime)
                : Number.POSITIVE_INFINITY) ||
            left.sourceOrder - right.sourceOrder,
        );
      const visible = reviewed.slice(0, query.data.limit);
      totalEntries += reviewed.length;
      hiddenEntries += reviewed.filter((entry) => entry.hidden).length;
      localizedEntries += reviewed.filter(
        (entry) => entry.status === 'localized',
      ).length;
      warningEntries += reviewed.filter(
        (entry) => !entry.hidden && entry.status !== 'localized',
      ).length;
      truncated ||= reviewed.length > visible.length;
      return {
        groupName: policy.groupName,
        outputGroupName: policy.outputGroupName,
        enabled: policy.enabled,
        hidePlaceholders: policy.hidePlaceholders,
        placeholderPatterns: policy.placeholderPatterns ?? [
          ...DEFAULT_PLACEHOLDER_PATTERNS,
        ],
        timePolicy: policy.timePolicy,
        totalEntries: reviewed.length,
        hiddenEntries: reviewed.filter((entry) => entry.hidden).length,
        localizedEntries: reviewed.filter(
          (entry) => entry.status === 'localized',
        ).length,
        warningEntries: reviewed.filter(
          (entry) => !entry.hidden && entry.status !== 'localized',
        ).length,
        entries: visible.map(({ sourceOrder, ...entry }) => {
          void sourceOrder;
          return entry;
        }),
      };
    });
    return {
      referenceDate,
      groups,
      summary: {
        groupCount: groups.length,
        totalEntries,
        hiddenEntries,
        localizedEntries,
        warningEntries,
      },
      truncated,
    };
  });

  app.get<{
    Params: { sourceId: string };
    Querystring: Record<string, string | undefined>;
  }>('/api/v1/sources/:sourceId/history', async (request, reply) => {
    if (!sourceRepository) {
      return reply
        .code(503)
        .send({ error: 'Source persistence is not configured' });
    }
    const sourceId = z.uuid().safeParse(request.params.sourceId);
    const query = sourceHistorySchema.safeParse(request.query);
    if (!sourceId.success) {
      return reply.code(400).send({ error: 'sourceId must be a UUID' });
    }
    if (!query.success) {
      return reply.code(400).send({ error: validationMessage(query.error) });
    }
    return sourceRepository.listSourceHistory(sourceId.data, query.data.limit);
  });

  app.post<{ Params: { sourceId: string; snapshotId: string } }>(
    '/api/v1/sources/:sourceId/snapshots/:snapshotId/activate',
    async (request, reply) => {
      if (!sourceRepository) {
        return reply
          .code(503)
          .send({ error: 'Source persistence is not configured' });
      }
      const sourceId = z.uuid().safeParse(request.params.sourceId);
      const snapshotId = z.uuid().safeParse(request.params.snapshotId);
      if (!sourceId.success || !snapshotId.success) {
        return reply
          .code(400)
          .send({ error: 'sourceId and snapshotId must be UUIDs' });
      }
      try {
        const snapshot = await sourceRepository.activateSnapshot(
          sourceId.data,
          snapshotId.data,
        );
        if (!snapshot) {
          return reply.code(404).send({ error: 'Snapshot not found' });
        }
        return { snapshot };
      } catch (error) {
        if (error instanceof SnapshotActivationConflictError) {
          return reply.code(409).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.get<{
    Params: { sourceId: string };
    Querystring: Record<string, string | undefined>;
  }>('/api/v1/sources/:sourceId/channels', async (request, reply) => {
    if (!sourceRepository) {
      return reply
        .code(503)
        .send({ error: 'Source persistence is not configured' });
    }
    const sourceId = z.uuid().safeParse(request.params.sourceId);
    const filters = channelListSchema.safeParse(request.query);
    if (!sourceId.success) {
      return reply.code(400).send({ error: 'sourceId must be a UUID' });
    }
    if (!filters.success) {
      return reply.code(400).send({ error: validationMessage(filters.error) });
    }
    return sourceRepository.listChannels(sourceId.data, filters.data);
  });

  app.patch<{ Params: { sourceId: string } }>(
    '/api/v1/sources/:sourceId/channels',
    async (request, reply) => {
      if (!sourceRepository) {
        return reply
          .code(503)
          .send({ error: 'Source persistence is not configured' });
      }
      const sourceId = z.uuid().safeParse(request.params.sourceId);
      const update = bulkChannelUpdateSchema.safeParse(request.body);
      if (!sourceId.success) {
        return reply.code(400).send({ error: 'sourceId must be a UUID' });
      }
      if (!update.success) {
        return reply.code(400).send({ error: validationMessage(update.error) });
      }
      if (
        update.data.update.customLogoUrl &&
        !['http:', 'https:'].includes(
          new URL(update.data.update.customLogoUrl).protocol,
        )
      ) {
        return reply
          .code(400)
          .send({ error: 'customLogoUrl must use HTTP or HTTPS' });
      }
      return sourceRepository.bulkUpdateChannels(
        sourceId.data,
        update.data.channelIds,
        update.data.update,
      );
    },
  );

  app.get<{
    Params: { sourceId: string };
    Querystring: Record<string, string | undefined>;
  }>('/api/v1/sources/:sourceId/channel-review', async (request, reply) => {
    if (!sourceRepository) {
      return reply
        .code(503)
        .send({ error: 'Source persistence is not configured' });
    }
    const sourceId = z.uuid().safeParse(request.params.sourceId);
    const query = reconciliationReviewSchema.safeParse(request.query);
    if (!sourceId.success) {
      return reply.code(400).send({ error: 'sourceId must be a UUID' });
    }
    if (!query.success) {
      return reply.code(400).send({ error: validationMessage(query.error) });
    }
    return sourceRepository.getReconciliationReview(
      sourceId.data,
      query.data.search,
      query.data.limit,
    );
  });

  app.post<{ Params: { sourceId: string; channelId: string } }>(
    '/api/v1/sources/:sourceId/channels/:channelId/resolve',
    async (request, reply) => {
      if (!sourceRepository) {
        return reply
          .code(503)
          .send({ error: 'Source persistence is not configured' });
      }
      const sourceId = z.uuid().safeParse(request.params.sourceId);
      const channelId = z.uuid().safeParse(request.params.channelId);
      const match = manualMatchSchema.safeParse(request.body);
      if (!sourceId.success || !channelId.success) {
        return reply
          .code(400)
          .send({ error: 'sourceId and channelId must be UUIDs' });
      }
      if (!match.success) {
        return reply.code(400).send({ error: validationMessage(match.error) });
      }
      try {
        const channel = await sourceRepository.resolveChannelMatch(
          sourceId.data,
          channelId.data,
          match.data.upstreamItemId,
        );
        if (!channel) {
          return reply
            .code(404)
            .send({ error: 'Channel or provider entry not found' });
        }
        return { channel };
      } catch (error) {
        if (error instanceof ManualMatchConflictError) {
          return reply.code(409).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { sourceId: string; channelId: string } }>(
    '/api/v1/sources/:sourceId/channels/:channelId/unlock-match',
    async (request, reply) => {
      if (!sourceRepository) {
        return reply
          .code(503)
          .send({ error: 'Source persistence is not configured' });
      }
      const sourceId = z.uuid().safeParse(request.params.sourceId);
      const channelId = z.uuid().safeParse(request.params.channelId);
      if (!sourceId.success || !channelId.success) {
        return reply
          .code(400)
          .send({ error: 'sourceId and channelId must be UUIDs' });
      }
      const channel = await sourceRepository.unlockChannelMatch(
        sourceId.data,
        channelId.data,
      );
      if (!channel) return reply.code(404).send({ error: 'Channel not found' });
      return { channel };
    },
  );

  app.get<{
    Params: { sourceId: string };
    Querystring: Record<string, string | undefined>;
  }>('/api/v1/sources/:sourceId/epg-mappings', async (request, reply) => {
    if (!sourceRepository) {
      return reply
        .code(503)
        .send({ error: 'Source persistence is not configured' });
    }
    const sourceId = z.uuid().safeParse(request.params.sourceId);
    const query = epgMappingReviewSchema.safeParse(request.query);
    if (!sourceId.success) {
      return reply.code(400).send({ error: 'sourceId must be a UUID' });
    }
    if (!query.success) {
      return reply.code(400).send({ error: validationMessage(query.error) });
    }
    return sourceRepository.getEpgMappingReview(
      sourceId.data,
      query.data.search,
      query.data.limit,
    );
  });

  app.get<{
    Params: { sourceId: string };
    Querystring: Record<string, string | undefined>;
  }>('/api/v1/sources/:sourceId/epg-channels', async (request, reply) => {
    if (!sourceRepository) {
      return reply
        .code(503)
        .send({ error: 'Source persistence is not configured' });
    }
    const sourceId = z.uuid().safeParse(request.params.sourceId);
    const query = epgChannelSearchSchema.safeParse(request.query);
    if (!sourceId.success) {
      return reply.code(400).send({ error: 'sourceId must be a UUID' });
    }
    if (!query.success) {
      return reply.code(400).send({ error: validationMessage(query.error) });
    }
    return sourceRepository.searchEpgChannels(
      sourceId.data,
      query.data.search,
      query.data.limit,
    );
  });

  app.put<{ Params: { sourceId: string; channelId: string } }>(
    '/api/v1/sources/:sourceId/channels/:channelId/epg-mapping',
    async (request, reply) => {
      if (!sourceRepository) {
        return reply
          .code(503)
          .send({ error: 'Source persistence is not configured' });
      }
      const sourceId = z.uuid().safeParse(request.params.sourceId);
      const channelId = z.uuid().safeParse(request.params.channelId);
      const mapping = manualEpgMappingSchema.safeParse(request.body);
      if (!sourceId.success || !channelId.success) {
        return reply
          .code(400)
          .send({ error: 'sourceId and channelId must be UUIDs' });
      }
      if (!mapping.success) {
        return reply
          .code(400)
          .send({ error: validationMessage(mapping.error) });
      }
      const saved = await sourceRepository.saveManualEpgMapping(
        sourceId.data,
        channelId.data,
        mapping.data.epgChannelId,
      );
      if (!saved) {
        return reply
          .code(404)
          .send({ error: 'Playlist or EPG channel not found' });
      }
      return { saved: true };
    },
  );

  app.delete<{ Params: { sourceId: string; channelId: string } }>(
    '/api/v1/sources/:sourceId/channels/:channelId/epg-mapping',
    async (request, reply) => {
      if (!sourceRepository) {
        return reply
          .code(503)
          .send({ error: 'Source persistence is not configured' });
      }
      const sourceId = z.uuid().safeParse(request.params.sourceId);
      const channelId = z.uuid().safeParse(request.params.channelId);
      if (!sourceId.success || !channelId.success) {
        return reply
          .code(400)
          .send({ error: 'sourceId and channelId must be UUIDs' });
      }
      const unlocked = await sourceRepository.unlockEpgMapping(
        sourceId.data,
        channelId.data,
      );
      if (!unlocked) {
        return reply.code(404).send({ error: 'Locked EPG mapping not found' });
      }
      return reply.code(204).send();
    },
  );

  app.patch<{ Params: { sourceId: string; channelId: string } }>(
    '/api/v1/sources/:sourceId/channels/:channelId',
    async (request, reply) => {
      if (!sourceRepository) {
        return reply
          .code(503)
          .send({ error: 'Source persistence is not configured' });
      }
      const sourceId = z.uuid().safeParse(request.params.sourceId);
      const channelId = z.uuid().safeParse(request.params.channelId);
      const update = channelUpdateSchema.safeParse(request.body);
      if (!sourceId.success || !channelId.success) {
        return reply
          .code(400)
          .send({ error: 'sourceId and channelId must be UUIDs' });
      }
      if (!update.success) {
        return reply.code(400).send({ error: validationMessage(update.error) });
      }
      if (
        update.data.customLogoUrl &&
        !['http:', 'https:'].includes(
          new URL(update.data.customLogoUrl).protocol,
        )
      ) {
        return reply
          .code(400)
          .send({ error: 'customLogoUrl must use HTTP or HTTPS' });
      }
      const channel = await sourceRepository.updateChannel(
        sourceId.data,
        channelId.data,
        update.data,
      );
      if (!channel) return reply.code(404).send({ error: 'Channel not found' });
      return { channel };
    },
  );

  app.post('/api/v1/output-profiles', async (request, reply) => {
    if (!sourceRepository) {
      return reply
        .code(503)
        .send({ error: 'Source persistence is not configured' });
    }
    const parsed = outputProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: validationMessage(parsed.error) });
    }
    const profile = await sourceRepository.createOutputProfile(
      parsed.data.sourceId,
      parsed.data.name,
    );
    return reply.code(201).send({ profile });
  });

  app.delete<{ Params: { profileId: string } }>(
    '/api/v1/output-profiles/:profileId',
    async (request, reply) => {
      if (!sourceRepository) {
        return reply
          .code(503)
          .send({ error: 'Source persistence is not configured' });
      }
      const profileId = z.uuid().safeParse(request.params.profileId);
      if (!profileId.success) {
        return reply.code(400).send({ error: 'profileId must be a UUID' });
      }
      const revoked = await sourceRepository.revokeOutputProfile(
        profileId.data,
      );
      if (!revoked) return reply.code(404).send({ error: 'Profile not found' });
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { accessToken: string } }>(
    '/p/:accessToken/playlist.m3u',
    async (request, reply) => {
      if (
        !sourceRepository ||
        !/^[A-Za-z0-9_-]{24,128}$/.test(request.params.accessToken)
      ) {
        return reply.code(404).send({ error: 'Playlist not found' });
      }
      const profile = await sourceRepository.resolveOutputProfile(
        request.params.accessToken,
      );
      if (!profile)
        return reply.code(404).send({ error: 'Playlist not found' });

      const entries = await sourceRepository.getLatestPlaylistEntries(
        profile.sourceId,
      );
      if (entries.length === 0) {
        return reply.code(503).send({ error: 'Playlist is not ready' });
      }
      const policies = await sourceRepository.listOutputGroupPolicies(
        profile.sourceId,
        currentDateInZone('Europe/Stockholm'),
      );
      const output = applyOutputGroupPolicies(entries, policies);
      return reply
        .type('audio/x-mpegurl; charset=utf-8')
        .header('cache-control', 'private, no-store')
        .send(serializeM3u(output.entries));
    },
  );

  app.get<{ Params: { accessToken: string } }>(
    '/p/:accessToken/epg.xml',
    async (request, reply) => {
      if (
        !sourceRepository ||
        !/^[A-Za-z0-9_-]{24,128}$/.test(request.params.accessToken)
      ) {
        return reply.code(404).send({ error: 'EPG not found' });
      }
      const profile = await sourceRepository.resolveOutputProfile(
        request.params.accessToken,
      );
      if (!profile) return reply.code(404).send({ error: 'EPG not found' });
      const guide = await sourceRepository.getLatestEpg(profile.sourceId);
      if (guide.channels.length === 0) {
        return reply.code(503).send({ error: 'EPG is not ready' });
      }
      return reply
        .type('application/xml; charset=utf-8')
        .header('cache-control', 'private, no-store')
        .send(serializeXmltv(guide.channels, guide.programmes));
    },
  );

  app.post('/api/v1/event-time/preview', async (request, reply) => {
    const parsed = eventPreviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: validationMessage(parsed.error) });
    }
    return localizeEventName(parsed.data.name, parsed.data.policy);
  });

  app.post('/api/v1/playlists/preview', async (request, reply) => {
    const parsed = playlistPreviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: validationMessage(parsed.error) });
    }

    const result = await parseM3uText(parsed.data.playlist);
    const policies = new Map<string, EventGroupPolicy>(
      parsed.data.eventGroups.map((policy) => [policy.groupName, policy]),
    );
    const visible: M3uEntry[] = [];
    const hidden: Array<{ name: string; reason: string }> = [];
    let localizedEvents = 0;

    for (const entry of result.entries) {
      if (entry.mediaType !== 'live') continue;
      const group = entry.attributes['group-title'] ?? '';
      const policy = policies.get(group);
      if (!policy) {
        visible.push(entry);
        continue;
      }

      const applied = applyEventGroupPolicy(entry, policy);
      if (applied.hidden) {
        hidden.push({
          name: entry.name,
          reason: applied.hideReason ?? 'Hidden by event policy',
        });
      } else {
        if (applied.time.changed) localizedEvents += 1;
        visible.push(applied.entry);
      }
    }

    const mediaCounts = result.entries.reduce<Record<string, number>>(
      (counts, entry) => {
        counts[entry.mediaType] = (counts[entry.mediaType] ?? 0) + 1;
        return counts;
      },
      {},
    );

    return {
      summary: {
        totalEntries: result.entries.length,
        visibleLiveEntries: visible.length,
        hiddenEventEntries: hidden.length,
        localizedEvents,
        issues: result.issues.length,
        mediaCounts,
      },
      entries: visible.slice(0, 200).map(safeEntry),
      hidden: hidden.slice(0, 200),
      issues: result.issues.slice(0, 200),
      truncated:
        visible.length > 200 ||
        hidden.length > 200 ||
        result.issues.length > 200,
    };
  });

  const publicDirectory = resolve(process.env['PUBLIC_DIR'] ?? 'public');
  if (existsSync(publicDirectory)) {
    await app.register(fastifyStatic, {
      root: publicDirectory,
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}
