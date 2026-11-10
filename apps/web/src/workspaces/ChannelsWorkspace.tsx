import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from 'react';

import { ChannelLogo, channelLogoSource } from '../components/ChannelLogo.js';
import { IconEye, IconEyeOff, IconGrip } from '../icons.js';
import { showToast } from '../toast.js';
import {
  landsAfter,
  moveBlock,
  moveBlockToPosition,
  movingBlock,
  replaceSlots,
} from './reorder.js';

interface ChannelsSource {
  id: string;
  name: string;
}

interface ChannelsWorkspaceProps {
  source: ChannelsSource | undefined;
  active: boolean;
  /** Called after every saved change so sibling workspaces can revalidate. */
  onChanged?: () => void;
  onOpenEvents?: () => void;
}

interface OutputGroup {
  name: string;
  entryCount: number;
  visibleEntryCount: number;
  behavior: 'permanent' | 'event' | 'mixed';
  sortOrder: number;
}

interface Channel {
  id: string;
  providerName: string;
  providerGroup: string;
  providerLogoUrl?: string;
  enabled: boolean;
  customName?: string;
  customLogoUrl?: string;
}

interface ChannelPage {
  channels: Channel[];
  total: number;
}

interface EventEntry {
  id: string;
  originalName: string;
  localizedName: string;
  hidden: boolean;
  displayDateTime?: string;
}

interface EventGroup {
  groupName: string;
  outputGroupName?: string;
  timePolicy?: { displayTimeZone: string };
  hiddenEntries: number;
  entries: EventEntry[];
}

type GroupView = 'shown' | 'hidden' | 'events' | 'all';
type DragKind = 'group' | 'channel';

// The channel list endpoint serves at most this many rows, and the order
// endpoint needs every channel of the group, so a larger group cannot be
// reordered from here.
const CHANNEL_PAGE_SIZE = 2000;
const BULK_UPDATE_SIZE = 500;
const DRAG_TYPE = 'application/x-iptvmaster-row';
const JSON_HEADERS = { 'content-type': 'application/json' };
const EMPTY_PAGE: ChannelPage = { channels: [], total: 0 };

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

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

function groupLabel(name: string): string {
  return name || '(Ungrouped)';
}

function channelLabel(channel: Channel): string {
  return channel.customName ?? channel.providerName;
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}

function isHidden(group: OutputGroup): boolean {
  return group.entryCount > 0 && group.visibleEntryCount === 0;
}

function inView(group: OutputGroup, view: GroupView): boolean {
  if (view === 'shown') return !isHidden(group);
  if (view === 'hidden') return isHidden(group);
  if (view === 'events') return group.behavior !== 'permanent';
  return true;
}

async function fetchGroups(sourceId: string): Promise<OutputGroup[]> {
  const response = await fetch(`/api/v1/sources/${sourceId}/output-groups`);
  const payload = await readJson<{ groups: OutputGroup[] }>(response);
  return [...payload.groups].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
  );
}

async function fetchChannels(
  sourceId: string,
  outputGroup: string,
): Promise<ChannelPage> {
  const parameters = new URLSearchParams({
    limit: String(CHANNEL_PAGE_SIZE),
    outputGroup,
  });
  const response = await fetch(
    `/api/v1/sources/${sourceId}/channels?${parameters.toString()}`,
  );
  return readJson<ChannelPage>(response);
}

async function fetchEventGroups(
  sourceId: string,
  outputGroup: string,
): Promise<EventGroup[]> {
  const response = await fetch(`/api/v1/sources/${sourceId}/events?limit=500`);
  const payload = await readJson<{ groups: EventGroup[] }>(response);
  return payload.groups.filter(
    (group) => (group.outputGroupName ?? group.groupName) === outputGroup,
  );
}

function formatEventStart(value: string | undefined, timeZone?: string) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      // Event names carry 24-hour times, so the start column matches them.
      hourCycle: 'h23',
      timeZone,
    }).format(new Date(value));
  } catch {
    return '—';
  }
}

