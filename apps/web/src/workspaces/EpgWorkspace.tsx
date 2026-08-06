import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { ChannelLogo } from '../components/ChannelLogo.js';
import { showToast } from '../toast.js';

interface EpgSource {
  id: string;
  name: string;
}

interface EpgWorkspaceProps {
  source: EpgSource | undefined;
  active: boolean;
  onActivityChanged?: () => void;
}

interface EpgGuideChannelSummary {
  id: string;
  displayName: string;
  iconUrl?: string;
  epgSourceId?: string;
  epgSourceName?: string;
}

interface EpgMappingReviewItem {
  channelId: string;
  channelName: string;
  providerGroup: string;
  tvgId?: string;
  status: 'matched' | 'missing' | 'ambiguous' | 'excluded';
  manuallyLocked: boolean;
  epgChannelId?: string;
  epgDisplayName?: string;
  confidence?: number;
  candidateIds: string[];
  candidates?: EpgGuideChannelSummary[];
  separatorLike?: boolean;
  eventLike?: boolean;
  logoUrl?: string;
  epgSourceId?: string;
  epgSourceName?: string;
}

interface EpgMappingReview {
  mappings: EpgMappingReviewItem[];
  matchedCount: number;
  missingCount: number;
  ambiguousCount: number;
  manualCount: number;
  excludedCount: number;
  total: number;
  truncated: boolean;
}

type EpgFilter = 'attention' | 'matched' | 'manual' | 'all' | 'excluded';

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

interface EpgChannelPickerProps {
  sourceId: string;
  disabled: boolean;
  placeholder: string;
  onPick: (channel: EpgGuideChannelSummary) => void;
}

