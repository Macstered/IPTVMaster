import { type DragEvent, type FormEvent, useEffect, useState } from 'react';

import { ChannelLogo } from './components/ChannelLogo.js';
import { IconChevronDown, IconChevronUp, IconGrip, IconTv } from './icons.js';
import { showToast } from './toast.js';
import { EpgWorkspace } from './workspaces/EpgWorkspace.js';

export type WorkspaceView =
  'overview' | 'lineup' | 'events' | 'epg' | 'updates';
export type LineupView = 'order' | 'channels';

interface SourceSetupProps {
  workspace: WorkspaceView;
  lineupView: LineupView;
}

interface Capabilities {
  version: string;
  revision: string;
  sourcePersistence: boolean;
  databaseConfigured: boolean;
  encryptionConfigured: boolean;
  playlistAutomation: boolean;
  epgAutomation: boolean;
}

interface SafeSource {
  id: string;
  name: string;
  sourceType: 'm3u' | 'xtream';
  sourceTimezone: string;
  displayTimezone: string;
  enabled: boolean;
  hasEpgUrl: boolean;
}

interface ImportSummary {
  fingerprint: string;
  totalBytes: number;
  retainedLiveEntries: number;
  skippedEntries: number;
  mediaCounts: Record<string, number>;
  issues: number;
}

interface EpgImportSummary {
  totalBytes: number;
  channelCount: number;
  programmeCount: number;
  issueCount: number;
  issuesTruncated: boolean;
}

interface GroupSummary {
  providerGroup: string;
  channelCount: number;
  sortOrder: number;
  configured: boolean;
  behavior: 'permanent' | 'event';
  enabled: boolean;
  outputGroupName?: string;
  hidePlaceholders: boolean;
  placeholderPatterns?: string[];
  sourceTimeZone: string;
  displayTimeZone: string;
  numericDateOrder: 'month-day' | 'day-month';
}

interface EventReviewEntry {
  id: string;
  originalName: string;
  localizedName: string;
  status: 'localized' | 'no-time' | 'invalid-time' | 'invalid-timezone';
  hidden: boolean;
  hideReason?: string;
  sourceDateTime?: string;
  displayDateTime?: string;
  crossedDateBoundary: boolean;
  warning?: string;
}

interface EventReviewGroup {
  groupName: string;
  outputGroupName?: string;
  enabled: boolean;
  hidePlaceholders: boolean;
  placeholderPatterns: string[];
  timePolicy?: {
    sourceTimeZone: string;
    displayTimeZone: string;
    numericDateOrder: 'month-day' | 'day-month';
    referenceDate: string;
  };
  totalEntries: number;
  hiddenEntries: number;
  localizedEntries: number;
  warningEntries: number;
  entries: EventReviewEntry[];
}

interface EventReview {
  referenceDate: string;
  groups: EventReviewGroup[];
  summary: {
    groupCount: number;
    totalEntries: number;
    hiddenEntries: number;
    localizedEntries: number;
    warningEntries: number;
  };
  truncated: boolean;
}

interface EventRuleDraft {
  enabled: boolean;
  outputGroupName: string;
  hidePlaceholders: boolean;
  placeholderPatterns: string;
  sourceTimeZone: string;
  displayTimeZone: string;
  numericDateOrder: 'month-day' | 'day-month';
}

type ChannelStatus = 'matched' | 'new' | 'missing' | 'ambiguous';

interface ChannelSummary {
  id: string;
  sourceId: string;
  providerName: string;
  providerGroup: string;
  tvgId?: string;
  providerLogoUrl?: string;
  enabled: boolean;
  customName?: string;
  customGroup?: string;
  customLogoUrl?: string;
  sortOrder: number;
  matchLocked: boolean;
  matchConfidence?: number;
  reconciliationStatus: ChannelStatus;
}

interface ChannelListPage {
  channels: ChannelSummary[];
  total: number;
  limit: number;
  offset: number;
}

interface PermanentGroupSummary {
  providerGroup: string;
  channelCount: number;
  enabledCount: number;
  hiddenCount: number;
  firstSortOrder: number;
  outputGroupStatus: 'provider' | 'custom' | 'mixed';
  outputGroupName?: string;
}

interface CustomCategory {
  name: string;
  channelCount: number;
}

interface OutputGroupSummary {
  name: string;
  entryCount: number;
  visibleEntryCount: number;
  behavior: 'permanent' | 'event' | 'mixed';
  sortOrder: number;
}

interface ChannelDraft {
  customName: string;
  customGroup: string;
  customLogoUrl: string;
  sortOrder: string;
}

interface ReconciliationCandidate {
  upstreamItemId: string;
  providerName: string;
  providerGroup: string;
  tvgId?: string;
  linkedChannelId?: string;
  linkedChannelStatus?: ChannelStatus;
}

interface ReconciliationReview {
  unresolvedChannels: ChannelSummary[];
  candidates: ReconciliationCandidate[];
  ambiguousCount: number;
  missingCount: number;
  newCount: number;
  candidateTotal: number;
  truncated: boolean;
}

interface SnapshotHistoryItem {
  id: string;
  fingerprint: string;
  importedAt: string;
  liveCount: number;
  skippedEntries: number;
  issueCount: number;
  isCurrent: boolean;
}

interface SourceActivityEvent {
  id: string;
  kind:
    | 'playlist-sync'
    | 'epg-sync'
    | 'manual-match'
    | 'manual-unlock'
    | 'manual-epg-map'
    | 'manual-epg-unlock'
    | 'manual-epg-exclude'
    | 'manual-epg-include'
    | 'snapshot-activate'
    | 'snapshot-reactivate';
  occurredAt: string;
  title: string;
  detail: string;
  status?: 'succeeded' | 'failed' | 'rejected';
}

interface SourceHistory {
  snapshots: SnapshotHistoryItem[];
  activity: SourceActivityEvent[];
}

interface CreatedOutputProfile {
  id: string;
  name: string;
  accessToken: string;
  playlistPath: string;
  epgPath: string;
}

interface ActiveOutputProfile {
  id: string;
  name: string;
  sourceIds: string[];
  createdAt: string;
  recoverable: boolean;
  accessToken?: string;
}

async function readJson<T>(response: Response): Promise<T> {
  const value: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof value === 'object' &&
      value !== null &&
      'error' in value &&
      typeof value.error === 'string'
        ? value.error
        : 'Request failed';
    throw new Error(message);
  }
  return value as T;
}

const TIMEZONE_CHOICES: string[] =
  (
    Intl as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf?.('timeZone') ?? [];

function formatHistoryTime(value: string): string {
  return new Intl.DateTimeFormat('en-FI', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Helsinki',
  }).format(new Date(value));
}

