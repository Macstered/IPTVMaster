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
  const output: M3uEntry[] = [];
  let hiddenEntries = 0;
  let localizedEvents = 0;

  for (const entry of entries) {
    const groupName = entry.attributes['group-title'] ?? '';
    const policy = policiesByGroup.get(groupName);
    if (!policy) {
      output.push(entry);
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
        output.push(applied.entry);
      }
      continue;
    }

    output.push({
      ...entry,
      attributes: {
        ...entry.attributes,
        ...(policy.outputGroupName
          ? { 'group-title': policy.outputGroupName }
          : {}),
      },
    });
  }

  return { entries: output, hiddenEntries, localizedEvents };
}