function EpgChannelPicker({
  sourceId,
  disabled,
  placeholder,
  onPick,
}: EpgChannelPickerProps) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<EpgGuideChannelSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [searching, setSearching] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const parameters = new URLSearchParams({ limit: '20' });
          if (query.trim()) parameters.set('search', query.trim());
          const response = await fetch(
            `/api/v1/sources/${sourceId}/epg-channels?${parameters.toString()}`,
          );
          const payload = await readJson<{
            channels: EpgGuideChannelSummary[];
          }>(response);
          setOptions(payload.channels);
          setHighlighted(0);
        } catch {
          setOptions([]);
        } finally {
          setSearching(false);
        }
      })();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, open, sourceId]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function pick(option: EpgGuideChannelSummary | undefined) {
    if (!option) return;
    onPick(option);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((current) => Math.min(current + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(options[highlighted]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="epg-picker" ref={containerRef}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul className="epg-picker-list" role="listbox">
          {searching && options.length === 0 ? (
            <li className="epg-picker-note">Searching…</li>
          ) : null}
          {!searching && options.length === 0 ? (
            <li className="epg-picker-note">No guide channels match.</li>
          ) : null}
          {options.map((option, index) => (
            <li
              key={option.id}
              role="option"
              aria-selected={index === highlighted}
              className={index === highlighted ? 'highlighted' : ''}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(option);
              }}
              onMouseEnter={() => setHighlighted(index)}
            >
              <ChannelLogo url={option.iconUrl} name={option.displayName} />
              <div>
                <strong>{option.displayName}</strong>
                <small>
                  {option.id}
                  {option.epgSourceName ? ` · ${option.epgSourceName}` : ''}
                </small>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function EpgWorkspace({
  source,
  active,
  onActivityChanged,
}: EpgWorkspaceProps) {
  const [review, setReview] = useState<EpgMappingReview | null>(null);
  const [filter, setFilter] = useState<EpgFilter>('attention');
  const [search, setSearch] = useState('');
  const [savingChannel, setSavingChannel] = useState<string | null>(null);
  const [savingBulk, setSavingBulk] = useState(false);
  const [changingMatched, setChangingMatched] = useState<string | null>(null);

  const sourceId = source?.id ?? null;
  const serverView = filter === 'excluded' ? 'excluded' : 'mappable';

  const load = useCallback(
    async (
      id: string,
      view: 'mappable' | 'excluded',
      searchValue: string,
    ): Promise<void> => {
      const parameters = new URLSearchParams({ limit: '200', view });
      if (searchValue.trim()) parameters.set('search', searchValue.trim());
      const response = await fetch(
        `/api/v1/sources/${id}/epg-mappings?${parameters.toString()}`,
      );
      setReview(await readJson<EpgMappingReview>(response));
    },
    [],
  );

  useEffect(() => {
    if (!active || !sourceId) return;
    let stale = false;
    const handle = window.setTimeout(() => {
      void load(sourceId, serverView, search).catch((caught: unknown) => {
        if (!stale) {
          showToast(
            'error',
            caught instanceof Error
              ? caught.message
              : 'Could not load EPG coverage',
          );
        }
      });
    }, 250);
    return () => {
      stale = true;
      window.clearTimeout(handle);
    };
  }, [active, sourceId, serverView, search, load]);

  async function refresh() {
    if (!sourceId) return;
    await load(sourceId, serverView, search);
    onActivityChanged?.();
  }

  async function runMutation(action: () => Promise<void>) {
    try {
      await action();
      await refresh();
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'EPG update failed',
      );
    }
  }

  async function saveMapping(
    channelId: string,
    epgChannelId: string,
    epgSourceId?: string,
  ) {
    if (!sourceId) return;
    setSavingChannel(channelId);
    await runMutation(async () => {
      const response = await fetch(
        `/api/v1/sources/${sourceId}/channels/${channelId}/epg-mapping`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            epgChannelId,
            ...(epgSourceId ? { epgSourceId } : {}),
          }),
        },
      );
      await readJson<{ saved: boolean }>(response);
    });
    setSavingChannel(null);
    setChangingMatched(null);
  }

  async function unlockMapping(channelId: string) {
    if (!sourceId) return;
    setSavingChannel(channelId);
    await runMutation(async () => {
      const response = await fetch(
        `/api/v1/sources/${sourceId}/channels/${channelId}/epg-mapping`,
        { method: 'DELETE' },
      );
      if (!response.ok) await readJson<unknown>(response);
    });
    setSavingChannel(null);
    setChangingMatched(null);
  }

  async function setExclusion(channelIds: string[], excluded: boolean) {
    if (!sourceId || channelIds.length === 0) return;
    setSavingBulk(true);
    await runMutation(async () => {
      const response = await fetch(`/api/v1/sources/${sourceId}/channels`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channelIds: channelIds.slice(0, 500),
          update: { epgExcluded: excluded },
        }),
      });
      await readJson<{ updatedCount: number }>(response);
    });
    setSavingBulk(false);
  }

  if (!active) return null;

  const mappings = review?.mappings ?? [];
  const attentionCount = review
    ? review.missingCount + review.ambiguousCount
    : 0;
  const visible =
    filter === 'attention'
      ? mappings.filter(
          (mapping) =>
            mapping.status === 'missing' || mapping.status === 'ambiguous',
        )
      : filter === 'matched'
        ? mappings.filter((mapping) => mapping.status === 'matched')
        : filter === 'manual'
          ? mappings.filter((mapping) => mapping.manuallyLocked)
          : mappings;
  const separatorSuggestions = mappings.filter(
    (mapping) =>
      (mapping.status === 'missing' || mapping.status === 'ambiguous') &&
      mapping.separatorLike === true,
  );
  const busy = savingBulk || savingChannel !== null;

  const filterChips: Array<{ key: EpgFilter; label: string }> = [
    { key: 'attention', label: `Needs attention (${attentionCount})` },
    { key: 'matched', label: `Matched (${review?.matchedCount ?? 0})` },
    { key: 'manual', label: `Manual (${review?.manualCount ?? 0})` },
    { key: 'excluded', label: `Excluded (${review?.excludedCount ?? 0})` },
    { key: 'all', label: 'All mappable' },
  ];

  return (
    <section className="epg-mapping-review" id="epg-mappings">
      <div className="subsection-heading epg-mapping-heading">
        <div>
          <small>EPG MAPPINGS</small>
          <strong>Pair playlist channels with XMLTV</strong>
        </div>
        {review ? (
          <span className="channel-count">
            {review.matchedCount.toLocaleString()} of{' '}
            {review.total.toLocaleString()} mappable matched
            {review.excludedCount > 0
              ? ` · ${review.excludedCount.toLocaleString()} excluded`
              : ''}
          </span>
        ) : null}
      </div>
      <div className="epg-chips" role="tablist" aria-label="EPG mapping filter">
        {filterChips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            role="tab"
            aria-selected={filter === chip.key}
            className={`epg-chip ${filter === chip.key ? 'active' : ''}`}
            onClick={() => setFilter(chip.key)}
          >
            {chip.label}
          </button>
        ))}
      </div>
      <div className="channel-search epg-live-search">
        <input
          aria-label="Filter playlist channels"
          placeholder="Filter by channel, group, TVG ID, or guide name"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <small>{visible.length.toLocaleString()} shown</small>
      </div>
      {filter !== 'excluded' && separatorSuggestions.length > 0 ? (
        <div className="epg-suggestion">
          <p>
            {separatorSuggestions.length === 1
              ? '1 unmatched channel looks like a decorative separator'
              : `${separatorSuggestions.length} unmatched channels look like decorative separators`}
            {': '}
            {separatorSuggestions
              .slice(0, 6)
              .map((mapping) => mapping.channelName)
              .join(', ')}
            {separatorSuggestions.length > 6 ? ', …' : ''}. Separators never
            carry guide data.
          </p>
          <button
            className="secondary-button compact"
            type="button"
            disabled={busy}
            onClick={() =>
              void setExclusion(
                separatorSuggestions.map((mapping) => mapping.channelId),
                true,
              )
            }
          >
            {savingBulk
              ? 'Excluding…'
              : `Exclude ${separatorSuggestions.length === 1 ? 'it' : `all ${separatorSuggestions.length}`} from EPG`}
          </button>
        </div>
      ) : null}
      <div className="epg-mapping-list" aria-live="polite">
        {visible.map((mapping) => {
          const isSaving = savingChannel === mapping.channelId;
          const isMatched = mapping.status === 'matched';
          const isChanging = changingMatched === mapping.channelId;
          return (
            <article
              className={`epg-mapping-row ${isMatched && !isChanging ? 'compact' : ''}`}
              key={mapping.channelId}
            >
              <ChannelLogo url={mapping.logoUrl} name={mapping.channelName} />
              <div className="epg-playlist-channel">
                <strong>{mapping.channelName}</strong>
                <span>
                  {mapping.providerGroup || '(Ungrouped)'}
                  {mapping.tvgId ? ` · ${mapping.tvgId}` : ''}
                </span>
              </div>
              <span className={`epg-mapping-status ${mapping.status}`}>
                {mapping.manuallyLocked ? 'manual lock' : mapping.status}
              </span>
              {mapping.status === 'excluded' ? (
                <div className="epg-mapping-control">
                  <button
                    className="secondary-button compact"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void setExclusion([mapping.channelId], false)
                    }
                  >
                    Re-include in EPG
                  </button>
                </div>
              ) : isMatched && !isChanging ? (
                <div className="epg-mapping-control epg-matched-control">
                  <small className="epg-mapping-note matched">
                    {mapping.epgDisplayName} · {mapping.epgChannelId}
                    {mapping.epgSourceName ? ` · ${mapping.epgSourceName}` : ''}
                  </small>
                  <button
                    className="secondary-button compact"
                    type="button"
                    disabled={busy}
                    onClick={() => setChangingMatched(mapping.channelId)}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="epg-mapping-control epg-open-control">
                  {mapping.candidates && mapping.candidates.length > 0 ? (
                    <div className="epg-candidates">
                      {mapping.candidates.map((candidate) => (
                        <button
                          key={candidate.id}
                          type="button"
                          className="epg-candidate"
                          disabled={busy}
                          title={`Lock ${mapping.channelName} to ${candidate.displayName}`}
                          onClick={() =>
                            void saveMapping(
                              mapping.channelId,
                              candidate.id,
                              candidate.epgSourceId,
                            )
                          }
                        >
                          <strong>{candidate.displayName}</strong>
                          <small>
                            {candidate.id}
                            {candidate.epgSourceName
                              ? ` · ${candidate.epgSourceName}`
                              : ''}
                          </small>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {sourceId ? (
                    <EpgChannelPicker
                      sourceId={sourceId}
                      disabled={busy && !isSaving}
                      placeholder={isSaving ? 'Saving…' : 'Search XMLTV guide…'}
                      onPick={(channel) =>
                        void saveMapping(
                          mapping.channelId,
                          channel.id,
                          channel.epgSourceId,
                        )
                      }
                    />
                  ) : null}
                  {mapping.manuallyLocked || isChanging ? (
                    <button
                      className="secondary-button compact"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        mapping.manuallyLocked
                          ? void unlockMapping(mapping.channelId)
                          : setChangingMatched(null)
                      }
                    >
                      {mapping.manuallyLocked ? 'Use automatic' : 'Cancel'}
                    </button>
                  ) : null}
                  {!isMatched ? (
                    <button
                      className="secondary-button compact"
                      type="button"
                      title="Exclude this channel from EPG matching and coverage counts"
                      disabled={busy}
                      onClick={() =>
                        void setExclusion([mapping.channelId], true)
                      }
                    >
                      No EPG
                    </button>
                  ) : null}
                </div>
              )}
              {mapping.status === 'excluded' ? (
                <small className="epg-mapping-note">
                  Excluded from EPG matching and coverage counts.
                </small>
              ) : mapping.eventLike ? (
                <small className="epg-mapping-note">
                  Looks like a live-event stream. Mark its provider group as an
                  event group in the Live events workspace instead of mapping
                  guide data.
                </small>
              ) : mapping.status === 'ambiguous' ? (
                <small className="epg-mapping-note">
                  Multiple guide channels share the same normalized identity.
                  Pick the correct one above.
                </small>
              ) : null}
            </article>
          );
        })}
        {review && visible.length === 0 ? (
          <p className="empty-groups">
            {filter === 'excluded'
              ? 'No channels are excluded from EPG matching.'
              : filter === 'attention'
                ? review.total === 0
                  ? 'Import the playlist and XMLTV guide from Overview first.'
                  : 'Every mappable channel has guide data. Nothing needs attention.'
                : 'No channels match this filter or search.'}
          </p>
        ) : null}
        {review === null ? (
          <p className="empty-groups">Loading EPG coverage…</p>
        ) : null}
      </div>
      {review?.truncated ? (
        <small className="channel-limit-note">
          Showing the first 200 channels for this filter. Narrow the search to
          see the rest.
        </small>
      ) : null}
    </section>
  );
}
