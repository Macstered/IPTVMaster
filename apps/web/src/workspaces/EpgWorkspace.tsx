import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

import {
  channelLogoSource,
  guideLogoSource,
  ChannelLogo,
} from '../components/ChannelLogo.js';
import { showToast } from '../toast.js';

interface EpgSource {
  id: string;
  name: string;
}

interface EpgWorkspaceProps {
  source: EpgSource | undefined;
  active: boolean;
  /** Where the page draws its main action: beside the page title. */
  actionSlot: HTMLElement | null;
  onOpenProviders: () => void;
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
        className="ui-input"
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
              <ChannelLogo
                src={guideLogoSource(
                  option.epgSourceId,
                  option.id,
                  Boolean(option.iconUrl),
                )}
                name={option.displayName}
              />
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
  actionSlot,
  onOpenProviders,
  onActivityChanged,
}: EpgWorkspaceProps) {
  const [review, setReview] = useState<EpgMappingReview | null>(null);
  const [filter, setFilter] = useState<EpgFilter>('attention');
  const [search, setSearch] = useState('');
  const [savingChannel, setSavingChannel] = useState<string | null>(null);
  const [savingBulk, setSavingBulk] = useState(false);
  const [changingMatched, setChangingMatched] = useState<string | null>(null);

  const sourceId = source?.id ?? null;
  // The server filters before it limits, so each view finds its own rows.
  const serverView = filter === 'all' ? 'mappable' : filter;

  const load = useCallback(
    async (
      id: string,
      view: 'mappable' | Exclude<EpgFilter, 'all'>,
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
  const visible = mappings;
  const separatorSuggestions = mappings.filter(
    (mapping) =>
      (mapping.status === 'missing' || mapping.status === 'ambiguous') &&
      mapping.separatorLike === true,
  );
  const busy = savingBulk || savingChannel !== null;

  const filterChips: Array<{ key: EpgFilter; label: string }> = [
    {
      key: 'attention',
      label: `Needs attention ${attentionCount.toLocaleString()}`,
    },
    {
      key: 'matched',
      label: `Matched ${(review?.matchedCount ?? 0).toLocaleString()}`,
    },
    {
      key: 'manual',
      label: `Set by you ${(review?.manualCount ?? 0).toLocaleString()}`,
    },
    {
      key: 'excluded',
      label: `No guide needed ${(review?.excludedCount ?? 0).toLocaleString()}`,
    },
    { key: 'all', label: 'All' },
  ];
  const coverage =
    review && review.total > 0 ? review.matchedCount / review.total : 0;

  return (
    <div className="ui-page guide-page" id="epg-mappings">
      {actionSlot
        ? createPortal(
            <button
              className="ui-button"
              type="button"
              onClick={onOpenProviders}
            >
              Guide sources
            </button>,
            actionSlot,
          )
        : null}

      {review ? (
        <div className="ui-status ui-soft">
          <div className="ui-meter guide-meter">
            <div style={{ width: `${Math.round(coverage * 100)}%` }} />
          </div>
          <span>
            {review.matchedCount.toLocaleString()} of{' '}
            {review.total.toLocaleString()} channels have guide data
            {review.excludedCount > 0
              ? `, ${review.excludedCount.toLocaleString()} more need none`
              : ''}
          </span>
        </div>
      ) : null}

      <div className="guide-filters">
        <div className="ui-chips" role="group" aria-label="Which channels">
          {filterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="ui-chip"
              aria-pressed={filter === chip.key}
              onClick={() => setFilter(chip.key)}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <input
          className="ui-input"
          type="search"
          aria-label="Find a channel"
          placeholder="Find a channel, group or guide ID"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {filter !== 'excluded' && separatorSuggestions.length > 0 ? (
        <div className="ui-card ui-row guide-suggestion">
          <div className="ui-grow">
            <div className="ui-title">
              {separatorSuggestions.length === 1
                ? '1 of these looks like a separator'
                : `${separatorSuggestions.length.toLocaleString()} of these look like separators`}
            </div>
            <div>
              Names like{' '}
              {separatorSuggestions
                .slice(0, 3)
                .map((mapping) => mapping.channelName)
                .join(', ')}{' '}
              never carry guide data.
            </div>
          </div>
          <button
            className="ui-button primary"
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
              ? 'Marking…'
              : separatorSuggestions.length === 1
                ? 'Mark it as no guide needed'
                : `Mark all ${separatorSuggestions.length.toLocaleString()} as no guide needed`}
          </button>
        </div>
      ) : null}

      <div className="ui-card">
        <div className="guide-table" aria-live="polite">
          <div className="guide-row guide-head">
            <span />
            <span>Channel</span>
            <span>Group</span>
            <span>Guide channel</span>
            <span />
          </div>
          {visible.map((mapping) => {
            const isSaving = savingChannel === mapping.channelId;
            const isMatched = mapping.status === 'matched';
            const isExcluded = mapping.status === 'excluded';
            const isChanging = changingMatched === mapping.channelId;
            const settled = isExcluded || (isMatched && !isChanging);
            return (
              <div className="guide-row" key={mapping.channelId}>
                <ChannelLogo
                  src={channelLogoSource(
                    sourceId ?? undefined,
                    mapping.channelId,
                    Boolean(mapping.logoUrl),
                  )}
                  name={mapping.channelName}
                />
                <span className="ui-clip ui-strong" title={mapping.tvgId}>
                  {mapping.channelName}
                </span>
                <span className="ui-clip ui-muted">
                  {mapping.providerGroup || '(Ungrouped)'}
                </span>
                <div className="guide-match">
                  {isExcluded ? (
                    <span className="ui-muted">No guide needed</span>
                  ) : settled ? (
                    <span className="ui-clip">
                      {mapping.epgDisplayName}
                      <span className="ui-muted">
                        {' '}
                        · {mapping.epgChannelId}
                        {mapping.epgSourceName
                          ? ` · ${mapping.epgSourceName}`
                          : ''}
                        {mapping.manuallyLocked ? ' · set by you' : ''}
                      </span>
                    </span>
                  ) : (
                    <>
                      {mapping.candidates && mapping.candidates.length > 0 ? (
                        <div className="guide-candidates">
                          <span className="ui-warn-text">
                            {mapping.candidates.length} possible
                          </span>
                          {mapping.candidates.map((candidate) => (
                            <button
                              key={candidate.id}
                              type="button"
                              className="ui-button small"
                              disabled={busy}
                              title={`Use ${candidate.displayName}${
                                candidate.epgSourceName
                                  ? ` from ${candidate.epgSourceName}`
                                  : ''
                              } for ${mapping.channelName}`}
                              onClick={() =>
                                void saveMapping(
                                  mapping.channelId,
                                  candidate.id,
                                  candidate.epgSourceId,
                                )
                              }
                            >
                              {candidate.id}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {sourceId ? (
                        <EpgChannelPicker
                          sourceId={sourceId}
                          disabled={busy && !isSaving}
                          placeholder={
                            isSaving ? 'Saving…' : 'Search all guides'
                          }
                          onPick={(channel) =>
                            void saveMapping(
                              mapping.channelId,
                              channel.id,
                              channel.epgSourceId,
                            )
                          }
                        />
                      ) : null}
                      {mapping.eventLike ? (
                        <small className="ui-muted">
                          Looks like a live event. Mark its group as live events
                          under Channels instead of matching a guide.
                        </small>
                      ) : null}
                    </>
                  )}
                </div>
                <div className="guide-actions">
                  {isExcluded ? (
                    <button
                      className="ui-button quiet"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void setExclusion([mapping.channelId], false)
                      }
                    >
                      Needs a guide
                    </button>
                  ) : settled ? (
                    <button
                      className="ui-button quiet"
                      type="button"
                      disabled={busy}
                      onClick={() => setChangingMatched(mapping.channelId)}
                    >
                      Change
                    </button>
                  ) : (
                    <>
                      {mapping.manuallyLocked || isChanging ? (
                        <button
                          className="ui-button quiet"
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
                          className="ui-button quiet"
                          type="button"
                          title="Leave this channel out of guide matching and the coverage count"
                          disabled={busy}
                          onClick={() =>
                            void setExclusion([mapping.channelId], true)
                          }
                        >
                          No guide needed
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {review && visible.length === 0 ? (
            <div className="ui-row ui-soft">
              {filter === 'excluded'
                ? 'No channels are marked as needing no guide.'
                : filter === 'attention'
                  ? review.total === 0
                    ? 'Refresh the playlist and the guide on the Providers page first.'
                    : 'Every channel has guide data. Nothing needs attention.'
                  : 'No channels match this filter or search.'}
            </div>
          ) : null}
          {review === null ? (
            <div className="ui-row ui-soft">Loading…</div>
          ) : null}
          {review?.truncated ? (
            <div className="ui-row ui-muted">
              Showing the first 200 channels. Search to narrow the list.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