export function ChannelsWorkspace({
  source,
  active,
  onChanged,
  onOpenEvents,
}: ChannelsWorkspaceProps) {
  const sourceId = source?.id;
  const [groups, setGroups] = useState<OutputGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelTotal, setChannelTotal] = useState(0);
  const [eventGroups, setEventGroups] = useState<EventGroup[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [groupView, setGroupView] = useState<GroupView>('shown');
  const [channelSearch, setChannelSearch] = useState('');
  const [pickedGroups, setPickedGroups] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [pickedChannels, setPickedChannels] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [drag, setDrag] = useState<{ kind: DragKind; id: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [groupAction, setGroupAction] = useState<'position' | null>(null);
  const [channelAction, setChannelAction] = useState<
    'position' | 'group' | null
  >(null);
  const [actionValue, setActionValue] = useState('');
  // Narrow screens show one pane at a time.
  const [detailOpen, setDetailOpen] = useState(false);

  // A response that arrives after the provider or group changed is dropped.
  const latest = useRef({ sourceId, selectedName });
  latest.current = { sourceId, selectedName };
  const shiftHeld = useRef(false);
  const lastPicked = useRef<{ kind: DragKind; id: string } | null>(null);

  const selected = groups.find((group) => group.name === selectedName);
  const selectedBehavior = selected?.behavior;

  useEffect(() => {
    setGroups([]);
    setSelectedName(null);
    setPickedGroups(new Set());
    setGroupAction(null);
    setDetailOpen(false);
  }, [sourceId]);

  useEffect(() => {
    if (!active || !sourceId) return;
    let cancelled = false;
    setLoadingGroups(true);
    fetchGroups(sourceId)
      .then((next) => {
        if (cancelled) return;
        setGroups(next);
        setSelectedName((current) =>
          current !== null && next.some((group) => group.name === current)
            ? current
            : (next.find((group) => group.visibleEntryCount > 0)?.name ??
              next[0]?.name ??
              null),
        );
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          showToast('error', errorMessage(caught, 'Could not load the groups'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingGroups(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, sourceId]);

  useEffect(() => {
    setPickedChannels(new Set());
    setChannelAction(null);
    setChannelSearch('');
    setChannels([]);
    setChannelTotal(0);
    setEventGroups([]);
    if (
      !active ||
      !sourceId ||
      selectedName === null ||
      selectedBehavior === undefined
    ) {
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    Promise.all([
      selectedBehavior === 'event'
        ? EMPTY_PAGE
        : fetchChannels(sourceId, selectedName),
      selectedBehavior === 'permanent'
        ? []
        : fetchEventGroups(sourceId, selectedName),
    ])
      .then(([page, events]) => {
        if (cancelled) return;
        setChannels(page.channels);
        setChannelTotal(page.total);
        setEventGroups(events);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          showToast('error', errorMessage(caught, 'Could not load this group'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, sourceId, selectedName, selectedBehavior]);

  if (!source || !sourceId) return null;
  const providerId: string = sourceId;

  /** Re-reads the group list and the open group after a change. */
  async function refresh() {
    const groupName = latest.current.selectedName;
    const next = await fetchGroups(providerId);
    const open = next.find((group) => group.name === groupName);
    const page =
      open && open.behavior !== 'event'
        ? await fetchChannels(providerId, open.name)
        : EMPTY_PAGE;
    if (latest.current.sourceId !== providerId) return;
    setGroups(next);
    if (latest.current.selectedName !== groupName) return;
    if (!open) {
      // The open group is gone, for example after its last channel moved out.
      setSelectedName(next[0]?.name ?? null);
      return;
    }
    setChannels(page.channels);
    setChannelTotal(page.total);
  }

  /** Runs one change at a time; a failure discards the optimistic state. */
  async function save(failure: string, work: () => Promise<void>) {
    setSaving(true);
    try {
      await work();
      onChanged?.();
    } catch (caught) {
      showToast('error', errorMessage(caught, failure));
      await refresh().catch(() => undefined);
    } finally {
      setSaving(false);
    }
  }

  const groupNames = groups.map((group) => group.name);
  const viewGroups = groups.filter((group) => inView(group, groupView));
  const viewNames = viewGroups.map((group) => group.name);
  const normalizedGroupSearch = groupSearch.trim().toLocaleLowerCase();
  const listedGroups = normalizedGroupSearch
    ? viewGroups.filter((group) =>
        group.name.toLocaleLowerCase().includes(normalizedGroupSearch),
      )
    : viewGroups;
  const pickedGroupNames = groupNames.filter((name) => pickedGroups.has(name));
  const viewCounts: Record<GroupView, number> = {
    shown: groups.filter((group) => inView(group, 'shown')).length,
    hidden: groups.filter((group) => inView(group, 'hidden')).length,
    events: groups.filter((group) => inView(group, 'events')).length,
    all: groups.length,
  };

  const channelIds = channels.map((channel) => channel.id);
  const normalizedChannelSearch = channelSearch.trim().toLocaleLowerCase();
  const listedChannels = normalizedChannelSearch
    ? channels.filter((channel) =>
        `${channelLabel(channel)} ${channel.providerName}`
          .toLocaleLowerCase()
          .includes(normalizedChannelSearch),
      )
    : channels;
  const pickedChannelIds = channelIds.filter((id) => pickedChannels.has(id));
  const allChannelsLoaded = channels.length === channelTotal;
  const hiddenChannelCount = channels.filter(
    (channel) => !channel.enabled,
  ).length;

  function commitGroupOrder(next: readonly string[]) {
    if (next === groupNames) return;
    const byName = new Map(groups.map((group) => [group.name, group]));
    setGroups(
      next.flatMap((name, sortOrder) => {
        const group = byName.get(name);
        return group ? [{ ...group, sortOrder }] : [];
      }),
    );
    void save('Could not save the group order', async () => {
      const response = await fetch(
        `/api/v1/sources/${providerId}/output-groups/order`,
        {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify({ outputGroups: next }),
        },
      );
      if (!response.ok) await readJson<never>(response);
    });
  }

  function commitChannelOrder(next: readonly string[]) {
    if (next === channelIds || selectedName === null) return;
    const byId = new Map(channels.map((channel) => [channel.id, channel]));
    setChannels(
      next.flatMap((id) => {
        const channel = byId.get(id);
        return channel ? [channel] : [];
      }),
    );
    void save('Could not save the channel order', async () => {
      const response = await fetch(
        `/api/v1/sources/${providerId}/output-groups/channels/order`,
        {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            outputGroup: selectedName,
            channelIds: next,
          }),
        },
      );
      if (!response.ok) await readJson<never>(response);
    });
  }

  function setGroupsShown(names: readonly string[], enabled: boolean) {
    if (names.length === 0) return;
    void save('Could not change group visibility', async () => {
      for (const groupName of names) {
        const response = await fetch(
          `/api/v1/sources/${providerId}/output-groups`,
          {
            method: 'PATCH',
            headers: JSON_HEADERS,
            body: JSON.stringify({ groupName, update: { enabled } }),
          },
        );
        await readJson<{ updatedCount: number }>(response);
      }
      showToast(
        'success',
        `${
          names.length === 1
            ? groupLabel(names[0] ?? '')
            : plural(names.length, 'group')
        } ${enabled ? 'shown' : 'hidden'}`,
      );
      await refresh();
    });
  }

  function updateChannels(
    ids: readonly string[],
    update: Record<string, unknown>,
    describe: (updatedCount: number) => string,
  ) {
    if (ids.length === 0) return;
    void save('Could not update the channels', async () => {
      let updatedCount = 0;
      for (let start = 0; start < ids.length; start += BULK_UPDATE_SIZE) {
        const response = await fetch(`/api/v1/sources/${providerId}/channels`, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            channelIds: ids.slice(start, start + BULK_UPDATE_SIZE),
            update,
          }),
        });
        const payload = await readJson<{ updatedCount: number }>(response);
        updatedCount += payload.updatedCount;
      }
      showToast('success', describe(updatedCount));
      await refresh();
    });
  }

  function setChannelsShown(ids: readonly string[], enabled: boolean) {
    setChannels((current) =>
      current.map((channel) =>
        ids.includes(channel.id) ? { ...channel, enabled } : channel,
      ),
    );
    updateChannels(
      ids,
      { enabled },
      (count) => `${plural(count, 'channel')} ${enabled ? 'shown' : 'hidden'}`,
    );
  }

  function closeChannelAction() {
    setChannelAction(null);
    setActionValue('');
  }

  function submitGroupPosition(event: FormEvent) {
    event.preventDefault();
    const moving = viewNames.filter((name) => pickedGroups.has(name));
    const nextView = moveBlockToPosition(
      viewNames,
      moving,
      Number(actionValue),
    );
    commitGroupOrder(replaceSlots(groupNames, nextView));
    setGroupAction(null);
    setActionValue('');
  }

  function submitChannelPosition(event: FormEvent) {
    event.preventDefault();
    commitChannelOrder(
      moveBlockToPosition(channelIds, pickedChannelIds, Number(actionValue)),
    );
    closeChannelAction();
  }

  function moveChannelsToGroup(customGroup: string | null) {
    updateChannels(
      pickedChannelIds,
      { customGroup },
      (count) =>
        `${plural(count, 'channel')} moved to ${
          customGroup === null ? 'the provider group' : customGroup
        }`,
    );
    setPickedChannels(new Set());
    closeChannelAction();
  }

  function submitChannelGroup(event: FormEvent) {
    event.preventDefault();
    const name = actionValue.trim();
    if (name) moveChannelsToGroup(name);
  }

  function togglePick(
    kind: DragKind,
    id: string,
    listed: readonly string[],
    picked: ReadonlySet<string>,
    setPicked: (next: ReadonlySet<string>) => void,
  ) {
    const next = new Set(picked);
    const anchor = lastPicked.current;
    const from =
      shiftHeld.current && anchor?.kind === kind
        ? listed.indexOf(anchor.id)
        : -1;
    const to = listed.indexOf(id);
    if (from >= 0 && to >= 0) {
      // Shift-click ticks everything between the last tick and this one.
      for (const item of listed.slice(
        Math.min(from, to),
        Math.max(from, to) + 1,
      )) {
        next.add(item);
      }
    } else if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    lastPicked.current = { kind, id };
    setPicked(next);
  }

  function dragProps(
    kind: DragKind,
    id: string,
    order: readonly string[],
    picked: ReadonlySet<string>,
    enabled: boolean,
    commit: (next: readonly string[]) => void,
  ) {
    const dragged = drag?.kind === kind ? drag.id : null;
    const moving = dragged === null ? [] : movingBlock(order, picked, dragged);
    const isTarget =
      dragged !== null && dropTarget === id && !moving.includes(id);
    const after = dragged !== null && landsAfter(order, dragged, id);
    return {
      dragClass: `${moving.includes(id) ? ' is-moving' : ''}${
        isTarget ? (after ? ' drop-after' : ' drop-before') : ''
      }`,
      draggable: enabled,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.dataTransfer.effectAllowed = 'move';
        // Firefox only starts a drag that carries data.
        event.dataTransfer.setData(DRAG_TYPE, id);
        setDrag({ kind, id });
        setDropTarget(null);
      },
      onDragEnd: () => {
        setDrag(null);
        setDropTarget(null);
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (dragged === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (dropTarget !== id) setDropTarget(id);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (dragged === null) return;
        event.preventDefault();
        setDrag(null);
        setDropTarget(null);
        commit(moveBlock(order, moving, dragged, id));
      },
    };
  }

  const selectedShown = selected ? selected.visibleEntryCount > 0 : false;
  const eventEntries = eventGroups.flatMap((group) =>
    group.entries
      .filter((entry) => !entry.hidden)
      .map((entry) => ({
        ...entry,
        timeZone: group.timePolicy?.displayTimeZone,
      })),
  );
  const hiddenEventEntries = eventGroups.reduce(
    (total, group) => total + group.hiddenEntries,
    0,
  );
  const otherGroupNames = groupNames.filter(
    (name) => name !== '' && name !== selectedName,
  );

  return (
    <section
      className={`channels-workspace${detailOpen ? ' detail-open' : ''}`}
      aria-label="Channels"
    >
      <div className="channels-pane channels-groups">
        <div className="channels-pane-tools">
          <input
            type="search"
            aria-label="Find a group"
            placeholder="Find a group"
            value={groupSearch}
            onChange={(event) => setGroupSearch(event.target.value)}
          />
          {pickedGroupNames.length === 0 ? (
            <div className="channels-chips" role="group" aria-label="Show">
              {(
                [
                  ['shown', 'Shown'],
                  ['hidden', 'Hidden'],
                  ['events', 'Live events'],
                  ['all', 'All'],
                ] as const
              ).map(([view, label]) => (
                <button
                  className="channels-chip"
                  type="button"
                  aria-pressed={groupView === view}
                  onClick={() => setGroupView(view)}
                  key={view}
                >
                  {label} {viewCounts[view].toLocaleString()}
                </button>
              ))}
            </div>
          ) : groupAction === 'position' ? (
            <form className="channels-bulk" onSubmit={submitGroupPosition}>
              <label htmlFor="channels-group-position">Move to position</label>
              <input
                id="channels-group-position"
                type="number"
                min={1}
                max={viewNames.length}
                required
                autoFocus
                value={actionValue}
                onChange={(event) => setActionValue(event.target.value)}
              />
              <button
                className="channels-button"
                type="submit"
                disabled={saving}
              >
                Move
              </button>
              <button
                className="channels-text-button"
                type="button"
                onClick={() => setGroupAction(null)}
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="channels-bulk">
              <strong>
                {pickedGroupNames.length.toLocaleString()} selected
              </strong>
              <button
                className="channels-button"
                type="button"
                disabled={saving}
                onClick={() => {
                  setActionValue('');
                  setGroupAction('position');
                }}
              >
                Move to position
              </button>
              <button
                className="channels-button"
                type="button"
                disabled={saving}
                onClick={() => setGroupsShown(pickedGroupNames, false)}
              >
                Hide
              </button>
              <button
                className="channels-button"
                type="button"
                disabled={saving}
                onClick={() => setGroupsShown(pickedGroupNames, true)}
              >
                Show
              </button>
              <button
                className="channels-text-button"
                type="button"
                onClick={() => setPickedGroups(new Set())}
              >
                Clear
              </button>
            </div>
          )}
        </div>
        <ul className="channels-list">
          {listedGroups.map((group) => {
            const hidden = isHidden(group);
            const { dragClass, ...dragHandlers } = dragProps(
              'group',
              group.name,
              groupNames,
              pickedGroups,
              !saving,
              commitGroupOrder,
            );
            return (
              <li
                className={`channels-group-row${
                  group.name === selectedName ? ' selected' : ''
                }${pickedGroups.has(group.name) ? ' picked' : ''}${
                  hidden ? ' hidden-row' : ''
                }${dragClass}`}
                key={group.name}
                {...dragHandlers}
              >
                <span
                  className="drag-handle"
                  aria-hidden="true"
                  title="Drag to reorder"
                >
                  <IconGrip />
                </span>
                <input
                  type="checkbox"
                  aria-label={`Select ${groupLabel(group.name)}`}
                  checked={pickedGroups.has(group.name)}
                  onClick={(event) => {
                    shiftHeld.current = event.shiftKey;
                  }}
                  onChange={() =>
                    togglePick(
                      'group',
                      group.name,
                      listedGroups.map((listed) => listed.name),
                      pickedGroups,
                      setPickedGroups,
                    )
                  }
                />
                <button
                  className="channels-group-open"
                  type="button"
                  aria-pressed={group.name === selectedName}
                  onClick={() => {
                    setSelectedName(group.name);
                    setDetailOpen(true);
                  }}
                >
                  <span className="channels-position">
                    {viewNames.indexOf(group.name) + 1}
                  </span>
                  <span className="channels-name">
                    {groupLabel(group.name)}
                  </span>
                  {group.behavior !== 'permanent' ? (
                    <span className="channels-tag event">
                      {group.behavior === 'event' ? 'Events' : 'TV + events'}
                    </span>
                  ) : null}
                  <span className="channels-count">
                    {group.entryCount === 0
                      ? 'Empty'
                      : hidden || group.visibleEntryCount === group.entryCount
                        ? group.entryCount.toLocaleString()
                        : `${group.visibleEntryCount.toLocaleString()} of ${group.entryCount.toLocaleString()}`}
                  </span>
                </button>
                <button
                  className="channels-eye"
                  type="button"
                  aria-label={`${hidden ? 'Show' : 'Hide'} ${groupLabel(group.name)}`}
                  title={
                    hidden
                      ? 'Hidden from the playlist'
                      : 'Shown in the playlist'
                  }
                  aria-pressed={!hidden}
                  disabled={saving || group.entryCount === 0}
                  onClick={() => setGroupsShown([group.name], hidden)}
                >
                  {hidden ? <IconEyeOff /> : <IconEye />}
                </button>
              </li>
            );
          })}
          {listedGroups.length === 0 ? (
            <li className="channels-empty">
              {loadingGroups
                ? 'Loading groups…'
                : groups.length === 0
                  ? 'Import a playlist to see its groups here.'
                  : 'No groups match. Try another view or clear the search.'}
            </li>
          ) : null}
        </ul>
      </div>

      <div className="channels-pane channels-detail">
        {selected ? (
          <>
            <div className="channels-detail-heading">
              <button
                className="channels-text-button channels-back"
                type="button"
                onClick={() => setDetailOpen(false)}
              >
                ← All groups
              </button>
              <div className="channels-detail-title">
                <h2>{groupLabel(selected.name)}</h2>
                <p>
                  {selected.behavior === 'event'
                    ? `${selected.entryCount.toLocaleString()} ${
                        selected.entryCount === 1 ? 'entry' : 'entries'
                      } from the provider`
                    : plural(channelTotal, 'channel')}
                  {hiddenChannelCount > 0
                    ? ` · ${hiddenChannelCount.toLocaleString()} hidden`
                    : ''}
                  {' · '}
                  {selected.behavior === 'event'
                    ? 'live events'
                    : selected.behavior === 'mixed'
                      ? 'TV and live events'
                      : 'live TV'}
                </p>
              </div>
              <button
                className="channels-switch"
                type="button"
                role="switch"
                aria-checked={selectedShown}
                disabled={saving || selected.entryCount === 0}
                onClick={() => setGroupsShown([selected.name], !selectedShown)}
              >
                <span className="channels-switch-track" aria-hidden="true">
                  <span />
                </span>
                {selectedShown ? 'Shown in playlist' : 'Hidden from playlist'}
              </button>
            </div>

            {selected.behavior !== 'event' ? (
              <>
                {pickedChannelIds.length === 0 ? (
                  <div className="channels-toolbar">
                    <input
                      type="search"
                      aria-label="Find a channel in this group"
                      placeholder="Find a channel in this group"
                      value={channelSearch}
                      onChange={(event) => setChannelSearch(event.target.value)}
                    />
                    <small>
                      {allChannelsLoaded
                        ? 'Drag a row to move it. Tick several to move, hide or regroup them together.'
                        : `Showing the first ${channels.length.toLocaleString()} channels; a group this large cannot be reordered here.`}
                    </small>
                  </div>
                ) : channelAction === 'position' ? (
                  <form
                    className="channels-toolbar channels-bulk"
                    onSubmit={submitChannelPosition}
                  >
                    <label htmlFor="channels-channel-position">
                      Move {plural(pickedChannelIds.length, 'channel')} to
                      position
                    </label>
                    <input
                      id="channels-channel-position"
                      type="number"
                      min={1}
                      max={channels.length}
                      required
                      autoFocus
                      value={actionValue}
                      onChange={(event) => setActionValue(event.target.value)}
                    />
                    <button
                      className="channels-button"
                      type="submit"
                      disabled={saving}
                    >
                      Move
                    </button>
                    <button
                      className="channels-text-button"
                      type="button"
                      onClick={closeChannelAction}
                    >
                      Cancel
                    </button>
                  </form>
                ) : channelAction === 'group' ? (
                  <form
                    className="channels-toolbar channels-bulk"
                    onSubmit={submitChannelGroup}
                  >
                    <label htmlFor="channels-channel-group">
                      Move {plural(pickedChannelIds.length, 'channel')} to group
                    </label>
                    <input
                      id="channels-channel-group"
                      list="channels-group-names"
                      placeholder="Existing or new group name"
                      required
                      autoFocus
                      value={actionValue}
                      onChange={(event) => setActionValue(event.target.value)}
                    />
                    <datalist id="channels-group-names">
                      {otherGroupNames.map((name) => (
                        <option value={name} key={name} />
                      ))}
                    </datalist>
                    <button
                      className="channels-button"
                      type="submit"
                      disabled={saving}
                    >
                      Move
                    </button>
                    <button
                      className="channels-button"
                      type="button"
                      disabled={saving}
                      title="Put the channels back in the group the provider sends them in"
                      onClick={() => moveChannelsToGroup(null)}
                    >
                      Back to provider group
                    </button>
                    <button
                      className="channels-text-button"
                      type="button"
                      onClick={closeChannelAction}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className="channels-toolbar channels-bulk">
                    <strong>
                      {pickedChannelIds.length.toLocaleString()} selected
                    </strong>
                    <button
                      className="channels-button"
                      type="button"
                      disabled={saving || !allChannelsLoaded}
                      onClick={() => {
                        setActionValue('');
                        setChannelAction('position');
                      }}
                    >
                      Move to position
                    </button>
                    <button
                      className="channels-button"
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setActionValue('');
                        setChannelAction('group');
                      }}
                    >
                      Move to group
                    </button>
                    <button
                      className="channels-button"
                      type="button"
                      disabled={saving}
                      onClick={() => setChannelsShown(pickedChannelIds, false)}
                    >
                      Hide
                    </button>
                    <button
                      className="channels-button"
                      type="button"
                      disabled={saving}
                      onClick={() => setChannelsShown(pickedChannelIds, true)}
                    >
                      Show
                    </button>
                    <button
                      className="channels-button"
                      type="button"
                      disabled={saving}
                      title="Stop counting these channels as missing guide data"
                      onClick={() =>
                        updateChannels(
                          pickedChannelIds,
                          { epgExcluded: true },
                          (count) =>
                            `${plural(count, 'channel')} marked as needing no guide`,
                        )
                      }
                    >
                      No guide needed
                    </button>
                    <button
                      className="channels-text-button"
                      type="button"
                      onClick={() => setPickedChannels(new Set())}
                    >
                      Clear
                    </button>
                  </div>
                )}

                <div className="channels-channel-row channels-channel-head">
                  <span />
                  <input
                    type="checkbox"
                    aria-label="Select every listed channel"
                    checked={
                      listedChannels.length > 0 &&
                      listedChannels.every((channel) =>
                        pickedChannels.has(channel.id),
                      )
                    }
                    onChange={(event) => {
                      const next = new Set(pickedChannels);
                      for (const channel of listedChannels) {
                        if (event.target.checked) next.add(channel.id);
                        else next.delete(channel.id);
                      }
                      setPickedChannels(next);
                    }}
                  />
                  <span className="channels-position">#</span>
                  <span />
                  <span>Channel</span>
                  <span />
                </div>
                <ul className="channels-list">
                  {listedChannels.map((channel) => {
                    const label = channelLabel(channel);
                    const { dragClass, ...dragHandlers } = dragProps(
                      'channel',
                      channel.id,
                      channelIds,
                      pickedChannels,
                      !saving && allChannelsLoaded,
                      commitChannelOrder,
                    );
                    return (
                      <li
                        className={`channels-channel-row${
                          pickedChannels.has(channel.id) ? ' picked' : ''
                        }${channel.enabled ? '' : ' hidden-row'}${dragClass}`}
                        key={channel.id}
                        {...dragHandlers}
                      >
                        <span
                          className="drag-handle"
                          aria-hidden="true"
                          title="Drag to reorder"
                        >
                          <IconGrip />
                        </span>
                        <input
                          type="checkbox"
                          aria-label={`Select ${label}`}
                          checked={pickedChannels.has(channel.id)}
                          onClick={(event) => {
                            shiftHeld.current = event.shiftKey;
                          }}
                          onChange={() =>
                            togglePick(
                              'channel',
                              channel.id,
                              listedChannels.map((listed) => listed.id),
                              pickedChannels,
                              setPickedChannels,
                            )
                          }
                        />
                        <span className="channels-position">
                          {channelIds.indexOf(channel.id) + 1}
                        </span>
                        <ChannelLogo
                          src={channelLogoSource(
                            providerId,
                            channel.id,
                            Boolean(
                              channel.customLogoUrl ?? channel.providerLogoUrl,
                            ),
                          )}
                          name={label}
                        />
                        <span className="channels-name">
                          {label}
                          {channel.providerGroup === selected.name ? null : (
                            <small className="channels-origin">
                              {' '}
                              from {groupLabel(channel.providerGroup)}
                            </small>
                          )}
                        </span>
                        <button
                          className="channels-eye"
                          type="button"
                          aria-label={`${channel.enabled ? 'Hide' : 'Show'} ${label}`}
                          aria-pressed={channel.enabled}
                          disabled={saving}
                          onClick={() =>
                            setChannelsShown([channel.id], !channel.enabled)
                          }
                        >
                          {channel.enabled ? <IconEye /> : <IconEyeOff />}
                        </button>
                      </li>
                    );
                  })}
                  {listedChannels.length === 0 ? (
                    <li className="channels-empty">
                      {loadingDetail
                        ? 'Loading channels…'
                        : channels.length === 0
                          ? 'This group has no channels yet. Tick channels in another group and use “Move to group” to fill it.'
                          : 'No channels match the search.'}
                    </li>
                  ) : null}
                </ul>
              </>
            ) : null}

            {selected.behavior !== 'permanent' ? (
              <div
                className={`channels-events${
                  selected.behavior === 'mixed' ? ' compact' : ''
                }`}
              >
                <div className="channels-toolbar">
                  <small>
                    {plural(eventEntries.length, 'event')} listed by start time
                    {hiddenEventEntries > 0
                      ? ` · ${plural(hiddenEventEntries, 'placeholder')} hidden`
                      : ''}
                    . The list rebuilds on every playlist refresh.
                  </small>
                  {onOpenEvents ? (
                    <button
                      className="channels-button"
                      type="button"
                      onClick={onOpenEvents}
                    >
                      Event rules
                    </button>
                  ) : null}
                </div>
                <div className="channels-event-row channels-channel-head">
                  <span>Starts</span>
                  <span>Shown in player</span>
                  <span>Sent by provider</span>
                </div>
                <ul className="channels-list">
                  {eventEntries.map((entry) => (
                    <li className="channels-event-row" key={entry.id}>
                      <span className="channels-count">
                        {formatEventStart(
                          entry.displayDateTime,
                          entry.timeZone,
                        )}
                      </span>
                      <span className="channels-name">
                        {entry.localizedName}
                      </span>
                      <span className="channels-origin">
                        {entry.originalName}
                      </span>
                    </li>
                  ))}
                  {eventEntries.length === 0 ? (
                    <li className="channels-empty">
                      {loadingDetail
                        ? 'Loading events…'
                        : 'No events are listed for this group right now.'}
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <p className="channels-empty">
            {loadingGroups
              ? 'Loading…'
              : 'Pick a group on the left to see its channels.'}
          </p>
        )}
      </div>
    </section>
  );
}