function formatEventTime(value: string | undefined, timeZone: string): string {
  if (!value) return 'Time not parsed';
  return new Intl.DateTimeFormat('en-FI', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

export function SourceSetup({ workspace, lineupView }: SourceSetupProps) {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [sources, setSources] = useState<SafeSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [editingConnection, setEditingConnection] = useState<SafeSource | null>(
    null,
  );
  const [name, setName] = useState('Home provider');
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [epgUrl, setEpgUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [removingSourceId, setRemovingSourceId] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(
    null,
  );
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [importingEpgId, setImportingEpgId] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(
    null,
  );
  const [epgImportSummary, setEpgImportSummary] =
    useState<EpgImportSummary | null>(null);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupFilter, setGroupFilter] = useState('');
  const [eventGroupView, setEventGroupView] = useState<'events' | 'all'>(
    'events',
  );
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [eventReview, setEventReview] = useState<EventReview | null>(null);
  const [selectedEventGroup, setSelectedEventGroup] = useState('');
  const [editingEventGroup, setEditingEventGroup] = useState<string | null>(
    null,
  );
  const [eventRuleDraft, setEventRuleDraft] = useState<EventRuleDraft | null>(
    null,
  );
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [channelTotal, setChannelTotal] = useState(0);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [savingChannel, setSavingChannel] = useState<string | null>(null);
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const [channelDraft, setChannelDraft] = useState<ChannelDraft>({
    customName: '',
    customGroup: '',
    customLogoUrl: '',
    sortOrder: '0',
  });
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [bulkGroup, setBulkGroup] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [permanentGroups, setPermanentGroups] = useState<
    PermanentGroupSummary[]
  >([]);
  const [permanentGroupFilter, setPermanentGroupFilter] = useState('');
  const [expandedPermanentGroup, setExpandedPermanentGroup] = useState<
    string | null
  >(null);
  const [loadingPermanentGroups, setLoadingPermanentGroups] = useState(false);
  const [savingPermanentGroup, setSavingPermanentGroup] = useState<
    string | null
  >(null);
  const [draggedChannelId, setDraggedChannelId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [permanentGroupNames, setPermanentGroupNames] = useState<
    Record<string, string>
  >({});
  const [outputGroupFilter, setOutputGroupFilter] = useState('');
  const [draggedOutputGroup, setDraggedOutputGroup] = useState<string | null>(
    null,
  );
  const [savingOutputGroupOrder, setSavingOutputGroupOrder] = useState<
    string | null
  >(null);
  const [outputGroupCategories, setOutputGroupCategories] = useState<
    OutputGroupSummary[]
  >([]);
  const [expandedOutputGroup, setExpandedOutputGroup] = useState<string | null>(
    null,
  );
  const [outputGroupChannels, setOutputGroupChannels] = useState<
    ChannelSummary[]
  >([]);
  const [outputGroupChannelTotal, setOutputGroupChannelTotal] = useState(0);
  const [loadingOutputGroupChannels, setLoadingOutputGroupChannels] =
    useState(false);
  const [draggedOutputGroupChannelId, setDraggedOutputGroupChannelId] =
    useState<string | null>(null);
  const [showHiddenPermanentGroups, setShowHiddenPermanentGroups] =
    useState(false);
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>(
    [],
  );
  const [newCustomCategory, setNewCustomCategory] = useState('');
  const [savingCustomCategory, setSavingCustomCategory] = useState(false);
  const [review, setReview] = useState<ReconciliationReview | null>(null);
  const [reviewMatches, setReviewMatches] = useState<Record<string, string>>(
    {},
  );
  const [resolvingChannel, setResolvingChannel] = useState<string | null>(null);
  const [sourceHistory, setSourceHistory] = useState<SourceHistory | null>(
    null,
  );
  const [confirmingSnapshot, setConfirmingSnapshot] = useState<string | null>(
    null,
  );
  const [restoringSnapshot, setRestoringSnapshot] = useState<string | null>(
    null,
  );
  const [creatingOutput, setCreatingOutput] = useState(false);
  const [outputSourceIds, setOutputSourceIds] = useState<string[]>([]);
  const [outputName, setOutputName] = useState('TiviMate');
  const [outputProfiles, setOutputProfiles] = useState<ActiveOutputProfile[]>(
    [],
  );
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({});

  async function loadGroups(sourceId: string) {
    const response = await fetch(`/api/v1/sources/${sourceId}/groups`);
    const payload = await readJson<{ groups: GroupSummary[] }>(response);
    setGroups(payload.groups);
  }

  async function loadOutputGroupCategories(sourceId: string) {
    const response = await fetch(`/api/v1/sources/${sourceId}/output-groups`);
    const payload = await readJson<{ groups: OutputGroupSummary[] }>(response);
    setOutputGroupCategories(payload.groups);
  }

  async function loadChannels(sourceId: string, group?: string) {
    setLoadingChannels(true);
    try {
      const parameters = new URLSearchParams({ limit: '2000' });
      if (group !== undefined) parameters.set('group', group);
      const response = await fetch(
        `/api/v1/sources/${sourceId}/channels?${parameters.toString()}`,
      );
      const payload = await readJson<ChannelListPage>(response);
      setChannels(payload.channels);
      setChannelTotal(payload.total);
      setSelectedChannelIds([]);
    } finally {
      setLoadingChannels(false);
    }
  }

  async function loadOutputGroupChannels(
    sourceId: string,
    outputGroup: string,
  ) {
    setLoadingOutputGroupChannels(true);
    try {
      const parameters = new URLSearchParams({
        limit: '2000',
        outputGroup,
      });
      const response = await fetch(
        `/api/v1/sources/${sourceId}/channels?${parameters.toString()}`,
      );
      const payload = await readJson<ChannelListPage>(response);
      setOutputGroupChannels(payload.channels);
      setOutputGroupChannelTotal(payload.total);
    } finally {
      setLoadingOutputGroupChannels(false);
    }
  }

  async function loadPermanentGroups(sourceId: string) {
    setLoadingPermanentGroups(true);
    try {
      const response = await fetch(
        `/api/v1/sources/${sourceId}/permanent-groups`,
      );
      const payload = await readJson<{ groups: PermanentGroupSummary[] }>(
        response,
      );
      setPermanentGroups(payload.groups);
    } finally {
      setLoadingPermanentGroups(false);
    }
  }

  async function loadCustomCategories(sourceId: string) {
    const response = await fetch(
      `/api/v1/sources/${sourceId}/custom-categories`,
    );
    const payload = await readJson<{ categories: CustomCategory[] }>(response);
    setCustomCategories(payload.categories);
  }

  async function refreshPermanentWorkspace(sourceId: string) {
    const updates: Promise<void>[] = [
      loadPermanentGroups(sourceId),
      loadCustomCategories(sourceId),
      loadOutputGroupCategories(sourceId),
    ];
    if (expandedPermanentGroup !== null) {
      updates.push(loadChannels(sourceId, expandedPermanentGroup));
    }
    await Promise.all(updates);
  }

  async function loadReconciliationReview(sourceId: string, search = '') {
    const parameters = new URLSearchParams({ limit: '100' });
    if (search.trim()) parameters.set('search', search.trim());
    const response = await fetch(
      `/api/v1/sources/${sourceId}/channel-review?${parameters.toString()}`,
    );
    const payload = await readJson<ReconciliationReview>(response);
    setReview(payload);
    setReviewMatches((current) => {
      const next: Record<string, string> = {};
      for (const channel of payload.unresolvedChannels) {
        if (current[channel.id]) next[channel.id] = current[channel.id];
      }
      return next;
    });
  }

  async function loadSourceHistory(sourceId: string) {
    const response = await fetch(
      `/api/v1/sources/${sourceId}/history?limit=20`,
    );
    setSourceHistory(await readJson<SourceHistory>(response));
  }

  async function loadEventReview(sourceId: string) {
    const response = await fetch(
      `/api/v1/sources/${sourceId}/events?limit=200`,
    );
    const payload = await readJson<EventReview>(response);
    setEventReview(payload);
    setSelectedEventGroup((current) =>
      payload.groups.some((group) => group.groupName === current)
        ? current
        : (payload.groups[0]?.groupName ?? ''),
    );
  }

  async function loadOutputProfiles() {
    const response = await fetch('/api/v1/output-profiles');
    const payload = await readJson<{ profiles: ActiveOutputProfile[] }>(
      response,
    );
    setOutputProfiles(payload.profiles);
  }

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const capabilitiesResponse = await fetch('/api/v1/system/capabilities');
        const nextCapabilities =
          await readJson<Capabilities>(capabilitiesResponse);
        if (!active) return;
        setCapabilities(nextCapabilities);
        if (nextCapabilities.sourcePersistence) {
          const sourcesResponse = await fetch('/api/v1/sources');
          const payload = await readJson<{ sources: SafeSource[] }>(
            sourcesResponse,
          );
          if (active) {
            setSources(payload.sources);
            const firstSource = payload.sources[0];
            const initialLoads: Promise<void>[] = [loadOutputProfiles()];
            if (firstSource) {
              setSelectedSourceId(firstSource.id);
              setOutputSourceIds([firstSource.id]);
              initialLoads.push(
                loadGroups(firstSource.id),
                loadOutputGroupCategories(firstSource.id),
                loadPermanentGroups(firstSource.id),
                loadCustomCategories(firstSource.id),
                loadReconciliationReview(firstSource.id),
                loadSourceHistory(firstSource.id),
                loadEventReview(firstSource.id),
              );
            }
            await Promise.all(initialLoads);
          }
        }
      } catch (caught) {
        if (active)
          showToast(
            'error',
            caught instanceof Error ? caught.message : 'Setup check failed',
          );
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  async function selectSource(source: SafeSource) {
    if (source.id === selectedSourceId) return;
    setSelectedSourceId(source.id);
    setImportSummary(null);
    setEpgImportSummary(null);
    setExpandedPermanentGroup(null);
    setExpandedOutputGroup(null);
    setOutputGroupChannels([]);
    setOutputGroupChannelTotal(0);
    setChannels([]);
    setChannelTotal(0);
    setSelectedChannelIds([]);
    setEditingChannel(null);
    try {
      await Promise.all([
        loadGroups(source.id),
        loadOutputGroupCategories(source.id),
        loadPermanentGroups(source.id),
        loadCustomCategories(source.id),
        loadReconciliationReview(source.id),
        loadSourceHistory(source.id),
        loadEventReview(source.id),
      ]);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Could not load provider',
      );
    }
  }

  function clearSourceForm() {
    setEditingConnection(null);
    setName('Home provider');
    setPlaylistUrl('');
    setEpgUrl('');
    setShowSourceForm(false);
  }

  async function beginConnectionEdit(source: SafeSource) {
    setEditingConnection(source);
    setShowSourceForm(false);
    setName(source.name);
    setPlaylistUrl('');
    setEpgUrl('');
    await selectSource(source);
  }

  async function updateSourceConnection(
    source: SafeSource,
    options: { deriveEpgUrl?: boolean; clearEpgUrl?: boolean } = {},
  ) {
    setSaving(true);
    try {
      const response = await fetch(`/api/v1/sources/${source.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          ...(playlistUrl.trim() ? { playlistUrl: playlistUrl.trim() } : {}),
          ...(!options.deriveEpgUrl && !options.clearEpgUrl && epgUrl.trim()
            ? { epgUrl: epgUrl.trim() }
            : {}),
          ...(options.deriveEpgUrl ? { deriveEpgUrl: true } : {}),
          ...(options.clearEpgUrl ? { clearEpgUrl: true } : {}),
          sourceTimezone: source.sourceTimezone,
          displayTimezone: source.displayTimezone,
        }),
      });
      const payload = await readJson<{ source: SafeSource }>(response);
      setSources((current) =>
        current.map((candidate) =>
          candidate.id === source.id ? payload.source : candidate,
        ),
      );
      if (options.deriveEpgUrl || epgUrl.trim()) {
        await importEpg(payload.source);
      }
      clearSourceForm();
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not update provider connection',
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveSource(event: FormEvent) {
    event.preventDefault();
    if (editingConnection) {
      await updateSourceConnection(editingConnection);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/v1/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          sourceType: 'm3u',
          playlistUrl,
          ...(epgUrl ? { epgUrl } : {}),
          sourceTimezone: 'Europe/Stockholm',
          displayTimezone: 'Europe/Helsinki',
        }),
      });
      const payload = await readJson<{ source: SafeSource }>(response);
      setSources((current) => [...current, payload.source]);
      clearSourceForm();
      setOutputSourceIds((current) =>
        current.length > 0 ? current : [payload.source.id],
      );
      await selectSource(payload.source);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Could not save source',
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeSource(source: SafeSource) {
    setConfirmingRemoval(null);
    setRemovingSourceId(source.id);
    try {
      const response = await fetch(`/api/v1/sources/${source.id}`, {
        method: 'DELETE',
      });
      const payload = await readJson<{ revokedOutputProfiles: number }>(
        response,
      );
      const remaining = sources.filter(
        (candidate) => candidate.id !== source.id,
      );
      showToast('success', `${source.name} removed`);
      setSources(remaining);
      setOutputSourceIds((current) =>
        current.filter((sourceId) => sourceId !== source.id),
      );
      await loadOutputProfiles();
      clearSourceForm();
      if (selectedSourceId === source.id) {
        const nextSource = remaining[0] ?? null;
        setSelectedSourceId(nextSource?.id ?? null);
        setGroups([]);
        setOutputGroupCategories([]);
        setExpandedOutputGroup(null);
        setOutputGroupChannels([]);
        setOutputGroupChannelTotal(0);
        setPermanentGroups([]);
        setChannels([]);
        setChannelTotal(0);
        setEventReview(null);
        setSourceHistory(null);
        if (nextSource) await selectSource(nextSource);
      }
      if (payload.revokedOutputProfiles > 0) {
        showToast(
          'success',
          `${payload.revokedOutputProfiles} output URL${
            payload.revokedOutputProfiles === 1 ? ' was' : 's were'
          } revoked because it included this provider.`,
        );
      }
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Could not remove provider',
      );
    } finally {
      setRemovingSourceId(null);
    }
  }

  async function inspectSource(source: SafeSource) {
    setInspectingId(source.id);
    setImportSummary(null);
    try {
      const response = await fetch(`/api/v1/sources/${source.id}/import`, {
        method: 'POST',
      });
      const payload = await readJson<{ summary: ImportSummary }>(response);
      setImportSummary(payload.summary);
      showToast(
        'success',
        `Playlist imported: ${payload.summary.retainedLiveEntries.toLocaleString()} live entries`,
      );
      await Promise.all([
        loadGroups(source.id),
        refreshPermanentWorkspace(source.id),
        loadReconciliationReview(source.id),
        loadSourceHistory(source.id),
        loadEventReview(source.id),
      ]);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Could not inspect source',
      );
    } finally {
      setInspectingId(null);
    }
  }

  async function importEpg(source: SafeSource) {
    setImportingEpgId(source.id);
    setEpgImportSummary(null);
    try {
      const response = await fetch(`/api/v1/sources/${source.id}/epg/import`, {
        method: 'POST',
      });
      const payload = await readJson<{ inspection: EpgImportSummary }>(
        response,
      );
      setEpgImportSummary(payload.inspection);
      showToast(
        'success',
        `Guide imported: ${payload.inspection.channelCount.toLocaleString()} EPG channels`,
      );
      await Promise.all([loadSourceHistory(source.id)]);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Could not import XMLTV',
      );
    } finally {
      setImportingEpgId(null);
    }
  }

  async function setGroupBehavior(
    source: SafeSource,
    group: GroupSummary,
    behavior: 'permanent' | 'event',
  ) {
    setSavingGroup(group.providerGroup);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/group-policies`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            groupName: group.providerGroup,
            behavior,
            enabled: true,
            hidePlaceholders: true,
            sourceTimeZone: 'Europe/Stockholm',
            displayTimeZone: 'Europe/Helsinki',
            numericDateOrder: 'month-day',
          }),
        },
      );
      const payload = await readJson<{ group: GroupSummary }>(response);
      setGroups((current) =>
        current.map((candidate) =>
          candidate.providerGroup === payload.group.providerGroup
            ? payload.group
            : candidate,
        ),
      );
      await Promise.all([
        refreshPermanentWorkspace(source.id),
        loadReconciliationReview(source.id),
        loadEventReview(source.id),
      ]);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not save group policy',
      );
    } finally {
      setSavingGroup(null);
    }
  }

  function beginEventRuleEdit(group: GroupSummary) {
    setEditingEventGroup(group.providerGroup);
    setSelectedEventGroup(group.providerGroup);
    setEventRuleDraft({
      enabled: group.enabled,
      outputGroupName: group.outputGroupName ?? '',
      hidePlaceholders: group.hidePlaceholders,
      placeholderPatterns: (group.placeholderPatterns ?? []).join('\n'),
      sourceTimeZone: group.sourceTimeZone,
      displayTimeZone: group.displayTimeZone,
      numericDateOrder: group.numericDateOrder,
    });
  }

  async function saveEventRule(
    event: FormEvent,
    source: SafeSource,
    group: GroupSummary,
  ) {
    event.preventDefault();
    if (!eventRuleDraft) return;
    setSavingGroup(group.providerGroup);
    try {
      const placeholderPatterns = eventRuleDraft.placeholderPatterns
        .split(/\r?\n/)
        .map((pattern) => pattern.trim())
        .filter(Boolean);
      const response = await fetch(
        `/api/v1/sources/${source.id}/group-policies`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            groupName: group.providerGroup,
            behavior: 'event',
            enabled: eventRuleDraft.enabled,
            ...(eventRuleDraft.outputGroupName.trim()
              ? { outputGroupName: eventRuleDraft.outputGroupName.trim() }
              : {}),
            hidePlaceholders: eventRuleDraft.hidePlaceholders,
            placeholderPatterns,
            sourceTimeZone: eventRuleDraft.sourceTimeZone.trim(),
            displayTimeZone: eventRuleDraft.displayTimeZone.trim(),
            numericDateOrder: eventRuleDraft.numericDateOrder,
          }),
        },
      );
      const payload = await readJson<{ group: GroupSummary }>(response);
      setGroups((current) =>
        current.map((candidate) =>
          candidate.providerGroup === payload.group.providerGroup
            ? payload.group
            : candidate,
        ),
      );
      await Promise.all([
        loadEventReview(source.id),
        loadOutputGroupCategories(source.id),
      ]);
      setEditingEventGroup(null);
      setEventRuleDraft(null);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Could not save event rule',
      );
    } finally {
      setSavingGroup(null);
    }
  }

  function beginChannelEdit(channel: ChannelSummary) {
    setEditingChannel(channel.id);
    setChannelDraft({
      customName: channel.customName ?? '',
      customGroup: channel.customGroup ?? '',
      customLogoUrl: channel.customLogoUrl ?? '',
      sortOrder: String(channel.sortOrder),
    });
  }

  async function updateChannel(
    source: SafeSource,
    channel: ChannelSummary,
    update: Record<string, unknown>,
  ) {
    setSavingChannel(channel.id);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/channels/${channel.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(update),
        },
      );
      const payload = await readJson<{ channel: ChannelSummary }>(response);
      setChannels((current) =>
        current.map((candidate) =>
          candidate.id === payload.channel.id ? payload.channel : candidate,
        ),
      );
      setOutputGroupChannels((current) =>
        current
          .map((candidate) =>
            candidate.id === payload.channel.id ? payload.channel : candidate,
          )
          .filter(
            (candidate) =>
              expandedOutputGroup === null ||
              (candidate.customGroup ?? candidate.providerGroup) ===
                expandedOutputGroup,
          ),
      );
      await Promise.all([refreshPermanentWorkspace(source.id)]);
      return payload.channel;
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Could not update channel',
      );
      return null;
    } finally {
      setSavingChannel(null);
    }
  }

  async function saveChannelEdit(
    event: FormEvent,
    source: SafeSource,
    channel: ChannelSummary,
  ) {
    event.preventDefault();
    const sortOrder = Number(channelDraft.sortOrder);
    const updated = await updateChannel(source, channel, {
      customName: channelDraft.customName.trim() || null,
      customGroup: channelDraft.customGroup.trim() || null,
      customLogoUrl: channelDraft.customLogoUrl.trim() || null,
      sortOrder: Number.isInteger(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
    });
    if (updated) setEditingChannel(null);
  }

  async function togglePermanentGroup(
    source: SafeSource,
    providerGroup: string,
  ) {
    if (expandedPermanentGroup === providerGroup) {
      setExpandedPermanentGroup(null);
      setChannels([]);
      setChannelTotal(0);
      setSelectedChannelIds([]);
      setEditingChannel(null);
      return;
    }
    setExpandedPermanentGroup(providerGroup);
    setEditingChannel(null);
    try {
      await loadChannels(source.id, providerGroup);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not load channels for this group',
      );
    }
  }

  async function updatePermanentGroup(
    source: SafeSource,
    group: PermanentGroupSummary,
    update: Record<string, unknown>,
  ) {
    setSavingPermanentGroup(group.providerGroup);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/permanent-groups`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ groupName: group.providerGroup, update }),
        },
      );
      await readJson<{ updatedCount: number }>(response);
      await Promise.all([
        refreshPermanentWorkspace(source.id),
        loadReconciliationReview(source.id),
      ]);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not update permanent group',
      );
    } finally {
      setSavingPermanentGroup(null);
    }
  }

  async function createCustomCategory(event: FormEvent, source: SafeSource) {
    event.preventDefault();
    const name = newCustomCategory.trim();
    if (!name) return;
    setSavingCustomCategory(true);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/custom-categories`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        },
      );
      await readJson<{ category: CustomCategory }>(response);
      setNewCustomCategory('');
      await Promise.all([
        loadCustomCategories(source.id),
        loadOutputGroupCategories(source.id),
      ]);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Could not create category',
      );
    } finally {
      setSavingCustomCategory(false);
    }
  }

  function reordered<T extends { id: string }>(
    values: T[],
    draggedId: string,
    targetId: string,
  ): T[] {
    const from = values.findIndex((value) => value.id === draggedId);
    const to = values.findIndex((value) => value.id === targetId);
    if (from < 0 || to < 0 || from === to) return values;
    const next = [...values];
    const [moved] = next.splice(from, 1);
    if (!moved) return values;
    next.splice(to, 0, moved);
    return next;
  }

  async function saveOutputGroupOrder(
    source: SafeSource,
    draggedGroup: string,
    targetGroup: string,
  ) {
    const rows = [...outputGroupCategories]
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.name.localeCompare(right.name),
      )
      .map((group) => ({ id: group.name, group }));
    const nextRows = reordered(rows, draggedGroup, targetGroup);
    if (nextRows === rows) return;
    const nextGroups = nextRows.map((row, sortOrder) => ({
      ...row.group,
      sortOrder,
    }));
    setOutputGroupCategories(nextGroups);
    setSavingOutputGroupOrder(draggedGroup);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/output-groups/order`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            outputGroups: nextGroups.map((group) => group.name),
          }),
        },
      );
      if (!response.ok) await readJson<never>(response);
      await loadOutputGroupCategories(source.id);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not save output group order',
      );
      await loadOutputGroupCategories(source.id);
    } finally {
      setSavingOutputGroupOrder(null);
    }
  }

  async function toggleOutputGroupChannels(
    source: SafeSource,
    outputGroup: string,
  ) {
    if (expandedOutputGroup === outputGroup) {
      setExpandedOutputGroup(null);
      setOutputGroupChannels([]);
      setOutputGroupChannelTotal(0);
      return;
    }
    setExpandedOutputGroup(outputGroup);
    try {
      await loadOutputGroupChannels(source.id, outputGroup);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not load output group channels',
      );
    }
  }

  async function saveOutputGroupChannelOrder(
    source: SafeSource,
    draggedId: string,
    targetId: string,
  ) {
    if (expandedOutputGroup === null) return;
    const next = reordered(outputGroupChannels, draggedId, targetId);
    if (next === outputGroupChannels) return;
    setOutputGroupChannels(next);
    setSavingChannel(draggedId);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/output-groups/channels/order`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            outputGroup: expandedOutputGroup,
            channelIds: next.map((channel) => channel.id),
          }),
        },
      );
      if (!response.ok) await readJson<never>(response);
      await Promise.all([
        loadOutputGroupChannels(source.id, expandedOutputGroup),
        loadOutputGroupCategories(source.id),
        loadPermanentGroups(source.id),
      ]);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not save output group channel order',
      );
      await loadOutputGroupChannels(source.id, expandedOutputGroup);
    } finally {
      setSavingChannel(null);
    }
  }

  async function saveChannelOrder(
    source: SafeSource,
    draggedId: string,
    targetId: string,
  ) {
    const next = reordered(channels, draggedId, targetId);
    if (next === channels || expandedPermanentGroup === null) return;
    setChannels(next);
    setSavingChannel(draggedId);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/channels/order`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerGroup: expandedPermanentGroup,
            channelIds: next.map((channel) => channel.id),
          }),
        },
      );
      if (!response.ok) await readJson<never>(response);
      await Promise.all([
        loadChannels(source.id, expandedPermanentGroup),
        loadPermanentGroups(source.id),
      ]);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not save channel order',
      );
      await loadChannels(source.id, expandedPermanentGroup);
    } finally {
      setSavingChannel(null);
    }
  }

  async function moveOutputGroup(
    source: SafeSource,
    name: string,
    direction: -1 | 1,
  ) {
    const names = outputGroups.map((group) => group.name);
    const from = names.indexOf(name);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= names.length) return;
    const target = names[to];
    if (target === undefined) return;
    names[to] = name;
    names[from] = target;
    setSavingOutputGroupOrder(name);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/output-groups/order`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ outputGroups: names }),
        },
      );
      if (!response.ok) await readJson<never>(response);
      await loadOutputGroupCategories(source.id);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not save output group order',
      );
    } finally {
      setSavingOutputGroupOrder(null);
    }
  }

  async function moveListedChannel(
    source: SafeSource,
    channelId: string,
    direction: -1 | 1,
  ) {
    if (expandedPermanentGroup === null) return;
    const ids = channels.map((channel) => channel.id);
    const from = ids.indexOf(channelId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const swapped = ids[to];
    if (swapped === undefined) return;
    ids[to] = channelId;
    ids[from] = swapped;
    setSavingChannel(channelId);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/channels/order`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerGroup: expandedPermanentGroup,
            channelIds: ids,
          }),
        },
      );
      if (!response.ok) await readJson<never>(response);
      await Promise.all([
        loadChannels(source.id, expandedPermanentGroup),
        loadPermanentGroups(source.id),
      ]);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not save channel order',
      );
    } finally {
      setSavingChannel(null);
    }
  }

  async function moveOutputGroupChannel(
    source: SafeSource,
    channelId: string,
    direction: -1 | 1,
  ) {
    if (expandedOutputGroup === null) return;
    const ids = outputGroupChannels.map((channel) => channel.id);
    const from = ids.indexOf(channelId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const swapped = ids[to];
    if (swapped === undefined) return;
    ids[to] = channelId;
    ids[from] = swapped;
    setSavingChannel(channelId);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/output-groups/channels/order`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            outputGroup: expandedOutputGroup,
            channelIds: ids,
          }),
        },
      );
      if (!response.ok) await readJson<never>(response);
      await Promise.all([
        loadOutputGroupChannels(source.id, expandedOutputGroup),
        loadOutputGroupCategories(source.id),
        loadPermanentGroups(source.id),
      ]);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not save output group channel order',
      );
    } finally {
      setSavingChannel(null);
    }
  }

  function toggleSection(section: string) {
    setCollapsedSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }

  function toggleOutputSource(sourceId: string) {
    setOutputSourceIds((current) =>
      current.includes(sourceId)
        ? current.length === 1
          ? current
          : current.filter((id) => id !== sourceId)
        : [...current, sourceId],
    );
  }

  function toggleChannelSelection(channelId: string) {
    setSelectedChannelIds((current) =>
      current.includes(channelId)
        ? current.filter((value) => value !== channelId)
        : [...current, channelId],
    );
  }

  function toggleAllVisibleChannels() {
    setSelectedChannelIds((current) =>
      current.length === channels.length
        ? []
        : channels.map((channel) => channel.id),
    );
  }

  async function applyBulkChannelUpdate(
    source: SafeSource,
    update: Record<string, unknown>,
  ) {
    if (selectedChannelIds.length === 0) return;
    setBulkSaving(true);
    try {
      const response = await fetch(`/api/v1/sources/${source.id}/channels`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channelIds: selectedChannelIds, update }),
      });
      const bulkResult = await readJson<{ updatedCount: number }>(response);
      showToast(
        'success',
        `${bulkResult.updatedCount.toLocaleString()} channel${
          bulkResult.updatedCount === 1 ? '' : 's'
        } updated`,
      );
      await Promise.all([
        refreshPermanentWorkspace(source.id),
        loadReconciliationReview(source.id),
      ]);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Bulk update failed',
      );
    } finally {
      setBulkSaving(false);
    }
  }

  async function applyBulkGroup(event: FormEvent, source: SafeSource) {
    event.preventDefault();
    if (!bulkGroup.trim()) return;
    await applyBulkChannelUpdate(source, { customGroup: bulkGroup.trim() });
  }

  async function resolveChannelMatch(
    source: SafeSource,
    channel: ChannelSummary,
  ) {
    const upstreamItemId = reviewMatches[channel.id];
    if (!upstreamItemId) return;
    setResolvingChannel(channel.id);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/channels/${channel.id}/resolve`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ upstreamItemId }),
        },
      );
      await readJson<{ channel: ChannelSummary }>(response);
      await Promise.all([
        refreshPermanentWorkspace(source.id),
        loadReconciliationReview(source.id),
        loadSourceHistory(source.id),
      ]);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Manual match failed',
      );
    } finally {
      setResolvingChannel(null);
    }
  }

  async function unlockChannelMatch(
    source: SafeSource,
    channel: ChannelSummary,
  ) {
    setSavingChannel(channel.id);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/channels/${channel.id}/unlock-match`,
        { method: 'POST' },
      );
      const payload = await readJson<{ channel: ChannelSummary }>(response);
      setChannels((current) =>
        current.map((candidate) =>
          candidate.id === channel.id ? payload.channel : candidate,
        ),
      );
      await loadSourceHistory(source.id);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Could not unlock match',
      );
    } finally {
      setSavingChannel(null);
    }
  }

  async function restoreSnapshot(source: SafeSource, snapshotId: string) {
    setRestoringSnapshot(snapshotId);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/snapshots/${snapshotId}/activate`,
        { method: 'POST' },
      );
      await readJson<{ snapshot: SnapshotHistoryItem }>(response);
      showToast('success', 'Snapshot restored');
      await Promise.all([
        loadGroups(source.id),
        refreshPermanentWorkspace(source.id),
        loadReconciliationReview(source.id),
        loadSourceHistory(source.id),
      ]);
      setConfirmingSnapshot(null);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Could not restore snapshot',
      );
    } finally {
      setRestoringSnapshot(null);
    }
  }

  async function createOutputProfile() {
    if (outputSourceIds.length === 0) return;
    setCreatingOutput(true);
    try {
      const response = await fetch('/api/v1/output-profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceIds: outputSourceIds,
          name: outputName.trim() || 'TiviMate',
        }),
      });
      await readJson<{ profile: CreatedOutputProfile }>(response);
      showToast('success', 'TiviMate URL created');
      await loadOutputProfiles();
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not create output URL',
      );
    } finally {
      setCreatingOutput(false);
    }
  }

  async function revokeOutputProfile(profileId: string) {
    setCreatingOutput(true);
    try {
      const response = await fetch(`/api/v1/output-profiles/${profileId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        await readJson<unknown>(response);
      }
      showToast('success', 'Output URL revoked');
      await loadOutputProfiles();
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not revoke output URL',
      );
    } finally {
      setCreatingOutput(false);
    }
  }

  const normalizedFilter = groupFilter.trim().toLocaleLowerCase();
  const matchingGroups = groups.filter(
    (group) =>
      (eventGroupView === 'events' ? group.behavior === 'event' : true) &&
      (normalizedFilter
        ? group.providerGroup.toLocaleLowerCase().includes(normalizedFilter)
        : true),
  );
  const visibleGroups = matchingGroups.slice(0, 50);
  const eventGroupCount = groups.filter(
    (group) => group.behavior === 'event',
  ).length;
  const primarySource =
    sources.find((source) => source.id === selectedSourceId) ?? sources[0];
  const normalizedPermanentGroupFilter = permanentGroupFilter
    .trim()
    .toLocaleLowerCase();
  const visiblePermanentGroups = permanentGroups.filter((group) => {
    const groupMatches = normalizedPermanentGroupFilter
      ? [group.providerGroup, group.outputGroupName ?? '']
          .join(' ')
          .toLocaleLowerCase()
          .includes(normalizedPermanentGroupFilter)
      : true;
    const visibilityMatches =
      showHiddenPermanentGroups || group.enabledCount > 0;
    return groupMatches && visibilityMatches;
  });
  const permanentChannelCount = permanentGroups.reduce(
    (total, group) => total + group.channelCount,
    0,
  );
  const normalizedOutputGroupFilter = outputGroupFilter
    .trim()
    .toLocaleLowerCase();
  const outputGroups = [...outputGroupCategories].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
  );
  const visibleOutputGroups = outputGroups.filter((group) => {
    const groupMatches = normalizedOutputGroupFilter
      ? group.name.toLocaleLowerCase().includes(normalizedOutputGroupFilter)
      : true;
    const visibilityMatches =
      showHiddenPermanentGroups || group.visibleEntryCount > 0;
    return groupMatches && visibilityMatches;
  });
  const activeEventReview = eventReview?.groups.find(
    (group) => group.groupName === selectedEventGroup,
  );
  const editedEventGroup = groups.find(
    (group) => group.providerGroup === editingEventGroup,
  );

  return (
    <section
      className={`panel source-panel source-workspace source-workspace-${workspace}`}
      id="source-setup"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">PRIVATE SOURCE</p>
          <h2>Provider connection</h2>
        </div>
        <span
          className={`pill ${capabilities?.sourcePersistence ? 'ready' : ''}`}
        >
          {capabilities === null
            ? 'Checking…'
            : capabilities.sourcePersistence
              ? 'Encrypted storage ready'
              : 'Preview mode'}
        </span>
      </div>

      {capabilities && !capabilities.sourcePersistence ? (
        <p className="panel-copy">
          Start the Docker Compose stack with a database and master key to
          enable encrypted provider setup. Event-time preview remains available
          below.
        </p>
      ) : null}

      {capabilities?.sourcePersistence &&
      (sources.length === 0 || showSourceForm || editingConnection !== null) ? (
        <form className="source-form" onSubmit={saveSource}>
          <div>
            <label htmlFor="source-name">Source name</label>
            <input
              id="source-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="playlist-url">
              M3U playlist URL{editingConnection ? ' (optional)' : ''}
            </label>
            <input
              id="playlist-url"
              type="password"
              value={playlistUrl}
              onChange={(event) => setPlaylistUrl(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={
                editingConnection
                  ? 'Leave blank to keep the saved playlist URL'
                  : undefined
              }
              required={!editingConnection}
            />
          </div>
          <div>
            <label htmlFor="epg-url">XMLTV URL (optional)</label>
            <input
              id="epg-url"
              type="password"
              value={epgUrl}
              onChange={(event) => setEpgUrl(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={
                editingConnection
                  ? 'Leave blank to keep the saved XMLTV URL'
                  : undefined
              }
            />
          </div>
          <button type="submit" disabled={saving}>
            {saving
              ? 'Saving securely…'
              : editingConnection
                ? 'Save connection'
                : 'Save encrypted source'}
          </button>
          {editingConnection ? (
            <button
              className="secondary-button"
              type="button"
              disabled={saving}
              onClick={() =>
                void updateSourceConnection(editingConnection, {
                  deriveEpgUrl: true,
                })
              }
            >
              Use matching XMLTV URL
            </button>
          ) : null}
          {editingConnection?.hasEpgUrl ? (
            <button
              className="danger-button"
              type="button"
              disabled={saving}
              onClick={() =>
                void updateSourceConnection(editingConnection, {
                  clearEpgUrl: true,
                })
              }
            >
              Remove XMLTV URL
            </button>
          ) : null}
          {sources.length > 0 ? (
            <button
              className="secondary-button"
              type="button"
              disabled={saving}
              onClick={clearSourceForm}
            >
              Cancel
            </button>
          ) : null}
          <p className="secret-note">
            {editingConnection
              ? 'URL fields are intentionally blank. Enter only values you want to replace; saved URLs remain encrypted and are never shown again.'
              : 'URLs are encrypted before database storage and never shown again.'}
          </p>
        </form>
      ) : null}

      {sources.length > 0 ? (
        <div className="saved-source-list">
          {sources.map((source) => (
            <article
              className={`saved-source ${
                source.id === primarySource?.id ? 'selected' : ''
              }`}
              key={source.id}
            >
              <div className="source-symbol">
                <IconTv />
              </div>
              <div>
                <strong>{source.name}</strong>
                <p>
                  {source.sourceType.toUpperCase()} ·{' '}
                  {source.hasEpgUrl ? 'XMLTV configured' : 'No XMLTV URL'}
                </p>
                <small>
                  {source.sourceTimezone} → {source.displayTimezone}
                </small>
                {capabilities?.playlistAutomation ? (
                  <small className="automation-note">
                    Automatic playlist
                    {source.hasEpgUrl && capabilities.epgAutomation
                      ? ' and EPG refresh enabled'
                      : ' refresh enabled'}
                  </small>
                ) : null}
              </div>
              <div className="source-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving || removingSourceId !== null}
                  onClick={() => void beginConnectionEdit(source)}
                >
                  Manage connection
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={inspectingId !== null || importingEpgId !== null}
                  onClick={() =>
                    void (async () => {
                      await selectSource(source);
                      await inspectSource(source);
                    })()
                  }
                >
                  {inspectingId === source.id
                    ? 'Importing…'
                    : 'Import live playlist'}
                </button>
                {source.hasEpgUrl ? (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={inspectingId !== null || importingEpgId !== null}
                    onClick={() =>
                      void (async () => {
                        await selectSource(source);
                        await importEpg(source);
                      })()
                    }
                  >
                    {importingEpgId === source.id
                      ? 'Importing guide…'
                      : 'Import XMLTV guide'}
                  </button>
                ) : null}
                <button
                  className="danger-button compact"
                  type="button"
                  disabled={
                    saving ||
                    removingSourceId !== null ||
                    inspectingId !== null ||
                    importingEpgId !== null
                  }
                  onClick={() =>
                    setConfirmingRemoval((current) =>
                      current === source.id ? null : source.id,
                    )
                  }
                >
                  {removingSourceId === source.id
                    ? 'Removing…'
                    : 'Remove provider'}
                </button>
              </div>
              {confirmingRemoval === source.id ? (
                <div className="snapshot-confirm source-remove-confirm">
                  <p>
                    Remove {source.name}? This permanently deletes its imported
                    playlists, guide data, and edits, and revokes any output
                    URLs that include it.
                  </p>
                  <div>
                    <button
                      className="danger-button compact"
                      type="button"
                      disabled={removingSourceId !== null}
                      onClick={() => void removeSource(source)}
                    >
                      Remove permanently
                    </button>
                    <button
                      className="secondary-button compact"
                      type="button"
                      disabled={removingSourceId !== null}
                      onClick={() => setConfirmingRemoval(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {capabilities?.sourcePersistence &&
      sources.length > 0 &&
      !showSourceForm &&
      editingConnection === null ? (
        <button
          className="secondary-button add-provider-button"
          type="button"
          onClick={() => {
            clearSourceForm();
            setShowSourceForm(true);
          }}
        >
          Add another provider
        </button>
      ) : null}

      {importSummary ? (
        <div className="import-summary" aria-live="polite">
          <div>
            <small>LIVE ENTRIES</small>
            <strong>
              {importSummary.retainedLiveEntries.toLocaleString()}
            </strong>
          </div>
          <div>
            <small>VOD/SERIES SKIPPED</small>
            <strong>{importSummary.skippedEntries.toLocaleString()}</strong>
          </div>
          <div>
            <small>DOWNLOAD SIZE</small>
            <strong>
              {(importSummary.totalBytes / 1_000_000).toFixed(1)} MB
            </strong>
          </div>
          <div>
            <small>PARSE ISSUES</small>
            <strong>{importSummary.issues.toLocaleString()}</strong>
          </div>
        </div>
      ) : null}

      {epgImportSummary ? (
        <div className="import-summary" aria-live="polite">
          <div>
            <small>EPG CHANNELS</small>
            <strong>{epgImportSummary.channelCount.toLocaleString()}</strong>
          </div>
          <div>
            <small>PROGRAMMES</small>
            <strong>{epgImportSummary.programmeCount.toLocaleString()}</strong>
          </div>
          <div>
            <small>DOWNLOAD SIZE</small>
            <strong>
              {(epgImportSummary.totalBytes / 1_000_000).toFixed(1)} MB
            </strong>
          </div>
          <div>
            <small>PARSE ISSUES</small>
            <strong>
              {epgImportSummary.issueCount.toLocaleString()}
              {epgImportSummary.issuesTruncated ? '+' : ''}
            </strong>
          </div>
        </div>
      ) : null}

      {workspace !== 'overview' && sources.length > 0 ? (
        <div className="workspace-toolbar">
          <div>
            <small>EDITING PROVIDER</small>
            <strong>{primarySource?.name}</strong>
          </div>
          {sources.length > 1 ? (
            <label>
              Provider
              <select
                value={primarySource?.id ?? ''}
                onChange={(event) => {
                  const nextSource = sources.find(
                    (source) => source.id === event.target.value,
                  );
                  if (nextSource) void selectSource(nextSource);
                }}
              >
                {sources.map((source) => (
                  <option value={source.id} key={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <span className="workspace-provider-status">
            <span className="status-dot" />{' '}
            {primarySource?.enabled && capabilities?.playlistAutomation
              ? 'Automatic refresh enabled'
              : 'Provider selected'}
          </span>
        </div>
      ) : null}

      {workspace === 'updates' &&
      sourceHistory &&
      primarySource &&
      sourceHistory.snapshots.length > 0 ? (
        <section className="history-panel" id="updates">
          <div className="subsection-heading history-heading">
            <div>
              <small>UPDATE HISTORY</small>
              <strong>Retained snapshots and activity</strong>
            </div>
            <span className="channel-count">
              {sourceHistory.snapshots.length} shown
            </span>
            <button
              className="secondary-button compact section-toggle"
              type="button"
              onClick={() => toggleSection('history')}
            >
              {collapsedSections.history ? 'Expand' : 'Collapse'}
            </button>
          </div>
          <div hidden={collapsedSections.history}>
            <p className="secret-note">
              Restore a previously accepted playlist if a provider update is
              wrong. Channel overrides remain yours; uncertain matches return to
              the review queue. A later provider refresh can reactivate newer
              retained data.
            </p>
            <div className="history-grid">
              <div className="snapshot-list" aria-label="Retained snapshots">
                {sourceHistory.snapshots.length > 6 ? (
                  <small className="channel-limit-note">
                    Showing the 6 most recent of{' '}
                    {sourceHistory.snapshots.length.toLocaleString()} retained
                    snapshots.
                  </small>
                ) : null}
                {sourceHistory.snapshots.slice(0, 6).map((snapshot) => (
                  <article
                    className={`snapshot-row ${snapshot.isCurrent ? 'current' : ''}`}
                    key={snapshot.id}
                  >
                    <div className="snapshot-main">
                      <strong>{formatHistoryTime(snapshot.importedAt)}</strong>
                      <small>
                        {snapshot.liveCount.toLocaleString()} live ·{' '}
                        {snapshot.issueCount.toLocaleString()} issues ·{' '}
                        {snapshot.fingerprint.slice(0, 8)}
                      </small>
                    </div>
                    {snapshot.isCurrent ? (
                      <span className="snapshot-current">CURRENT</span>
                    ) : (
                      <button
                        className="secondary-button compact"
                        type="button"
                        disabled={restoringSnapshot !== null}
                        onClick={() => setConfirmingSnapshot(snapshot.id)}
                      >
                        Restore
                      </button>
                    )}
                    {confirmingSnapshot === snapshot.id ? (
                      <div className="snapshot-confirm">
                        <p>
                          Publish this retained playlist now and reconcile the
                          permanent channels against it?
                        </p>
                        <div>
                          <button
                            className="danger-button compact"
                            type="button"
                            disabled={restoringSnapshot !== null}
                            onClick={() =>
                              void restoreSnapshot(primarySource, snapshot.id)
                            }
                          >
                            {restoringSnapshot === snapshot.id
                              ? 'Restoring…'
                              : 'Confirm restore'}
                          </button>
                          <button
                            className="secondary-button compact"
                            type="button"
                            disabled={restoringSnapshot !== null}
                            onClick={() => setConfirmingSnapshot(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
              <div
                className="activity-list"
                aria-label="Recent source activity"
              >
                {sourceHistory.activity.length > 0 ? (
                  sourceHistory.activity.slice(0, 10).map((activity) => (
                    <article className="activity-row" key={activity.id}>
                      <span
                        className={`activity-status ${activity.status ?? 'succeeded'}`}
                      />
                      <div>
                        <strong>{activity.title}</strong>
                        <p>{activity.detail}</p>
                        <small>{formatHistoryTime(activity.occurredAt)}</small>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="review-clear">No activity has been recorded.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {workspace === 'updates' &&
      primarySource &&
      (!sourceHistory || sourceHistory.snapshots.length === 0) ? (
        <div className="workspace-empty">
          <strong>No retained updates yet</strong>
          <p>
            Playlist and EPG refresh activity will appear here after the next
            successful import.
          </p>
        </div>
      ) : null}

      {workspace !== 'updates' && groups.length > 0 && primarySource ? (
        <div className="group-policy-editor">
          <div className="subsection-heading" hidden={workspace !== 'events'}>
            <div>
              <small>GROUP RULES</small>
              <strong>Choose transient live-event groups</strong>
            </div>
            <div className="section-heading-controls">
              <div className="epg-chips group-view-chips">
                <button
                  type="button"
                  className={`epg-chip ${eventGroupView === 'events' ? 'active' : ''}`}
                  onClick={() => setEventGroupView('events')}
                >
                  Event groups ({eventGroupCount})
                </button>
                <button
                  type="button"
                  className={`epg-chip ${eventGroupView === 'all' ? 'active' : ''}`}
                  onClick={() => setEventGroupView('all')}
                >
                  All groups ({groups.length})
                </button>
              </div>
              <input
                aria-label="Filter provider groups"
                placeholder="Search groups"
                value={groupFilter}
                onChange={(event) => setGroupFilter(event.target.value)}
              />
              <button
                className="secondary-button compact section-toggle"
                type="button"
                onClick={() => toggleSection('group-rules')}
              >
                {collapsedSections['group-rules'] ? 'Expand' : 'Collapse'}
              </button>
            </div>
          </div>
          <div
            hidden={workspace !== 'events' || collapsedSections['group-rules']}
          >
            <p className="secret-note">
              Event groups receive source-to-display time conversion and
              placeholder filtering. Switch to “All groups” to find a provider
              group and mark it as an event.
            </p>
            <div className="group-list">
              {visibleGroups.map((group) => (
                <div className="group-row" key={group.providerGroup}>
                  <div>
                    <strong>{group.providerGroup || '(Ungrouped)'}</strong>
                    <small>
                      {group.channelCount.toLocaleString()} live entries
                    </small>
                  </div>
                  <span className={`behavior-badge ${group.behavior}`}>
                    {group.behavior === 'event' ? 'LIVE EVENT' : 'LIVE TV'}
                  </span>
                  {group.behavior === 'event' ? (
                    <button
                      className="secondary-button compact"
                      type="button"
                      disabled={savingGroup !== null}
                      onClick={() => beginEventRuleEdit(group)}
                    >
                      Edit rule
                    </button>
                  ) : (
                    <span className="group-action-spacer" />
                  )}
                  <button
                    className="secondary-button compact"
                    type="button"
                    disabled={savingGroup !== null}
                    onClick={() =>
                      void setGroupBehavior(
                        primarySource,
                        group,
                        group.behavior === 'event' ? 'permanent' : 'event',
                      )
                    }
                  >
                    {savingGroup === group.providerGroup
                      ? 'Saving…'
                      : group.behavior === 'event'
                        ? 'Treat as TV'
                        : 'Mark as event'}
                  </button>
                </div>
              ))}
              {visibleGroups.length === 0 ? (
                <p className="empty-groups">No groups match this filter.</p>
              ) : null}
            </div>
            {matchingGroups.length > visibleGroups.length ? (
              <small className="channel-limit-note">
                Showing {visibleGroups.length.toLocaleString()} of{' '}
                {matchingGroups.length.toLocaleString()} groups. Narrow the
                search to see the rest.
              </small>
            ) : null}

            {editedEventGroup && eventRuleDraft ? (
              <form
                className="event-rule-form"
                onSubmit={(event) =>
                  void saveEventRule(event, primarySource, editedEventGroup)
                }
              >
                <div className="event-rule-heading">
                  <div>
                    <small>EVENT GROUP RULE</small>
                    <strong>{editedEventGroup.providerGroup}</strong>
                  </div>
                  <button
                    className="secondary-button compact"
                    type="button"
                    disabled={savingGroup !== null}
                    onClick={() => {
                      setEditingEventGroup(null);
                      setEventRuleDraft(null);
                    }}
                  >
                    Close
                  </button>
                </div>
                <label className="event-check">
                  <input
                    type="checkbox"
                    checked={eventRuleDraft.enabled}
                    onChange={(event) =>
                      setEventRuleDraft((current) =>
                        current
                          ? { ...current, enabled: event.target.checked }
                          : current,
                      )
                    }
                  />
                  Publish this event group
                </label>
                <label className="event-check">
                  <input
                    type="checkbox"
                    checked={eventRuleDraft.hidePlaceholders}
                    onChange={(event) =>
                      setEventRuleDraft((current) =>
                        current
                          ? {
                              ...current,
                              hidePlaceholders: event.target.checked,
                            }
                          : current,
                      )
                    }
                  />
                  Hide matching placeholders
                </label>
                <label>
                  Output group
                  <input
                    value={eventRuleDraft.outputGroupName}
                    placeholder="Keep provider group"
                    onChange={(event) =>
                      setEventRuleDraft((current) =>
                        current
                          ? {
                              ...current,
                              outputGroupName: event.target.value,
                            }
                          : current,
                      )
                    }
                  />
                </label>
                <label>
                  Provider timezone
                  <input
                    list="timezone-choices"
                    value={eventRuleDraft.sourceTimeZone}
                    onChange={(event) =>
                      setEventRuleDraft((current) =>
                        current
                          ? { ...current, sourceTimeZone: event.target.value }
                          : current,
                      )
                    }
                    required
                  />
                </label>
                <label>
                  Display timezone
                  <input
                    list="timezone-choices"
                    value={eventRuleDraft.displayTimeZone}
                    onChange={(event) =>
                      setEventRuleDraft((current) =>
                        current
                          ? {
                              ...current,
                              displayTimeZone: event.target.value,
                            }
                          : current,
                      )
                    }
                    required
                  />
                </label>
                <label>
                  Numeric date order
                  <select
                    value={eventRuleDraft.numericDateOrder}
                    onChange={(event) =>
                      setEventRuleDraft((current) =>
                        current
                          ? {
                              ...current,
                              numericDateOrder: event.target.value as
                                'month-day' | 'day-month',
                            }
                          : current,
                      )
                    }
                  >
                    <option value="month-day">Month / day</option>
                    <option value="day-month">Day / month</option>
                  </select>
                </label>
                <label className="placeholder-patterns">
                  Placeholder patterns, one per line
                  <textarea
                    rows={5}
                    value={eventRuleDraft.placeholderPatterns}
                    placeholder={
                      'reload your playlist\nlive during events only'
                    }
                    onChange={(event) =>
                      setEventRuleDraft((current) =>
                        current
                          ? {
                              ...current,
                              placeholderPatterns: event.target.value,
                            }
                          : current,
                      )
                    }
                  />
                </label>
                <button type="submit" disabled={savingGroup !== null}>
                  {savingGroup === editedEventGroup.providerGroup
                    ? 'Saving rule...'
                    : 'Save event rule'}
                </button>
                <datalist id="timezone-choices">
                  {TIMEZONE_CHOICES.map((zone) => (
                    <option value={zone} key={zone} />
                  ))}
                </datalist>
              </form>
            ) : null}
          </div>

          {workspace === 'events' &&
          eventReview &&
          eventReview.groups.length > 0 ? (
            <section className="event-review" id="events">
              <div className="subsection-heading event-review-heading">
                <div>
                  <small>LIVE EVENT REVIEW</small>
                  <strong>Provider and Finnish labels</strong>
                </div>
                <div className="section-heading-controls">
                  <select
                    aria-label="Review event group"
                    value={selectedEventGroup}
                    onChange={(event) =>
                      setSelectedEventGroup(event.target.value)
                    }
                  >
                    {eventReview.groups.map((group) => (
                      <option value={group.groupName} key={group.groupName}>
                        {group.groupName}
                      </option>
                    ))}
                  </select>
                  <button
                    className="secondary-button compact section-toggle"
                    type="button"
                    onClick={() => toggleSection('events')}
                  >
                    {collapsedSections.events ? 'Expand' : 'Collapse'}
                  </button>
                </div>
              </div>
              <div hidden={collapsedSections.events}>
                <p className="secret-note">
                  Events are ordered by their calculated Finnish start time.
                  Unparseable labels remain usable and are flagged instead of
                  being renamed. Reference date: {eventReview.referenceDate}.
                </p>
                {activeEventReview ? (
                  <>
                    <div className="event-review-summary">
                      <span>{activeEventReview.totalEntries} entries</span>
                      <span>{activeEventReview.localizedEntries} parsed</span>
                      <span>{activeEventReview.hiddenEntries} hidden</span>
                      <span>{activeEventReview.warningEntries} warnings</span>
                    </div>
                    <div className="event-entry-list">
                      {activeEventReview.entries.map((entry) => (
                        <article
                          className={`event-entry ${entry.hidden ? 'hidden' : ''}`}
                          key={entry.id}
                        >
                          <div className="event-name-pair">
                            <div>
                              <small>PROVIDER</small>
                              <strong>{entry.originalName}</strong>
                            </div>
                            <span>→</span>
                            <div>
                              <small>TIVIMATE</small>
                              <strong>{entry.localizedName}</strong>
                            </div>
                          </div>
                          <div className="event-entry-meta">
                            <span className={`event-status ${entry.status}`}>
                              {entry.hidden ? 'hidden' : entry.status}
                            </span>
                            <small>
                              {formatEventTime(
                                entry.sourceDateTime,
                                activeEventReview.timePolicy?.sourceTimeZone ??
                                  'Europe/Stockholm',
                              )}{' '}
                              →{' '}
                              {formatEventTime(
                                entry.displayDateTime,
                                activeEventReview.timePolicy?.displayTimeZone ??
                                  'Europe/Helsinki',
                              )}
                            </small>
                          </div>
                          {entry.hideReason || entry.warning ? (
                            <p className="event-warning">
                              {entry.hideReason ?? entry.warning}
                            </p>
                          ) : null}
                        </article>
                      ))}
                    </div>
                    {eventReview.truncated ? (
                      <small className="channel-limit-note">
                        Review is limited to 200 entries per event group.
                      </small>
                    ) : null}
                  </>
                ) : null}
              </div>
            </section>
          ) : null}

          <EpgWorkspace
            source={primarySource}
            active={workspace === 'epg'}
            onActivityChanged={() => {
              if (primarySource) void loadSourceHistory(primarySource.id);
            }}
          />

          <div
            className={`channel-editor channel-editor-${lineupView}`}
            id="channels"
            hidden={workspace !== 'lineup'}
          >
            <section className="output-group-order" aria-live="polite">
              <div className="subsection-heading output-group-order-heading">
                <div>
                  <small>PLAYLIST ORDER</small>
                  <strong>TiviMate groups</strong>
                </div>
                <span className="channel-count">
                  {outputGroups.length.toLocaleString()}{' '}
                  {outputGroups.length === 1 ? 'group' : 'groups'}
                </span>
                <button
                  className="secondary-button compact section-toggle"
                  type="button"
                  onClick={() => toggleSection('output-group-order')}
                >
                  {collapsedSections['output-group-order']
                    ? 'Expand'
                    : 'Collapse'}
                </button>
              </div>
              <div
                className="output-group-order-body"
                hidden={collapsedSections['output-group-order']}
              >
                <p className="secret-note">
                  Drag groups into their final TiviMate order. TV, live-event,
                  and custom groups all share this list.
                </p>
                <div className="channel-search output-group-search">
                  <input
                    aria-label="Filter output groups"
                    placeholder="Filter TV, event, or custom groups"
                    value={outputGroupFilter}
                    onChange={(event) =>
                      setOutputGroupFilter(event.target.value)
                    }
                  />
                  <label className="hidden-group-toggle">
                    <input
                      type="checkbox"
                      checked={showHiddenPermanentGroups}
                      onChange={(event) =>
                        setShowHiddenPermanentGroups(event.target.checked)
                      }
                    />
                    Show hidden groups
                  </label>
                  <small>
                    {visibleOutputGroups.length.toLocaleString()} shown
                  </small>
                </div>
                <div className="output-group-order-list">
                  {visibleOutputGroups.map((group, index) => {
                    const isSaving = savingOutputGroupOrder === group.name;
                    const isExpanded = expandedOutputGroup === group.name;
                    const canEditChannels =
                      group.behavior !== 'event' && group.entryCount > 0;
                    return (
                      <article
                        className={`output-group-order-row ${group.behavior} ${
                          dropTarget === group.name && draggedOutputGroup
                            ? 'drop-target'
                            : ''
                        }`}
                        key={group.name}
                        draggable={
                          !normalizedOutputGroupFilter &&
                          savingOutputGroupOrder === null
                        }
                        onDragStart={(event: DragEvent<HTMLElement>) => {
                          setDraggedOutputGroup(group.name);
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => {
                          setDraggedOutputGroup(null);
                          setDropTarget(null);
                        }}
                        onDragOver={(event: DragEvent<HTMLElement>) => {
                          if (draggedOutputGroup) {
                            event.preventDefault();
                            setDropTarget(group.name);
                          }
                        }}
                        onDrop={(event: DragEvent<HTMLElement>) => {
                          event.preventDefault();
                          const draggedGroup = draggedOutputGroup;
                          setDraggedOutputGroup(null);
                          setDropTarget(null);
                          if (draggedGroup) {
                            void saveOutputGroupOrder(
                              primarySource,
                              draggedGroup,
                              group.name,
                            );
                          }
                        }}
                      >
                        <span className="row-order-controls">
                          <span
                            className="drag-handle"
                            aria-hidden="true"
                            title={
                              normalizedOutputGroupFilter
                                ? 'Clear the filter to drag; the arrows still work'
                                : 'Drag to reorder'
                            }
                          >
                            <IconGrip />
                          </span>
                          <button
                            className="order-arrow"
                            type="button"
                            aria-label={`Move ${group.name || 'group'} up`}
                            disabled={
                              savingOutputGroupOrder !== null || index === 0
                            }
                            onClick={() =>
                              void moveOutputGroup(
                                primarySource,
                                group.name,
                                -1,
                              )
                            }
                          >
                            <IconChevronUp />
                          </button>
                          <button
                            className="order-arrow"
                            type="button"
                            aria-label={`Move ${group.name || 'group'} down`}
                            disabled={
                              savingOutputGroupOrder !== null ||
                              index === visibleOutputGroups.length - 1
                            }
                            onClick={() =>
                              void moveOutputGroup(primarySource, group.name, 1)
                            }
                          >
                            <IconChevronDown />
                          </button>
                        </span>
                        <div>
                          <strong>{group.name || '(Ungrouped)'}</strong>
                          <small>
                            {group.entryCount.toLocaleString()} live entries
                            {group.visibleEntryCount < group.entryCount
                              ? ` · ${group.visibleEntryCount.toLocaleString()} shown`
                              : ''}
                          </small>
                        </div>
                        <span className={`behavior-badge ${group.behavior}`}>
                          {group.behavior === 'event'
                            ? 'Live event'
                            : group.behavior === 'mixed'
                              ? 'TV + events'
                              : 'TV'}
                        </span>
                        <button
                          className="secondary-button compact output-group-channels-button"
                          type="button"
                          disabled={
                            !canEditChannels || loadingOutputGroupChannels
                          }
                          onClick={() =>
                            void toggleOutputGroupChannels(
                              primarySource,
                              group.name,
                            )
                          }
                        >
                          {isExpanded ? 'Close' : 'Channels'}
                        </button>
                        <span className="output-group-position">
                          {isSaving ? 'Saving…' : index + 1}
                        </span>
                        {isExpanded ? (
                          <div className="output-group-channel-list">
                            <small className="output-group-channel-note">
                              Drag the grip beside a channel to set its order
                              inside {group.name}.
                            </small>
                            {outputGroupChannels.map(
                              (channel, channelIndex) => (
                                <div
                                  className={`output-group-channel-row ${
                                    channel.enabled ? '' : 'disabled'
                                  } ${
                                    dropTarget === channel.id &&
                                    draggedOutputGroupChannelId
                                      ? 'drop-target'
                                      : ''
                                  }`}
                                  key={channel.id}
                                  draggable={savingChannel === null}
                                  onDragStart={(
                                    event: DragEvent<HTMLElement>,
                                  ) => {
                                    event.stopPropagation();
                                    setDraggedOutputGroupChannelId(channel.id);
                                    event.dataTransfer.effectAllowed = 'move';
                                  }}
                                  onDragEnd={(
                                    event: DragEvent<HTMLElement>,
                                  ) => {
                                    event.stopPropagation();
                                    setDraggedOutputGroupChannelId(null);
                                  }}
                                  onDragOver={(
                                    event: DragEvent<HTMLElement>,
                                  ) => {
                                    if (draggedOutputGroupChannelId) {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setDropTarget(channel.id);
                                    }
                                  }}
                                  onDrop={(event: DragEvent<HTMLElement>) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const draggedId =
                                      draggedOutputGroupChannelId;
                                    setDraggedOutputGroupChannelId(null);
                                    if (draggedId) {
                                      void saveOutputGroupChannelOrder(
                                        primarySource,
                                        draggedId,
                                        channel.id,
                                      );
                                    }
                                  }}
                                >
                                  <span className="row-order-controls">
                                    <span
                                      className="drag-handle"
                                      aria-hidden="true"
                                      title="Drag to reorder"
                                    >
                                      <IconGrip />
                                    </span>
                                    <button
                                      className="order-arrow"
                                      type="button"
                                      aria-label={`Move ${
                                        channel.customName ??
                                        channel.providerName
                                      } up`}
                                      disabled={
                                        savingChannel !== null ||
                                        channelIndex === 0
                                      }
                                      onClick={() =>
                                        void moveOutputGroupChannel(
                                          primarySource,
                                          channel.id,
                                          -1,
                                        )
                                      }
                                    >
                                      <IconChevronUp />
                                    </button>
                                    <button
                                      className="order-arrow"
                                      type="button"
                                      aria-label={`Move ${
                                        channel.customName ??
                                        channel.providerName
                                      } down`}
                                      disabled={
                                        savingChannel !== null ||
                                        channelIndex ===
                                          outputGroupChannels.length - 1
                                      }
                                      onClick={() =>
                                        void moveOutputGroupChannel(
                                          primarySource,
                                          channel.id,
                                          1,
                                        )
                                      }
                                    >
                                      <IconChevronDown />
                                    </button>
                                  </span>
                                  <span className="output-group-channel-position">
                                    {channelIndex + 1}
                                  </span>
                                  <ChannelLogo
                                    url={
                                      channel.customLogoUrl ??
                                      channel.providerLogoUrl
                                    }
                                    name={
                                      channel.customName ?? channel.providerName
                                    }
                                  />
                                  <div>
                                    <strong>
                                      {channel.customName ??
                                        channel.providerName}
                                    </strong>
                                    <small>{channel.providerGroup}</small>
                                  </div>
                                  <button
                                    className="secondary-button compact output-group-channel-visibility"
                                    type="button"
                                    aria-label={`${channel.enabled ? 'Hide' : 'Show'} ${
                                      channel.customName ?? channel.providerName
                                    }`}
                                    disabled={savingChannel !== null}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void updateChannel(
                                        primarySource,
                                        channel,
                                        {
                                          enabled: !channel.enabled,
                                        },
                                      );
                                    }}
                                  >
                                    {savingChannel === channel.id
                                      ? 'Saving…'
                                      : channel.enabled
                                        ? 'Hide'
                                        : 'Show'}
                                  </button>
                                </div>
                              ),
                            )}
                            {!loadingOutputGroupChannels &&
                            outputGroupChannelTotal === 0 ? (
                              <p className="empty-groups">
                                This output group currently contains only live
                                events.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                  {visibleOutputGroups.length === 0 ? (
                    <p className="empty-groups">
                      Import a playlist, change the group filter, or show hidden
                      groups.
                    </p>
                  ) : null}
                </div>
              </div>
            </section>

            <div className="subsection-heading channel-heading">
              <div>
                <small>GROUP &amp; CHANNEL EDITOR</small>
                <strong>Edit provider groups</strong>
              </div>
              <span className="channel-count">
                {permanentGroups.length.toLocaleString()}{' '}
                {permanentGroups.length === 1 ? 'group' : 'groups'} ·{' '}
                {permanentChannelCount.toLocaleString()} channels
              </span>
              <button
                className="secondary-button compact section-toggle"
                type="button"
                onClick={() => toggleSection('permanent')}
              >
                {collapsedSections.permanent ? 'Expand' : 'Collapse'}
              </button>
            </div>
            <div hidden={collapsedSections.permanent}>
              <p className="secret-note">
                Choose a provider group to hide it, move all of its channels to
                a custom group, or edit individual channels. Live-event rules
                are managed in their own workspace.
              </p>
              <div className="channel-search">
                <input
                  aria-label="Filter permanent groups"
                  placeholder="Filter provider or output groups"
                  value={permanentGroupFilter}
                  onChange={(event) =>
                    setPermanentGroupFilter(event.target.value)
                  }
                />
                <label className="hidden-group-toggle">
                  <input
                    type="checkbox"
                    checked={showHiddenPermanentGroups}
                    onChange={(event) =>
                      setShowHiddenPermanentGroups(event.target.checked)
                    }
                  />
                  Show hidden groups
                </label>
                <small>
                  {visiblePermanentGroups.length.toLocaleString()} shown
                </small>
              </div>

              <form
                className="custom-category-form"
                onSubmit={(event) =>
                  void createCustomCategory(event, primarySource)
                }
              >
                <label htmlFor="new-custom-category">
                  Custom categories stay available even before a channel is
                  moved.
                </label>
                <input
                  id="new-custom-category"
                  list="custom-category-choices"
                  placeholder="New custom category"
                  value={newCustomCategory}
                  onChange={(event) => setNewCustomCategory(event.target.value)}
                />
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={savingCustomCategory || !newCustomCategory.trim()}
                >
                  {savingCustomCategory ? 'Creating…' : 'Make custom category'}
                </button>
                <datalist id="custom-category-choices">
                  {customCategories.map((category) => (
                    <option value={category.name} key={category.name}>
                      {category.channelCount} channels
                    </option>
                  ))}
                </datalist>
              </form>

              <section
                className="custom-category-directory"
                aria-label="Custom output groups"
              >
                <div className="custom-category-directory-heading">
                  <div>
                    <small>CUSTOM OUTPUT GROUPS</small>
                    <strong>
                      Available in the generated TiviMate playlist
                    </strong>
                  </div>
                  <span>
                    {customCategories.length.toLocaleString()}{' '}
                    {customCategories.length === 1 ? 'group' : 'groups'}
                  </span>
                </div>
                {customCategories.length > 0 ? (
                  <div className="custom-category-list">
                    {customCategories.map((category) => (
                      <button
                        className="custom-category-card"
                        key={category.name}
                        type="button"
                        onClick={() => setPermanentGroupFilter(category.name)}
                        title={`Show provider groups assigned to ${category.name}`}
                      >
                        <strong>{category.name}</strong>
                        <small>
                          {category.channelCount.toLocaleString()}{' '}
                          {category.channelCount === 1 ? 'channel' : 'channels'}
                        </small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="empty-custom-categories">
                    Make a custom category, then move a provider group or
                    individual channels into it.
                  </p>
                )}
              </section>

              <div className="permanent-group-list" aria-live="polite">
                {visiblePermanentGroups.map((group) => {
                  const isExpanded =
                    expandedPermanentGroup === group.providerGroup;
                  const customGroupValue =
                    permanentGroupNames[group.providerGroup] ??
                    (group.outputGroupStatus === 'custom'
                      ? (group.outputGroupName ?? '')
                      : '');
                  const outputLabel =
                    group.outputGroupStatus === 'mixed'
                      ? 'Mixed output groups'
                      : `Output: ${
                          group.outputGroupName ??
                          (group.providerGroup || '(Ungrouped)')
                        }`;
                  const isSaving = savingPermanentGroup === group.providerGroup;
                  return (
                    <article
                      className={`permanent-group ${
                        group.hiddenCount === group.channelCount ? 'hidden' : ''
                      }`}
                      key={group.providerGroup}
                    >
                      <button
                        className="permanent-group-toggle"
                        type="button"
                        aria-expanded={isExpanded}
                        disabled={isSaving}
                        onClick={() =>
                          void togglePermanentGroup(
                            primarySource,
                            group.providerGroup,
                          )
                        }
                      >
                        <span className="permanent-group-title">
                          <strong>
                            {group.providerGroup || '(Ungrouped)'}
                          </strong>
                          <small>
                            {group.enabledCount.toLocaleString()} shown ·{' '}
                            {group.hiddenCount.toLocaleString()} hidden ·{' '}
                            {outputLabel}
                          </small>
                        </span>
                        <span className="permanent-group-expand">
                          {isExpanded ? 'Collapse' : 'Expand'}
                        </span>
                      </button>
                      <div
                        className={`permanent-group-actions ${
                          isExpanded ? '' : 'collapsed'
                        }`}
                      >
                        <label className="permanent-visibility-toggle">
                          <input
                            type="checkbox"
                            checked={group.enabledCount === group.channelCount}
                            disabled={isSaving}
                            onChange={(event) =>
                              void updatePermanentGroup(primarySource, group, {
                                enabled: event.target.checked,
                              })
                            }
                          />
                          {group.enabledCount === group.channelCount
                            ? 'Visible'
                            : 'Hidden'}
                        </label>
                        {!isExpanded ? null : (
                          <form
                            className="permanent-group-name-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              if (!customGroupValue.trim()) return;
                              void updatePermanentGroup(primarySource, group, {
                                customGroup: customGroupValue.trim(),
                              });
                            }}
                          >
                            <input
                              aria-label={`Output group for ${group.providerGroup}`}
                              list="custom-category-choices"
                              placeholder="Move all to output group"
                              value={customGroupValue}
                              onChange={(event) =>
                                setPermanentGroupNames((current) => ({
                                  ...current,
                                  [group.providerGroup]: event.target.value,
                                }))
                              }
                            />
                            <button
                              className="secondary-button compact"
                              type="submit"
                              disabled={isSaving || !customGroupValue.trim()}
                            >
                              Move all
                            </button>
                            <button
                              className="secondary-button compact"
                              type="button"
                              disabled={
                                isSaving ||
                                group.outputGroupStatus === 'provider'
                              }
                              onClick={() => {
                                setPermanentGroupNames((current) => ({
                                  ...current,
                                  [group.providerGroup]: '',
                                }));
                                void updatePermanentGroup(
                                  primarySource,
                                  group,
                                  {
                                    customGroup: null,
                                  },
                                );
                              }}
                            >
                              Reset
                            </button>
                          </form>
                        )}
                      </div>
                    </article>
                  );
                })}
                {!loadingPermanentGroups &&
                visiblePermanentGroups.length === 0 ? (
                  <p className="empty-groups">
                    Import a playlist or change the group filter.
                  </p>
                ) : null}
              </div>
            </div>

            {review &&
            review.ambiguousCount + review.missingCount + review.newCount >
              0 ? (
              <section className="reconciliation-review" aria-live="polite">
                <div className="review-heading">
                  <div>
                    <small>PROVIDER CHANGE REVIEW</small>
                    <strong>Resolve uncertain channel changes</strong>
                  </div>
                  <div className="review-counts">
                    <span>{review.newCount} new</span>
                    <span>{review.missingCount} missing</span>
                    <span>{review.ambiguousCount} ambiguous</span>
                  </div>
                  <button
                    className="secondary-button compact section-toggle"
                    type="button"
                    onClick={() => toggleSection('provider-review')}
                  >
                    {collapsedSections['provider-review']
                      ? 'Expand'
                      : 'Collapse'}
                  </button>
                </div>
                <div hidden={collapsedSections['provider-review']}>
                  <p className="secret-note">
                    Select a current provider entry only when it is the same
                    channel. The match is locked and an untouched duplicate is
                    archived with an audit record.
                  </p>
                  {review.unresolvedChannels.length > 0 ? (
                    <div className="review-list">
                      {review.unresolvedChannels.map((channel) => (
                        <div className="review-row" key={channel.id}>
                          <div className="review-channel">
                            <strong>
                              {channel.customName ?? channel.providerName}
                            </strong>
                            <small>
                              Previous: {channel.providerName} ·{' '}
                              {channel.providerGroup || '(Ungrouped)'}
                            </small>
                          </div>
                          <span
                            className={`reconciliation-badge ${channel.reconciliationStatus}`}
                          >
                            {channel.reconciliationStatus}
                          </span>
                          <select
                            aria-label={`Provider match for ${channel.customName ?? channel.providerName}`}
                            value={reviewMatches[channel.id] ?? ''}
                            onChange={(event) =>
                              setReviewMatches((current) => ({
                                ...current,
                                [channel.id]: event.target.value,
                              }))
                            }
                          >
                            <option value="">
                              Choose current provider entry
                            </option>
                            {review.candidates.map((candidate) => (
                              <option
                                value={candidate.upstreamItemId}
                                key={candidate.upstreamItemId}
                              >
                                {candidate.providerName} —{' '}
                                {candidate.providerGroup || '(Ungrouped)'}
                                {candidate.linkedChannelStatus === 'new'
                                  ? ' [NEW]'
                                  : ''}
                              </option>
                            ))}
                          </select>
                          <button
                            className="secondary-button compact"
                            type="button"
                            disabled={
                              resolvingChannel !== null ||
                              !reviewMatches[channel.id]
                            }
                            onClick={() =>
                              void resolveChannelMatch(primarySource, channel)
                            }
                          >
                            {resolvingChannel === channel.id
                              ? 'Matching…'
                              : 'Match and lock'}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="review-clear">
                      No missing or ambiguous channels need a manual decision.
                    </p>
                  )}
                  {review.truncated ? (
                    <small className="channel-limit-note">
                      Review results are limited to 100 entries. Use channel
                      search to narrow large updates.
                    </small>
                  ) : null}
                </div>
              </section>
            ) : null}

            {!collapsedSections.permanent && expandedPermanentGroup !== null ? (
              <>
                <div className="expanded-permanent-group-heading">
                  <strong>
                    Channels in {expandedPermanentGroup || '(Ungrouped)'}
                  </strong>
                  <small>
                    {channelTotal.toLocaleString()} channel
                    {channelTotal === 1 ? '' : 's'} in this provider group
                  </small>
                </div>
                {channels.length > 0 ? (
                  <div className="bulk-toolbar">
                    <label className="bulk-select-all">
                      <input
                        type="checkbox"
                        checked={
                          channels.length > 0 &&
                          selectedChannelIds.length === channels.length
                        }
                        onChange={toggleAllVisibleChannels}
                      />
                      Select visible
                    </label>
                    <strong>{selectedChannelIds.length} selected</strong>
                    <button
                      className="secondary-button compact"
                      type="button"
                      disabled={bulkSaving || selectedChannelIds.length === 0}
                      onClick={() =>
                        void applyBulkChannelUpdate(primarySource, {
                          enabled: true,
                        })
                      }
                    >
                      Show
                    </button>
                    <button
                      className="secondary-button compact"
                      type="button"
                      disabled={bulkSaving || selectedChannelIds.length === 0}
                      onClick={() =>
                        void applyBulkChannelUpdate(primarySource, {
                          enabled: false,
                        })
                      }
                    >
                      Hide
                    </button>
                    <form
                      className="bulk-group-form"
                      onSubmit={(event) =>
                        void applyBulkGroup(event, primarySource)
                      }
                    >
                      <input
                        aria-label="Bulk output group"
                        list="custom-category-choices"
                        placeholder="Output group"
                        value={bulkGroup}
                        onChange={(event) => setBulkGroup(event.target.value)}
                      />
                      <button
                        className="secondary-button compact"
                        type="submit"
                        disabled={
                          bulkSaving ||
                          selectedChannelIds.length === 0 ||
                          !bulkGroup.trim()
                        }
                      >
                        Set group
                      </button>
                      <button
                        className="secondary-button compact"
                        type="button"
                        disabled={bulkSaving || selectedChannelIds.length === 0}
                        onClick={() =>
                          void applyBulkChannelUpdate(primarySource, {
                            customGroup: null,
                          })
                        }
                      >
                        Reset group
                      </button>
                    </form>
                  </div>
                ) : null}
                <div className="channel-list" aria-live="polite">
                  {channels.map((channel) => (
                    <article
                      className={`channel-row ${channel.enabled ? '' : 'disabled'} ${
                        dropTarget === channel.id && draggedChannelId
                          ? 'drop-target'
                          : ''
                      }`}
                      key={channel.id}
                      draggable={
                        channelTotal === channels.length &&
                        savingChannel === null &&
                        !bulkSaving
                      }
                      onDragStart={(event: DragEvent<HTMLElement>) => {
                        setDraggedChannelId(channel.id);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        setDraggedChannelId(null);
                        setDropTarget(null);
                      }}
                      onDragOver={(event: DragEvent<HTMLElement>) => {
                        if (draggedChannelId) {
                          event.preventDefault();
                          setDropTarget(channel.id);
                        }
                      }}
                      onDrop={(event: DragEvent<HTMLElement>) => {
                        event.preventDefault();
                        const draggedId = draggedChannelId;
                        setDraggedChannelId(null);
                        if (draggedId) {
                          void saveChannelOrder(
                            primarySource,
                            draggedId,
                            channel.id,
                          );
                        }
                      }}
                    >
                      <span className="row-order-controls">
                        <span
                          className="drag-handle channel-drag-handle"
                          aria-hidden="true"
                          title="Drag to reorder"
                        >
                          <IconGrip />
                        </span>
                        <button
                          className="order-arrow"
                          type="button"
                          aria-label={`Move ${
                            channel.customName ?? channel.providerName
                          } up`}
                          disabled={
                            savingChannel !== null ||
                            bulkSaving ||
                            channels[0]?.id === channel.id
                          }
                          onClick={() =>
                            void moveListedChannel(
                              primarySource,
                              channel.id,
                              -1,
                            )
                          }
                        >
                          <IconChevronUp />
                        </button>
                        <button
                          className="order-arrow"
                          type="button"
                          aria-label={`Move ${
                            channel.customName ?? channel.providerName
                          } down`}
                          disabled={
                            savingChannel !== null ||
                            bulkSaving ||
                            channels[channels.length - 1]?.id === channel.id
                          }
                          onClick={() =>
                            void moveListedChannel(primarySource, channel.id, 1)
                          }
                        >
                          <IconChevronDown />
                        </button>
                      </span>
                      <input
                        className="channel-select"
                        type="checkbox"
                        aria-label={`Select ${channel.customName ?? channel.providerName}`}
                        checked={selectedChannelIds.includes(channel.id)}
                        onChange={() => toggleChannelSelection(channel.id)}
                      />
                      <ChannelLogo
                        url={channel.customLogoUrl ?? channel.providerLogoUrl}
                        name={channel.customName ?? channel.providerName}
                      />
                      <div className="channel-summary">
                        <strong>
                          {channel.customName ?? channel.providerName}
                        </strong>
                        <small>
                          {(channel.customGroup ?? channel.providerGroup) ||
                            '(Ungrouped)'}
                          {channel.tvgId ? ` · ${channel.tvgId}` : ''}
                        </small>
                      </div>
                      {channel.reconciliationStatus !== 'matched' ? (
                        <span
                          className={`reconciliation-badge ${channel.reconciliationStatus}`}
                        >
                          {channel.reconciliationStatus}
                        </span>
                      ) : null}
                      <div className="channel-actions">
                        {channel.matchLocked ? (
                          <button
                            className="secondary-button compact"
                            type="button"
                            disabled={savingChannel !== null}
                            onClick={() =>
                              void unlockChannelMatch(primarySource, channel)
                            }
                          >
                            Unlock match
                          </button>
                        ) : null}
                        <button
                          className="secondary-button compact"
                          type="button"
                          disabled={savingChannel !== null}
                          onClick={() =>
                            void updateChannel(primarySource, channel, {
                              enabled: !channel.enabled,
                            })
                          }
                        >
                          {savingChannel === channel.id
                            ? 'Saving…'
                            : channel.enabled
                              ? 'Hide'
                              : 'Show'}
                        </button>
                        <button
                          className="secondary-button compact"
                          type="button"
                          disabled={savingChannel !== null}
                          onClick={() =>
                            editingChannel === channel.id
                              ? setEditingChannel(null)
                              : beginChannelEdit(channel)
                          }
                        >
                          {editingChannel === channel.id ? 'Cancel' : 'Edit'}
                        </button>
                      </div>
                      {editingChannel === channel.id ? (
                        <form
                          className="channel-edit-form"
                          onSubmit={(event) =>
                            void saveChannelEdit(event, primarySource, channel)
                          }
                        >
                          <label>
                            Display name
                            <input
                              value={channelDraft.customName}
                              placeholder={channel.providerName}
                              onChange={(event) =>
                                setChannelDraft((current) => ({
                                  ...current,
                                  customName: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label>
                            Output group
                            <input
                              list="custom-category-choices"
                              value={channelDraft.customGroup}
                              placeholder={
                                channel.providerGroup || '(Ungrouped)'
                              }
                              onChange={(event) =>
                                setChannelDraft((current) => ({
                                  ...current,
                                  customGroup: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label>
                            Logo URL
                            <input
                              type="url"
                              value={channelDraft.customLogoUrl}
                              placeholder={
                                channel.providerLogoUrl ?? 'https://…'
                              }
                              onChange={(event) =>
                                setChannelDraft((current) => ({
                                  ...current,
                                  customLogoUrl: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label>
                            Sort order
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={channelDraft.sortOrder}
                              onChange={(event) =>
                                setChannelDraft((current) => ({
                                  ...current,
                                  sortOrder: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <button
                            type="submit"
                            disabled={savingChannel !== null}
                          >
                            {savingChannel === channel.id
                              ? 'Saving…'
                              : 'Save channel'}
                          </button>
                        </form>
                      ) : null}
                    </article>
                  ))}
                  {!loadingChannels && channels.length === 0 ? (
                    <p className="empty-groups">
                      Import a playlist or change the search to find channels.
                    </p>
                  ) : null}
                </div>
                {channelTotal > channels.length ? (
                  <small className="channel-limit-note">
                    Showing the first {channels.length.toLocaleString()}{' '}
                    channels in this group.
                  </small>
                ) : null}
              </>
            ) : (
              <p className="empty-groups">
                Expand a permanent group to edit its channels.
              </p>
            )}
          </div>

          <div className="output-setup" hidden={workspace !== 'overview'}>
            <div>
              <strong>Combined TiviMate playlist and EPG URLs</strong>
              <small>
                Pick one or more providers. Their channels and guide data are
                combined into one private, revocable URL.
              </small>
              <div hidden={collapsedSections.output}>
                <label className="output-name-field" htmlFor="output-name">
                  Output name
                  <input
                    id="output-name"
                    value={outputName}
                    onChange={(event) => setOutputName(event.target.value)}
                  />
                </label>
                <div className="output-provider-list">
                  {sources.map((source) => (
                    <label key={source.id}>
                      <input
                        type="checkbox"
                        checked={outputSourceIds.includes(source.id)}
                        onChange={() => toggleOutputSource(source.id)}
                      />
                      {source.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="output-actions">
              <button
                className="secondary-button compact section-toggle"
                type="button"
                onClick={() => toggleSection('output')}
              >
                {collapsedSections.output ? 'Expand' : 'Collapse'}
              </button>
              <button
                type="button"
                disabled={creatingOutput || outputSourceIds.length === 0}
                onClick={() => void createOutputProfile()}
              >
                {creatingOutput ? 'Creating…' : 'Create TiviMate URL'}
              </button>
            </div>
          </div>
          {workspace === 'overview' &&
          !collapsedSections.output &&
          outputProfiles.length > 0 ? (
            <div className="output-profile-list">
              {outputProfiles.map((profile) => {
                const sourceNames = profile.sourceIds
                  .map(
                    (sourceId) =>
                      sources.find((source) => source.id === sourceId)?.name ??
                      'Removed provider',
                  )
                  .join(' + ');
                const playlistOutputUrl = profile.accessToken
                  ? `${window.location.origin}/m/${profile.accessToken}`
                  : '';
                const epgOutputUrl = profile.accessToken
                  ? `${window.location.origin}/e/${profile.accessToken}`
                  : '';
                return (
                  <article className="output-url" key={profile.id}>
                    <div className="output-url-heading">
                      <strong>{profile.name}</strong>
                      <small>{sourceNames}</small>
                    </div>
                    {profile.recoverable && profile.accessToken ? (
                      <>
                        <label htmlFor={`playlist-output-url-${profile.id}`}>
                          M3U playlist URL
                        </label>
                        <div className="copy-row">
                          <input
                            id={`playlist-output-url-${profile.id}`}
                            readOnly
                            value={playlistOutputUrl}
                            onFocus={(event) => event.currentTarget.select()}
                          />
                          <button
                            className="secondary-button compact"
                            type="button"
                            onClick={() =>
                              void navigator.clipboard
                                .writeText(playlistOutputUrl)
                                .then(() =>
                                  showToast('success', 'Playlist URL copied'),
                                )
                                .catch(() =>
                                  showToast(
                                    'error',
                                    'Could not copy — select the text instead',
                                  ),
                                )
                            }
                          >
                            Copy
                          </button>
                        </div>
                        <label htmlFor={`epg-output-url-${profile.id}`}>
                          XMLTV EPG URL
                        </label>
                        <div className="copy-row">
                          <input
                            id={`epg-output-url-${profile.id}`}
                            readOnly
                            value={epgOutputUrl}
                            onFocus={(event) => event.currentTarget.select()}
                          />
                          <button
                            className="secondary-button compact"
                            type="button"
                            onClick={() =>
                              void navigator.clipboard
                                .writeText(epgOutputUrl)
                                .then(() =>
                                  showToast('success', 'EPG URL copied'),
                                )
                                .catch(() =>
                                  showToast(
                                    'error',
                                    'Could not copy — select the text instead',
                                  ),
                                )
                            }
                          >
                            Copy
                          </button>
                        </div>
                        <small>
                          Available from any device signed in as this
                          administrator. Treat these URLs like passwords.
                        </small>
                      </>
                    ) : (
                      <p className="legacy-output-note">
                        This older URL stays active but cannot be shown again.
                        Create a replacement, update TiviMate, then revoke this
                        one.
                      </p>
                    )}
                    <button
                      className="revoke-button"
                      type="button"
                      disabled={creatingOutput}
                      onClick={() => void revokeOutputProfile(profile.id)}
                    >
                      Revoke this URL
                    </button>
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {workspace !== 'overview' &&
      workspace !== 'updates' &&
      groups.length === 0 ? (
        <div className="workspace-empty">
          <strong>No imported live playlist</strong>
          <p>
            Open Overview and import a provider playlist before editing this
            workspace.
          </p>
        </div>
      ) : null}
    </section>
  );
}
