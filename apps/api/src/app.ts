import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import {
  applyEventGroupPolicy,
  localizeEventName,
  parseM3uText,
  redactStreamUrl,
  type EventGroupPolicy,
  type M3uEntry,
} from '@iptvmaster/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

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

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.body.playlist',
          'req.body.url',
          'password',
          '*.password',
          '*.url',
        ],
        censor: '[redacted]',
      },
    },
    bodyLimit: 10_500_000,
  });

  await app.register(cors, {
    origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  });

  app.get('/health', async () => ({ status: 'ok', service: 'iptvmaster-api' }));

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
