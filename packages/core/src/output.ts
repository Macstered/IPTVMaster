import { applyEventGroupPolicy } from './events.js';
import type {
  M3uEntry,
  OutputGroupPolicy,
  OutputPolicyResult,
} from './types.js';

export function applyOutputGroupPolicies(
  entries: readonly M3uEntry[],
  policies: readonly OutputGroupPolicy[],
): OutputPolicyResult {
  const policiesByGroup = new Map(
    policies.map((policy) => [policy.groupName, policy]),
  );
  const output: Array<{
    entry: M3uEntry;
    eventGroup?: string;
    startsAt?: number;
    originalIndex: number;
  }> = [];
  let hiddenEntries = 0;
  let localizedEvents = 0;

  for (const [originalIndex, entry] of entries.entries()) {
    const groupName = entry.attributes['group-title'] ?? '';
    // Group policies describe live TV and transient event groups. A movie or
    // series category can legitimately have the same provider label, but must
    // not inherit the live group's hide, rename, or time-conversion rules.
    const policy =
      entry.mediaType === 'live' ? policiesByGroup.get(groupName) : undefined;
    if (!policy) {
      output.push({ entry, originalIndex });
      continue;
    }
    if (!policy.enabled) {
      hiddenEntries += 1;
      continue;
    }

    if (policy.behavior === 'event') {
      const applied = applyEventGroupPolicy(entry, policy);
      if (applied.hidden) {
        hiddenEntries += 1;
      } else {
        if (applied.time.changed) localizedEvents += 1;
        const parsedStart = applied.time.displayDateTime
          ? Date.parse(applied.time.displayDateTime)
          : Number.NaN;
        output.push({
          entry: applied.entry,
          // Pooled by the name the entry is published under, not the provider
          // group it came from. Several event groups can be renamed into one
          // output group, and there they are a single schedule: sorting them
          // separately would list one group's evening before the next
          // group's afternoon.
          eventGroup: policy.outputGroupName ?? groupName,
          ...(Number.isNaN(parsedStart) ? {} : { startsAt: parsedStart }),
          originalIndex,
        });
      }
      continue;
    }

    output.push({
      originalIndex,
      entry: {
        ...entry,
        attributes: {
          ...entry.attributes,
          ...(policy.outputGroupName
            ? { 'group-title': policy.outputGroupName }
            : {}),
        },
      },
    });
  }

  const positionsByEventGroup = new Map<string, number[]>();
  for (const [index, item] of output.entries()) {
    if (!item.eventGroup) continue;
    const positions = positionsByEventGroup.get(item.eventGroup) ?? [];
    positions.push(index);
    positionsByEventGroup.set(item.eventGroup, positions);
  }
  for (const positions of positionsByEventGroup.values()) {
    const sorted = positions
      .map((position) => output[position])
      .filter((item): item is NonNullable<typeof item> => item !== undefined)
      .sort(
        (left, right) =>
          (left.startsAt ?? Number.POSITIVE_INFINITY) -
            (right.startsAt ?? Number.POSITIVE_INFINITY) ||
          left.originalIndex - right.originalIndex,
      );
    positions.forEach((position, index) => {
      const item = sorted[index];
      if (item) output[position] = item;
    });
  }

  return {
    entries: output.map((item) => item.entry),
    hiddenEntries,
    localizedEvents,
  };
}
