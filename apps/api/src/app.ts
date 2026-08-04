import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import {
  applyEventGroupPolicy,
  applyOutputGroupPolicies,
  inspectRemotePlaylist,
  localizeEventName,
  parseM3uText,
  redactStreamUrl,
  serializeM3u,
  SnapshotRejectedError,
  type EventGroupPolicy,
  type M3uEntry,
  type PlaylistInspection,
} from '@iptvmaster/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import {
  PostgresSourceRepository,
  type SourceRepository,
  type StoredSnapshotSummary,
} from './source-repository.js';

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

export interface BuildAppOptions {
  sourceRepository?: SourceRepository;
  playlistInspector?: (playlistUrl: string) => Promise<PlaylistInspection>;
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
  let ownsSourceRepository = false;
  const databaseUrl = process.env['DATABASE_URL'];
  const masterKey = process.env['IPTVMASTER_MASTER_KEY'];
  if (!sourceRepository && databaseUrl && masterKey) {
    sourceRepository = new PostgresSourceRepository(databaseUrl, masterKey);
    ownsSourceRepository = true;
  }

  if (ownsSourceRepository && sourceRepository?.close) {
    app.addHook('onClose', async () => sourceRepository?.close?.());
  }

  await app.register(cors, {
    origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  });

  app.get('/health', async () => ({ status: 'ok', service: 'iptvmaster-api' }));

  app.get('/api/v1/system/capabilities', async () => ({
    sourcePersistence: sourceRepository !== undefined,
    databaseConfigured: databaseUrl !== undefined,
    encryptionConfigured: masterKey !== undefined,
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
      const credentials = await sourceRepository.getSourceCredentials(
        sourceId.data,
      );
      if (!credentials)
        return reply.code(404).send({ error: 'Source not found' });

      const inspection = await playlistInspector(credentials.playlistUrl);
      let snapshot: StoredSnapshotSummary;
      try {
        snapshot = await sourceRepository.savePlaylistSnapshot(
          sourceId.data,
          inspection,
        );
      } catch (error) {
        if (error instanceof SnapshotRejectedError) {
          return reply.code(422).send({ error: error.message });
        }
        throw error;
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
