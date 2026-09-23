import {
  mediaCategoryKey,
  parseXtreamInput,
  validateSnapshotCandidate,
  type PlaylistInspection,
} from '@iptvmaster/core';
import type { ExclusiveBackgroundRun } from './background-work.js';
import type {
  SourceImportPlan,
  SourceRepository,
  UpdateSourceInput,
} from './source-repository.js';

export class SourceImportMethodError extends Error {}

export function assertNativeCredentials(playlistUrl: string): void {
  const account = parseXtreamInput(playlistUrl);
  if (!account.server || !account.username || !account.password) {
    throw new SourceImportMethodError(
      'Native Xtream needs a provider URL with Xtream login details. Keep M3U for ordinary playlist URLs.',
    );
  }
}

/** Preflight without changing the saved source, and serialize with all imports. */
export async function updateSourceWithImportMethod(
  repository: SourceRepository,
  sourceId: string,
  input: UpdateSourceInput,
  inspect: (
    url: string,
    plan?: SourceImportPlan,
  ) => Promise<PlaylistInspection>,
  runExclusive: ExclusiveBackgroundRun,
) {
  const update = async () => {
    const source = (await repository.listSources()).find(
      (item) => item.id === sourceId,
    );
    if (!source) return null;
    if (input.sourceType && input.sourceType !== source.sourceType) {
      const credentials = await repository.getSourceCredentials(sourceId);
      if (!credentials) return null;
      const url = input.playlistUrl ?? credentials.playlistUrl;
      if (input.sourceType === 'xtream') assertNativeCredentials(url);
      const existingPlan = await repository.getImportPlan?.(sourceId);
      const plan: SourceImportPlan = {
        sourceType: input.sourceType,
        includeLive: input.importLive ?? source.importLive,
        includeCatalogue: input.importCatalogue ?? source.importCatalogue,
        selectiveGroups: existingPlan?.selectiveGroups ?? new Set(),
      };
      const candidate = await inspect(url, plan);
      if (plan.includeCatalogue) {
        const offered = new Set(
          candidate.categories.map((category) =>
            mediaCategoryKey(category.mediaType, category.providerGroup),
          ),
        );
        if ([...plan.selectiveGroups].some((key) => !offered.has(key))) {
          throw new SourceImportMethodError(
            'The new import method does not offer every selected film/series category under the same name. Nothing was changed; review category compatibility first.',
          );
        }
      }
      const history = await repository.listSourceHistory(sourceId, 100);
      const previous = history.snapshots.find((snapshot) => snapshot.isCurrent);
      validateSnapshotCandidate(
        candidate,
        plan.includeLive ? previous?.liveCount : undefined,
        { minimumLiveEntries: plan.includeLive ? 1 : 0 },
      );
    }
    return repository.updateSource(sourceId, input);
  };
  // Plain name/connection edits keep their existing light-weight path.
  return input.sourceType
    ? runExclusive(update)
    : repository.updateSource(sourceId, input);
}
