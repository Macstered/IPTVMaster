import type { PlaylistInspection } from './source-import.js';

export interface SnapshotValidationOptions {
  minimumLiveEntries?: number;
  minimumPreviousRatio?: number;
  maximumIssueRatio?: number;
  issueAllowance?: number;
}

export class SnapshotRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotRejectedError';
  }
}

export function validateSnapshotCandidate(
  inspection: PlaylistInspection,
  previousLiveCount?: number,
  options: SnapshotValidationOptions = {},
): void {
  const minimumLiveEntries = options.minimumLiveEntries ?? 1;
  const minimumPreviousRatio = options.minimumPreviousRatio ?? 0.5;
  const maximumIssueRatio = options.maximumIssueRatio ?? 0.1;
  const issueAllowance = options.issueAllowance ?? 100;
  // Counted by kind rather than by retained length: a snapshot also carries
  // whichever film and series categories are switched on, and letting those
  // inflate the live count would make turning a category off look like the
  // provider had dropped half the channels.
  const liveCount = inspection.entries.filter(
    (entry) => entry.mediaType === 'live',
  ).length;

  if (liveCount < minimumLiveEntries) {
    throw new SnapshotRejectedError(
      `Snapshot has ${liveCount} live entries; at least ${minimumLiveEntries} are required`,
    );
  }

  // An empty snapshot is deliberately allowed when live import is off: the
  // first pass over a catalogue-only provider retains nothing and exists to
  // record which categories are on offer. Rejecting it would leave no way to
  // ever choose one.

  if (
    previousLiveCount !== undefined &&
    previousLiveCount > 0 &&
    liveCount < Math.ceil(previousLiveCount * minimumPreviousRatio)
  ) {
    throw new SnapshotRejectedError(
      `Snapshot live count dropped from ${previousLiveCount} to ${liveCount}; manual review is required`,
    );
  }

  const allowedIssues = Math.max(
    issueAllowance,
    Math.ceil(liveCount * maximumIssueRatio),
  );
  if (inspection.issues.length > allowedIssues) {
    throw new SnapshotRejectedError(
      `Snapshot has ${inspection.issues.length} parse issues; the safe limit is ${allowedIssues}`,
    );
  }
}
