import { describe, expect, it, vi } from 'vitest';
import { mediaCategoryKey, type PlaylistInspection } from '@iptvmaster/core';
import { BackgroundWorkQueue } from './background-work.js';
import { updateSourceWithImportMethod } from './source-import-method.js';
import type {
  SourceRepository,
  UpdateSourceInput,
} from './source-repository.js';

function setup() {
  const source = {
    id: 'source',
    sourceType: 'm3u',
    importLive: false,
    importCatalogue: true,
  };
  const repository = {
    listSources: vi.fn(async () => [source]),
    getSourceCredentials: vi.fn(async () => ({
      playlistUrl: 'https://fixture.test/get.php?username=demo&password=demo',
    })),
    getImportPlan: vi.fn(async () => ({
      selectiveGroups: new Set([mediaCategoryKey('series', 'Shows')]),
    })),
    listSourceHistory: vi.fn(async () => ({ snapshots: [], activity: [] })),
    updateSource: vi.fn(async () => ({ ...source, sourceType: 'xtream' })),
  };
  const candidate: PlaylistInspection = {
    entries: [],
    fingerprint: 'a'.repeat(64),
    totalBytes: 10,
    skippedEntries: 0,
    mediaCounts: { live: 0, vod: 0, series: 1, unknown: 0 },
    issues: [],
    categories: [{ mediaType: 'series', providerGroup: 'Shows', itemCount: 1 }],
  };
  const inspector = vi.fn(async () => candidate);
  const input: UpdateSourceInput = {
    sourceType: 'xtream',
    name: 'Existing',
    sourceTimezone: 'UTC',
    displayTimezone: 'UTC',
  };
  const queue = new BackgroundWorkQueue();
  const run = () =>
    updateSourceWithImportMethod(
      repository as unknown as SourceRepository,
      source.id,
      input,
      inspector,
      queue.run.bind(queue),
    );
  return { repository, candidate, inspector, input, run, queue, source };
}

describe('in-place source import method', () => {
  it('preflights with saved credentials and selection before updating the same source', async () => {
    const fixture = setup();
    await expect(fixture.run()).resolves.toMatchObject({
      id: 'source',
      sourceType: 'xtream',
    });
    expect(fixture.inspector).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        sourceType: 'xtream',
        includeLive: false,
        includeCatalogue: true,
      }),
    );
    expect(fixture.repository.updateSource).toHaveBeenCalledWith(
      'source',
      fixture.input,
    );
    expect(fixture.inspector.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.repository.updateSource.mock.invocationCallOrder[0]!,
    );
  });
  it('does not mutate the source on provider failure or incompatible category names', async () => {
    const fixture = setup();
    fixture.candidate.categories = [
      { mediaType: 'series', providerGroup: 'Different names', itemCount: 1 },
    ];
    await expect(fixture.run()).rejects.toThrow('Nothing was changed');
    expect(fixture.repository.updateSource).not.toHaveBeenCalled();
    fixture.inspector.mockRejectedValueOnce(
      new Error('Synthetic provider rejection'),
    );
    await expect(fixture.run()).rejects.toThrow('Synthetic provider rejection');
    expect(fixture.repository.updateSource).not.toHaveBeenCalled();
  });
  it('rejects a plain M3U URL before contacting a native API', async () => {
    const fixture = setup();
    fixture.repository.getSourceCredentials.mockResolvedValue({
      playlistUrl: 'https://fixture.test/list.m3u',
    });
    await expect(fixture.run()).rejects.toThrow('Keep M3U');
    expect(fixture.inspector).not.toHaveBeenCalled();
    expect(fixture.repository.updateSource).not.toHaveBeenCalled();
  });
  it('waits for an active import before checking or changing methods', async () => {
    const fixture = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = fixture.queue.run(() => gate);
    const conversion = fixture.run();
    await Promise.resolve();
    expect(fixture.inspector).not.toHaveBeenCalled();
    release();
    await first;
    await conversion;
    expect(fixture.repository.updateSource).toHaveBeenCalledTimes(1);
  });
  it('rejects a native live lineup that fails the existing drop safeguard', async () => {
    const fixture = setup();
    fixture.source.importLive = true;
    await expect(fixture.run()).rejects.toThrow('at least 1');
    expect(fixture.repository.updateSource).not.toHaveBeenCalled();
  });
});
