import { type DragEvent, type FormEvent, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { channelLogoSource, ChannelLogo } from './components/ChannelLogo.js';
import { IconChevronDown, IconChevronUp, IconGrip } from './icons.js';
import { showToast } from './toast.js';
import { AutomationSettings } from './workspaces/AutomationSettings.js';
import { RefreshActivity } from './workspaces/RefreshActivity.js';
import { CataloguePanel } from './workspaces/CataloguePanel.js';
import { ChannelsWorkspace } from './workspaces/ChannelsWorkspace.js';
import { EpgSourcesPanel } from './workspaces/EpgSourcesPanel.js';
import { EpgWorkspace } from './workspaces/EpgWorkspace.js';
import {
  HomeWorkspace,
  type HomeDestination,
} from './workspaces/HomeWorkspace.js';
import { PlayerLinksWorkspace } from './workspaces/PlayerLinksWorkspace.js';
import { ProviderCard } from './workspaces/ProviderCard.js';
import type { SystemStatus } from './workspaces/status.js';

export type WorkspaceView =
  | 'overview'
  | 'lineup'
  | 'catalogue'
  | 'events'
  | 'epg'
  | 'links'
  | 'providers'
  | 'updates';
export type LineupView = 'order' | 'channels';

interface SourceSetupProps {
  workspace: WorkspaceView;
  lineupView: LineupView;
  status: SystemStatus | null;
  /** Where the provider picker is drawn: the sidebar. */
  switcherSlot: HTMLElement | null;
  /** Where a page draws its main action: beside the page title. */
  actionSlot: HTMLElement | null;
  onNavigate: (destination: HomeDestination) => void;
  onRefreshStatus: () => void;
}

interface Capabilities {
  secureTransport?: boolean;
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
  importLive: boolean;
  importCatalogue: boolean;
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

interface RemovedGroupSummary {
  providerGroup: string;
  removedAt: string;
  stillOffered: boolean;
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
  policyOutputGroupName?: string;
}

interface CustomCategory {
  name: string;
  channelCount: number;
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
    | 'snapshot-reactivate'
    | 'channels-retired'
    | 'group-removed'
    | 'group-restored';
  occurredAt: string;
  title: string;
  detail: string;
  status?: 'succeeded' | 'failed' | 'rejected';
}

interface SourceHistory {
  snapshots: SnapshotHistoryItem[];
  activity: SourceActivityEvent[];
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

const BROWSER_TIME_ZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const TIMEZONE_CHOICES: string[] =
  (
    Intl as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf?.('timeZone') ?? [];

function formatHistoryTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatEventTime(value: string | undefined, timeZone: string): string {
  if (!value) return 'Time not parsed';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

export function SourceSetup({
  workspace,
  lineupView,
  status,
  switcherSlot,
  actionSlot,
  onNavigate,
  onRefreshStatus,
}: SourceSetupProps) {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [sources, setSources] = useState<SafeSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [name, setName] = useState('Home provider');
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [newSourceType, setNewSourceType] = useState<'m3u' | 'xtream'>('m3u');
  const [xtreamServer, setXtreamServer] = useState('');
  const [xtreamUsername, setXtreamUsername] = useState('');
  const [xtreamPassword, setXtreamPassword] = useState('');
  const [epgUrl, setEpgUrl] = useState('');
  const [providerTimezone, setProviderTimezone] = useState(BROWSER_TIME_ZONE);
  const [saving, setSaving] = useState(false);
  const [removingSourceId, setRemovingSourceId] = useState<string | null>(null);
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
  const [selectedGroupNames, setSelectedGroupNames] = useState<string[]>([]);
  const [bulkGroupSaving, setBulkGroupSaving] = useState(false);
  const [groupListLimit, setGroupListLimit] = useState(50);
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [removedGroups, setRemovedGroups] = useState<RemovedGroupSummary[]>([]);
  const [groupRemovalPending, setGroupRemovalPending] = useState<
    string[] | null
  >(null);
  const [removingGroups, setRemovingGroups] = useState(false);
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
  >(() => Object.create(null) as Record<string, string>);
  const [permanentGroupRenames, setPermanentGroupRenames] = useState<
    Record<string, string>
  >(() => Object.create(null) as Record<string, string>);
  const [showHiddenPermanentGroups, setShowHiddenPermanentGroups] =
    useState(false);
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>(
    [],
  );
  const [newCustomCategory, setNewCustomCategory] = useState('');
  const [savingCustomCategory, setSavingCustomCategory] = useState(false);
  const [review, setReview] = useState<ReconciliationReview | null>(null);
  const [reviewMatches, setReviewMatches] = useState<Record<string, string>>(
    () => Object.create(null) as Record<string, string>,
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
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({});

  async function loadGroups(sourceId: string) {
    const response = await fetch(`/api/v1/sources/${sourceId}/groups`);
    const payload = await readJson<{ groups: GroupSummary[] }>(response);
    setGroups(payload.groups);
  }

  async function loadRemovedGroups(sourceId: string) {
    const response = await fetch(`/api/v1/sources/${sourceId}/removed-groups`);
    const payload = await readJson<{ groups: RemovedGroupSummary[] }>(response);
    setRemovedGroups(payload.groups);
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
            const initialLoads: Promise<void>[] = [];
            if (firstSource) {
              setSelectedSourceId(firstSource.id);
              initialLoads.push(
                loadGroups(firstSource.id),
                loadRemovedGroups(firstSource.id),
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

  // Home and History show recent activity, which automatic refreshes add to
  // while the page is open elsewhere.
  useEffect(() => {
    if (selectedSourceId === null) return;
    if (workspace !== 'overview' && workspace !== 'updates') return;
    void loadSourceHistory(selectedSourceId).catch(() => undefined);
  }, [selectedSourceId, workspace]);

  useEffect(() => {
    if (workspace !== 'lineup' || selectedSourceId === null) return;
    void Promise.all([
      loadPermanentGroups(selectedSourceId),
      loadCustomCategories(selectedSourceId),
    ]).catch((caught: unknown) =>
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Could not refresh lineup',
      ),
    );
  }, [selectedSourceId, workspace]);

  async function selectSource(source: SafeSource) {
    if (source.id === selectedSourceId) return;
    setSelectedSourceId(source.id);
    setSelectedGroupNames([]);
    setGroupListLimit(50);
    setImportSummary(null);
    setEpgImportSummary(null);
    setExpandedPermanentGroup(null);
    setChannels([]);
    setChannelTotal(0);
    setSelectedChannelIds([]);
    setEditingChannel(null);
    try {
      await Promise.all([
        loadGroups(source.id),
        loadRemovedGroups(source.id),
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
    setName('Home provider');
    setPlaylistUrl('');
    setEpgUrl('');
    setNewSourceType('m3u');
    setXtreamServer('');
    setXtreamUsername('');
    setXtreamPassword('');
    setShowSourceForm(false);
  }

  async function saveSource(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch('/api/v1/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          sourceType: newSourceType,
          // A panel is described by its address and login; the server derives
          // the playlist and guide URLs from them.
          ...(newSourceType === 'xtream'
            ? {
                xtream: {
                  server: xtreamServer,
                  username: xtreamUsername,
                  password: xtreamPassword,
                },
              }
            : { playlistUrl }),
          ...(epgUrl ? { epgUrl } : {}),
          sourceTimezone: providerTimezone.trim() || BROWSER_TIME_ZONE,
          displayTimezone: BROWSER_TIME_ZONE,
        }),
      });
      const payload = await readJson<{ source: SafeSource }>(response);
      setSources((current) => [...current, payload.source]);
      clearSourceForm();
      onRefreshStatus();
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
      onRefreshStatus();
      clearSourceForm();
      if (selectedSourceId === source.id) {
        const nextSource = remaining[0] ?? null;
        setSelectedSourceId(nextSource?.id ?? null);
        setGroups([]);
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
          `${payload.revokedOutputProfiles} player link${
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
      onRefreshStatus();
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
      onRefreshStatus();
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
            sourceTimeZone: source.sourceTimezone,
            displayTimeZone: source.displayTimezone,
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
      await loadEventReview(source.id);
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
      const refreshes: Promise<void>[] = [];
      if ('enabled' in update || 'customGroup' in update) {
        refreshes.push(loadPermanentGroups(source.id));
      }
      if (
        ('sortOrder' in update || 'customName' in update) &&
        expandedPermanentGroup !== null
      ) {
        refreshes.push(loadChannels(source.id, expandedPermanentGroup));
      }
      await Promise.all(refreshes);
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
      await loadCustomCategories(source.id);
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

  async function bulkUpdateGroupPolicies(
    source: SafeSource,
    groupNames: string[],
    update: {
      behavior?: 'permanent' | 'event';
      enabled?: boolean;
      outputGroupName?: string | null;
    },
  ) {
    if (groupNames.length === 0) return;
    setBulkGroupSaving(true);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/group-policies/bulk`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            groupNames: groupNames.slice(0, 1000),
            update,
          }),
        },
      );
      const payload = await readJson<{ updatedCount: number }>(response);
      const action =
        update.behavior === 'event'
          ? 'marked as live events'
          : update.behavior === 'permanent'
            ? 'switched to regular TV'
            : update.outputGroupName !== undefined
              ? update.outputGroupName === null
                ? 'reset to the provider name'
                : `renamed to “${update.outputGroupName}”`
              : update.enabled === false
                ? 'unpublished'
                : 'published';
      showToast(
        'success',
        `${payload.updatedCount.toLocaleString()} group${
          payload.updatedCount === 1 ? '' : 's'
        } ${action}`,
      );
      await Promise.all([
        loadGroups(source.id),
        loadEventReview(source.id),
        refreshPermanentWorkspace(source.id),
        loadReconciliationReview(source.id),
      ]);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not update group policies',
      );
    } finally {
      setBulkGroupSaving(false);
    }
  }

  /**
   * Deletes the selected groups' channels. Group policies and playlist order
   * survive, so a restore puts everything back where it was.
   */
  async function removeGroups(source: SafeSource, groupNames: string[]) {
    if (groupNames.length === 0) return;
    setRemovingGroups(true);
    try {
      let removedChannels = 0;
      for (const groupName of groupNames) {
        const response = await fetch(
          `/api/v1/sources/${source.id}/removed-groups`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ groupName }),
          },
        );
        const payload = await readJson<{ removedChannels: number }>(response);
        removedChannels += payload.removedChannels;
      }
      setSelectedGroupNames([]);
      setGroupRemovalPending(null);
      showToast(
        'success',
        `${groupNames.length.toLocaleString()} group${
          groupNames.length === 1 ? '' : 's'
        } removed with ${removedChannels.toLocaleString()} channel${
          removedChannels === 1 ? '' : 's'
        }`,
      );
      await Promise.all([
        loadGroups(source.id),
        loadRemovedGroups(source.id),
        loadEventReview(source.id),
        refreshPermanentWorkspace(source.id),
        loadReconciliationReview(source.id),
      ]);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Could not remove the group',
      );
    } finally {
      setRemovingGroups(false);
    }
  }

  async function restoreGroup(source: SafeSource, groupName: string) {
    setRemovingGroups(true);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/removed-groups/restore`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ groupName }),
        },
      );
      await readJson<unknown>(response);
      showToast('success', `${groupName} restored`);
      await Promise.all([
        loadGroups(source.id),
        loadRemovedGroups(source.id),
        loadEventReview(source.id),
        refreshPermanentWorkspace(source.id),
        loadReconciliationReview(source.id),
      ]);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not restore the group',
      );
    } finally {
      setRemovingGroups(false);
    }
  }

  function toggleGroupSelection(groupName: string) {
    setSelectedGroupNames((current) =>
      current.includes(groupName)
        ? current.filter((value) => value !== groupName)
        : [...current, groupName],
    );
  }

  function toggleAllVisibleGroups() {
    setSelectedGroupNames((current) =>
      visibleGroups.every((group) => current.includes(group.providerGroup))
        ? current.filter(
            (name) =>
              !visibleGroups.some((group) => group.providerGroup === name),
          )
        : [
            ...current,
            ...visibleGroups
              .map((group) => group.providerGroup)
              .filter((name) => !current.includes(name)),
          ],
    );
  }

  function toggleSection(section: string) {
    setCollapsedSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
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

  const normalizedFilter = groupFilter.trim().toLocaleLowerCase();
  const matchingGroups = groups.filter(
    (group) =>
      (eventGroupView === 'events' ? group.behavior === 'event' : true) &&
      (normalizedFilter
        ? group.providerGroup.toLocaleLowerCase().includes(normalizedFilter)
        : true),
  );
  const visibleGroups = matchingGroups.slice(0, groupListLimit);
  const pendingRemovalChannelCount = (groupRemovalPending ?? []).reduce(
    (total, name) =>
      total +
      (groups.find((group) => group.providerGroup === name)?.channelCount ?? 0),
    0,
  );
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
  const activeEventReview = eventReview?.groups.find(
    (group) => group.groupName === selectedEventGroup,
  );
  const editedEventGroup = groups.find(
    (group) => group.providerGroup === editingEventGroup,
  );

  const sourcePersistence = capabilities?.sourcePersistence === true;
  const providerBusy =
    inspectingId !== null ||
    importingEpgId !== null ||
    removingSourceId !== null;
  const snapshots = sourceHistory?.snapshots ?? [];
  const activity = sourceHistory?.activity ?? [];

  return (
    <section
      className={`source-workspace source-workspace-${workspace}`}
      id="source-setup"
    >
      {switcherSlot && primarySource
        ? createPortal(
            <label className="provider-switcher">
              <span>Provider</span>
              {sources.length > 1 ? (
                <select
                  value={primarySource.id}
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
              ) : (
                <strong>{primarySource.name}</strong>
              )}
            </label>,
            switcherSlot,
          )
        : null}

      {capabilities && !capabilities.sourcePersistence ? (
        <p className="ui-note">
          Start the Docker Compose stack with a database and master key to add
          providers. The event-time preview under Channels, Live events works
          without them.
        </p>
      ) : null}

      <HomeWorkspace
        active={workspace === 'overview' && sourcePersistence}
        status={status}
        sources={sources}
        activity={activity}
        actionSlot={actionSlot}
        onNavigate={onNavigate}
        onRefreshStatus={onRefreshStatus}
      />

      {workspace === 'providers' && sourcePersistence ? (
        <div className="ui-page">
          {actionSlot && sources.length > 0 && !showSourceForm
            ? createPortal(
                <button
                  className="ui-button primary"
                  type="button"
                  onClick={() => {
                    clearSourceForm();
                    setShowSourceForm(true);
                  }}
                >
                  Add provider
                </button>,
                actionSlot,
              )
            : null}

          <section className="ui-section">
            <h2>Playlists</h2>
            {sources.length === 0 || showSourceForm ? (
              <form className="ui-card ui-stack" onSubmit={saveSource}>
                <div className="ui-title">New provider</div>
                <div className="ui-field">
                  <label htmlFor="source-name">Name</label>
                  <input
                    id="source-name"
                    className="ui-input"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </div>
                <div className="ui-field">
                  <span className="ui-label">How to connect</span>
                  <div className="ui-chips">
                    <button
                      className="ui-chip"
                      type="button"
                      aria-pressed={newSourceType === 'm3u'}
                      onClick={() => setNewSourceType('m3u')}
                    >
                      M3U link
                    </button>
                    <button
                      className="ui-chip"
                      type="button"
                      aria-pressed={newSourceType === 'xtream'}
                      onClick={() => setNewSourceType('xtream')}
                    >
                      Xtream login
                    </button>
                  </div>
                </div>
                {newSourceType === 'm3u' ? (
                  <div className="ui-field">
                    <label htmlFor="playlist-url">Playlist link</label>
                    <input
                      id="playlist-url"
                      className="ui-input mono"
                      type="text"
                      value={playlistUrl}
                      onChange={(event) => setPlaylistUrl(event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      required
                    />
                  </div>
                ) : (
                  <>
                    <div className="ui-field">
                      <label htmlFor="xtream-server">Server address</label>
                      <input
                        id="xtream-server"
                        className="ui-input mono"
                        value={xtreamServer}
                        onChange={(event) =>
                          setXtreamServer(event.target.value)
                        }
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="http://panel.example:2095"
                        required
                      />
                    </div>
                    <div className="ui-field">
                      <label htmlFor="xtream-username">Username</label>
                      <input
                        id="xtream-username"
                        className="ui-input mono"
                        value={xtreamUsername}
                        onChange={(event) =>
                          setXtreamUsername(event.target.value)
                        }
                        autoComplete="off"
                        spellCheck={false}
                        required
                      />
                    </div>
                    <div className="ui-field">
                      <label htmlFor="xtream-password">Password</label>
                      <input
                        id="xtream-password"
                        className="ui-input mono"
                        type="password"
                        value={xtreamPassword}
                        onChange={(event) =>
                          setXtreamPassword(event.target.value)
                        }
                        autoComplete="off"
                        spellCheck={false}
                        required
                      />
                    </div>
                  </>
                )}
                <div className="ui-field">
                  <label htmlFor="epg-url">
                    Guide link (XMLTV), optional
                    {newSourceType === 'xtream'
                      ? '. Leave empty to use the guide of the Xtream server'
                      : ''}
                  </label>
                  <input
                    id="epg-url"
                    className="ui-input mono"
                    type="text"
                    value={epgUrl}
                    onChange={(event) => setEpgUrl(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="ui-field">
                  <label htmlFor="provider-timezone">
                    Timezone the provider writes event times in
                  </label>
                  <input
                    id="provider-timezone"
                    className="ui-input"
                    list="timezone-choices"
                    value={providerTimezone}
                    onChange={(event) =>
                      setProviderTimezone(event.target.value)
                    }
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="ui-actions">
                  <button
                    className="ui-button primary"
                    type="submit"
                    disabled={saving}
                  >
                    {saving ? 'Adding…' : 'Add provider'}
                  </button>
                  {sources.length > 0 ? (
                    <button
                      className="ui-button"
                      type="button"
                      disabled={saving}
                      onClick={clearSourceForm}
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </form>
            ) : null}

            {sources.map((source) => (
              <ProviderCard
                key={source.id}
                source={source}
                status={status?.sources.find(
                  (candidate) => candidate.sourceId === source.id,
                )}
                locked={providerBusy}
                refreshing={inspectingId === source.id}
                refreshingGuide={importingEpgId === source.id}
                removing={removingSourceId === source.id}
                onSaved={(saved, importGuide) => {
                  setSources((current) =>
                    current.map((candidate) =>
                      candidate.id === saved.id ? saved : candidate,
                    ),
                  );
                  onRefreshStatus();
                  if (importGuide) void importEpg(saved);
                }}
                onRefresh={() =>
                  void (async () => {
                    await selectSource(source);
                    await inspectSource(source);
                  })()
                }
                onRefreshGuide={() =>
                  void (async () => {
                    await selectSource(source);
                    await importEpg(source);
                  })()
                }
                onRemove={() => void removeSource(source)}
              />
            ))}

            {importSummary ? (
              <div className="ui-card ui-row ui-soft" aria-live="polite">
                Playlist read:{' '}
                {importSummary.retainedLiveEntries.toLocaleString()} live
                channels, {importSummary.skippedEntries.toLocaleString()} movie
                and series entries left out,{' '}
                {(importSummary.totalBytes / 1_000_000).toFixed(1)} MB,{' '}
                {importSummary.issues.toLocaleString()} lines could not be read.
              </div>
            ) : null}
            {epgImportSummary ? (
              <div className="ui-card ui-row ui-soft" aria-live="polite">
                Guide read: {epgImportSummary.channelCount.toLocaleString()}{' '}
                channels, {epgImportSummary.programmeCount.toLocaleString()}{' '}
                programmes,{' '}
                {(epgImportSummary.totalBytes / 1_000_000).toFixed(1)} MB,{' '}
                {epgImportSummary.issueCount.toLocaleString()}
                {epgImportSummary.issuesTruncated ? '+' : ''} entries could not
                be read.
              </div>
            ) : null}
            {sources.length > 0 ? (
              <p className="ui-note">
                Links are stored encrypted and shown only to the signed-in
                administrator.
              </p>
            ) : null}
          </section>

          <EpgSourcesPanel active />
          <AutomationSettings active />
          <RefreshActivity sources={sources} />

          {capabilities?.secureTransport === false ? (
            <section className="ui-section">
              <h2>Connection</h2>
              <div className="ui-card ui-row">
                <div className="ui-grow ui-soft">
                  This editor runs over plain HTTP, which is normal on a home
                  network. Sign-in, provider links and player links can be read
                  by other devices on that network.
                </div>
                <a
                  className="ui-link"
                  href="https://github.com/Macstered/IPTVMaster/blob/main/docs/HTTPS.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  How to add HTTPS
                </a>
              </div>
            </section>
          ) : null}

          <datalist id="timezone-choices">
            {TIMEZONE_CHOICES.map((zone) => (
              <option value={zone} key={zone} />
            ))}
          </datalist>
        </div>
      ) : null}

      <PlayerLinksWorkspace
        active={workspace === 'links' && sourcePersistence}
        sources={sources}
      />

      {workspace === 'updates' && primarySource ? (
        <div className="ui-page" id="updates">
          <RefreshActivity sources={sources} />

          <section className="ui-section">
            <h2>Earlier playlists</h2>
            <div className="ui-card">
              {snapshots.length === 0 ? (
                <div className="ui-row ui-soft">
                  No earlier playlists yet. One is kept after each successful
                  refresh.
                </div>
              ) : null}
              {snapshots.slice(0, 6).map((snapshot) => (
                <div key={snapshot.id}>
                  <div className="ui-row">
                    <div className="ui-grow">
                      <div className="ui-title">
                        {formatHistoryTime(snapshot.importedAt)}
                      </div>
                      <div className="ui-soft">
                        {snapshot.liveCount.toLocaleString()} channels ·{' '}
                        {snapshot.issueCount.toLocaleString()} lines could not
                        be read
                      </div>
                    </div>
                    {snapshot.isCurrent ? (
                      <span className="ui-pill ok">In use</span>
                    ) : (
                      <button
                        className="ui-button"
                        type="button"
                        disabled={restoringSnapshot !== null}
                        onClick={() => setConfirmingSnapshot(snapshot.id)}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                  {confirmingSnapshot === snapshot.id ? (
                    <div className="ui-row ui-warning">
                      <div className="ui-grow">
                        Use this playlist again? Your channel edits are kept.
                        Matches that are no longer certain go back to review.
                      </div>
                      <button
                        className="ui-button danger"
                        type="button"
                        disabled={restoringSnapshot !== null}
                        onClick={() =>
                          void restoreSnapshot(primarySource, snapshot.id)
                        }
                      >
                        {restoringSnapshot === snapshot.id
                          ? 'Restoring…'
                          : 'Restore this playlist'}
                      </button>
                      <button
                        className="ui-button"
                        type="button"
                        disabled={restoringSnapshot !== null}
                        onClick={() => setConfirmingSnapshot(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="ui-note">
              Restore an earlier playlist if a provider update went wrong. A
              later refresh can bring newer data back.
              {snapshots.length > 6
                ? ` Showing the 6 most recent of ${snapshots.length.toLocaleString()}.`
                : ''}
            </p>
          </section>

          <section className="ui-section">
            <h2>Activity</h2>
            <div className="ui-card">
              {activity.length === 0 ? (
                <div className="ui-row ui-soft">Nothing has happened yet.</div>
              ) : null}
              {activity.map((entry) => (
                <div className="ui-row" key={entry.id}>
                  <span
                    className={`ui-dot ${
                      entry.status && entry.status !== 'succeeded'
                        ? 'warn'
                        : 'ok'
                    }`}
                  />
                  <div className="ui-grow">
                    <div className="ui-strong">{entry.title}</div>
                    <div className="ui-soft">{entry.detail}</div>
                  </div>
                  <span className="ui-muted">
                    {formatHistoryTime(entry.occurredAt)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {/* Deliberately outside the group editor below: that block requires live
          groups to exist, which is exactly what a provider kept only for its
          films does not have. */}
      <CataloguePanel
        active={workspace === 'catalogue'}
        {...(primarySource
          ? {
              sourceId: primarySource.id,
              sourceName: primarySource.name,
              importCatalogue: primarySource.importCatalogue,
            }
          : {})}
      />

      {groups.length > 0 && primarySource ? (
        <div
          className="group-policy-editor"
          hidden={
            workspace !== 'lineup' &&
            workspace !== 'events' &&
            workspace !== 'epg'
          }
        >
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
                  onClick={() => {
                    setEventGroupView('events');
                    setGroupListLimit(50);
                  }}
                >
                  Event groups ({eventGroupCount})
                </button>
                <button
                  type="button"
                  className={`epg-chip ${eventGroupView === 'all' ? 'active' : ''}`}
                  onClick={() => {
                    setEventGroupView('all');
                    setGroupListLimit(50);
                  }}
                >
                  All groups ({groups.length})
                </button>
              </div>
              <input
                aria-label="Filter provider groups"
                placeholder="Search groups"
                value={groupFilter}
                onChange={(event) => {
                  setGroupFilter(event.target.value);
                  setGroupListLimit(50);
                }}
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
            {visibleGroups.length > 0 ? (
              <div className="bulk-toolbar group-bulk-toolbar">
                <label className="bulk-select-all">
                  <input
                    type="checkbox"
                    checked={
                      visibleGroups.length > 0 &&
                      visibleGroups.every((group) =>
                        selectedGroupNames.includes(group.providerGroup),
                      )
                    }
                    onChange={toggleAllVisibleGroups}
                  />
                  Select shown
                </label>
                <strong>{selectedGroupNames.length} selected</strong>
                {selectedGroupNames.length > 0 ? (
                  <button
                    className="secondary-button compact"
                    type="button"
                    disabled={bulkGroupSaving}
                    onClick={() => setSelectedGroupNames([])}
                  >
                    Clear
                  </button>
                ) : null}
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={bulkGroupSaving || selectedGroupNames.length === 0}
                  onClick={() =>
                    void bulkUpdateGroupPolicies(
                      primarySource,
                      selectedGroupNames,
                      { behavior: 'event' },
                    )
                  }
                >
                  Mark as event
                </button>
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={bulkGroupSaving || selectedGroupNames.length === 0}
                  onClick={() =>
                    void bulkUpdateGroupPolicies(
                      primarySource,
                      selectedGroupNames,
                      { behavior: 'permanent' },
                    )
                  }
                >
                  Treat as TV
                </button>
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={bulkGroupSaving || selectedGroupNames.length === 0}
                  onClick={() =>
                    void bulkUpdateGroupPolicies(
                      primarySource,
                      selectedGroupNames,
                      { enabled: true },
                    )
                  }
                >
                  Publish
                </button>
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={bulkGroupSaving || selectedGroupNames.length === 0}
                  onClick={() =>
                    void bulkUpdateGroupPolicies(
                      primarySource,
                      selectedGroupNames,
                      { enabled: false },
                    )
                  }
                >
                  Unpublish
                </button>
                <button
                  className="danger-button compact"
                  type="button"
                  disabled={
                    bulkGroupSaving ||
                    removingGroups ||
                    selectedGroupNames.length === 0
                  }
                  onClick={() => setGroupRemovalPending(selectedGroupNames)}
                >
                  Remove
                </button>
              </div>
            ) : null}
            {groupRemovalPending && groupRemovalPending.length > 0 ? (
              <div className="group-removal-confirm">
                <div>
                  <strong>
                    Remove {groupRemovalPending.length.toLocaleString()} group
                    {groupRemovalPending.length === 1 ? '' : 's'}?
                  </strong>
                  <small>
                    {pendingRemovalChannelCount.toLocaleString()} channel
                    {pendingRemovalChannelCount === 1 ? '' : 's'} and their
                    edits are deleted, and refreshes will not bring the group
                    {groupRemovalPending.length === 1 ? '' : 's'} back. You can
                    restore {groupRemovalPending.length === 1 ? 'it' : 'them'}{' '}
                    below at any time, but the channels return without those
                    edits.
                  </small>
                </div>
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={removingGroups}
                  onClick={() => setGroupRemovalPending(null)}
                >
                  Cancel
                </button>
                <button
                  className="danger-button compact"
                  type="button"
                  disabled={removingGroups}
                  onClick={() =>
                    void removeGroups(primarySource, groupRemovalPending)
                  }
                >
                  {removingGroups ? 'Removing…' : 'Remove them'}
                </button>
              </div>
            ) : null}
            <div className="group-list">
              {visibleGroups.map((group) => (
                <div className="group-row" key={group.providerGroup}>
                  <label className="group-select-label">
                    <input
                      className="channel-select"
                      type="checkbox"
                      checked={selectedGroupNames.includes(group.providerGroup)}
                      onChange={() => toggleGroupSelection(group.providerGroup)}
                    />
                    <span className="group-select-text">
                      <strong>{group.providerGroup || '(Ungrouped)'}</strong>
                      <small>
                        {group.channelCount.toLocaleString()} live entries
                      </small>
                    </span>
                  </label>
                  <span className={`behavior-badge ${group.behavior}`}>
                    {group.behavior === 'event' ? 'LIVE EVENT' : 'LIVE TV'}
                  </span>
                  {group.behavior === 'event' ? (
                    <label
                      className="permanent-visibility-toggle"
                      title="Publish this event group in the generated playlist"
                    >
                      <input
                        type="checkbox"
                        checked={group.enabled}
                        disabled={bulkGroupSaving || savingGroup !== null}
                        onChange={(event) =>
                          void bulkUpdateGroupPolicies(
                            primarySource,
                            [group.providerGroup],
                            { enabled: event.target.checked },
                          )
                        }
                      />
                      {group.enabled ? 'Published' : 'Hidden'}
                    </label>
                  ) : (
                    <span className="group-action-spacer" />
                  )}
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
                    disabled={savingGroup !== null || bulkGroupSaving}
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
              <div className="show-more-row">
                <small className="channel-limit-note">
                  Showing {visibleGroups.length.toLocaleString()} of{' '}
                  {matchingGroups.length.toLocaleString()} groups.
                </small>
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => setGroupListLimit((current) => current + 150)}
                >
                  Show 150 more
                </button>
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => setGroupListLimit(matchingGroups.length)}
                >
                  Show all {matchingGroups.length.toLocaleString()}
                </button>
              </div>
            ) : null}
            {removedGroups.length > 0 ? (
              <div className="removed-groups">
                <div className="subsection-heading">
                  <div>
                    <small>REMOVED GROUPS</small>
                    <strong>
                      {removedGroups.length.toLocaleString()} kept out of
                      refreshes
                    </strong>
                  </div>
                </div>
                <div className="removed-group-list">
                  {removedGroups.map((group) => (
                    <div
                      className="removed-group-row"
                      key={group.providerGroup}
                    >
                      <span className="group-select-text">
                        <strong>{group.providerGroup || '(Ungrouped)'}</strong>
                        <small>
                          {group.stillOffered
                            ? 'The provider still lists it'
                            : 'The provider no longer lists it'}
                        </small>
                      </span>
                      <button
                        className="secondary-button compact"
                        type="button"
                        disabled={removingGroups}
                        onClick={() =>
                          void restoreGroup(primarySource, group.providerGroup)
                        }
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              </div>
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
                  <strong>Provider and localized labels</strong>
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
                  Events are ordered by their calculated local start time.
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
                              <small>PLAYER</small>
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
                                  BROWSER_TIME_ZONE,
                              )}{' '}
                              →{' '}
                              {formatEventTime(
                                entry.displayDateTime,
                                activeEventReview.timePolicy?.displayTimeZone ??
                                  BROWSER_TIME_ZONE,
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
            actionSlot={actionSlot}
            onOpenProviders={() => onNavigate('providers')}
            onActivityChanged={() => {
              onRefreshStatus();
              if (primarySource) void loadSourceHistory(primarySource.id);
            }}
          />

          <div
            className={`channel-editor channel-editor-${lineupView}`}
            id="channels"
            hidden={workspace !== 'lineup'}
          >
            <ChannelsWorkspace
              source={primarySource}
              active={workspace === 'lineup' && lineupView === 'order'}
              onChanged={() => {
                void Promise.all([
                  loadGroups(primarySource.id),
                  refreshPermanentWorkspace(primarySource.id),
                ]).catch((caught: unknown) =>
                  showToast(
                    'error',
                    caught instanceof Error
                      ? caught.message
                      : 'Could not refresh lineup',
                  ),
                );
              }}
              onOpenEvents={() => {
                window.location.hash = '#/events';
              }}
            />

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
                    <strong>Available in the generated playlist</strong>
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
                          group.policyOutputGroupName ??
                          (group.providerGroup || '(Ungrouped)')
                        }`;
                  const renameValue =
                    permanentGroupRenames[group.providerGroup] ??
                    group.policyOutputGroupName ??
                    '';
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
                              if (!renameValue.trim()) return;
                              void bulkUpdateGroupPolicies(
                                primarySource,
                                [group.providerGroup],
                                { outputGroupName: renameValue.trim() },
                              );
                            }}
                          >
                            <input
                              aria-label={`Rename output group for ${group.providerGroup}`}
                              placeholder="Rename output group"
                              value={renameValue}
                              onChange={(event) =>
                                setPermanentGroupRenames((current) => ({
                                  ...current,
                                  [group.providerGroup]: event.target.value,
                                }))
                              }
                            />
                            <button
                              className="secondary-button compact"
                              type="submit"
                              disabled={
                                isSaving ||
                                bulkGroupSaving ||
                                !renameValue.trim()
                              }
                            >
                              Rename
                            </button>
                            <button
                              className="secondary-button compact"
                              type="button"
                              disabled={
                                isSaving ||
                                bulkGroupSaving ||
                                !group.policyOutputGroupName
                              }
                              title="Use the provider's group name again"
                              onClick={() => {
                                setPermanentGroupRenames((current) => ({
                                  ...current,
                                  [group.providerGroup]: '',
                                }));
                                void bulkUpdateGroupPolicies(
                                  primarySource,
                                  [group.providerGroup],
                                  { outputGroupName: null },
                                );
                              }}
                            >
                              Provider name
                            </button>
                          </form>
                        )}
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
                              aria-label={`Custom category for ${group.providerGroup}`}
                              list="custom-category-choices"
                              placeholder="Move channels to a custom category"
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
                {loadingPermanentGroups ? (
                  <p className="empty-groups">Loading provider groups…</p>
                ) : visiblePermanentGroups.length === 0 ? (
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
                        src={channelLogoSource(
                          primarySource?.id,
                          channel.id,
                          Boolean(
                            channel.customLogoUrl ?? channel.providerLogoUrl,
                          ),
                        )}
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
        </div>
      ) : null}

      {(workspace === 'lineup' ||
        workspace === 'events' ||
        workspace === 'epg') &&
      groups.length === 0 ? (
        <div className="ui-card ui-row">
          <div className="ui-grow">
            <div className="ui-title">No channels yet</div>
            <div className="ui-soft">
              Refresh a provider&apos;s playlist first. Its channels then show
              up here.
            </div>
          </div>
          <button
            className="ui-button primary"
            type="button"
            onClick={() => onNavigate('providers')}
          >
            Open Providers
          </button>
        </div>
      ) : null}
    </section>
  );
}
