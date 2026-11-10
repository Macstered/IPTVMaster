import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { CopyField } from '../components/CopyField.js';
import { errorMessage, readJson } from '../readJson.js';
import { showToast } from '../toast.js';

type MediaType = 'live' | 'vod' | 'series';

interface OutputProfile {
  id: string;
  name: string;
  sourceIds: string[];
  mediaTypes?: MediaType[];
  recoverable: boolean;
  accessToken?: string;
}

interface PlayerLinksWorkspaceProps {
  active: boolean;
  sources: readonly { id: string; name: string }[];
}

const MEDIA_TYPES: ReadonlyArray<[MediaType, string]> = [
  ['live', 'Live TV'],
  ['vod', 'Movies'],
  ['series', 'Series'],
];

const MEDIA_LABELS: Record<MediaType, string> = {
  live: 'Live TV',
  vod: 'Movies',
  series: 'Series',
};

/** Private, revocable links a player uses to load the playlist and guide. */
export function PlayerLinksWorkspace({
  active,
  sources,
}: PlayerLinksWorkspaceProps) {
  const [profiles, setProfiles] = useState<OutputProfile[] | null>(null);
  const [name, setName] = useState('My playlist');
  const [mediaTypes, setMediaTypes] = useState<MediaType[]>(['live']);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/v1/output-profiles');
    const payload = await readJson<{ profiles: OutputProfile[] }>(response);
    setProfiles(payload.profiles);
  }, []);

  useEffect(() => {
    if (!active) return;
    void load().catch((caught: unknown) =>
      showToast('error', errorMessage(caught, 'Could not load player links')),
    );
  }, [active, load]);

  if (!active) return null;

  // Until a provider is ticked by hand, a new link covers the first one.
  const sourceIds = (picked ?? sources.slice(0, 1).map((s) => s.id)).filter(
    (id) => sources.some((source) => source.id === id),
  );

  async function create(event: FormEvent) {
    event.preventDefault();
    if (sourceIds.length === 0) return;
    setBusy(true);
    try {
      const response = await fetch('/api/v1/output-profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceIds,
          name: name.trim() || 'My playlist',
          mediaTypes,
        }),
      });
      await readJson<unknown>(response);
      showToast('success', 'Player link created');
      await load();
    } catch (caught) {
      showToast('error', errorMessage(caught, 'Could not create the link'));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(profile: OutputProfile) {
    setConfirming(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/output-profiles/${profile.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) await readJson<unknown>(response);
      showToast('success', `${profile.name} revoked`);
      await load();
    } catch (caught) {
      showToast('error', errorMessage(caught, 'Could not revoke the link'));
    } finally {
      setBusy(false);
    }
  }

  function toggleMedia(kind: MediaType) {
    setMediaTypes((current) =>
      current.includes(kind)
        ? // Never leave a link carrying nothing.
          current.length > 1
          ? current.filter((candidate) => candidate !== kind)
          : current
        : [...current, kind],
    );
  }

  function toggleSource(id: string) {
    setPicked(
      sourceIds.includes(id)
        ? sourceIds.filter((candidate) => candidate !== id)
        : [...sourceIds, id],
    );
  }

  const origin = window.location.origin;

  return (
    <div className="ui-page">
      <section className="ui-section">
        <h2>Your links</h2>
        {profiles === null ? <p className="ui-note">Loading…</p> : null}
        {profiles?.length === 0 ? (
          <div className="ui-card ui-row ui-soft">
            No player link yet. Create one below, then paste it into your
            player.
          </div>
        ) : null}
        {(profiles ?? []).map((profile) => {
          const kinds = profile.mediaTypes ?? ['live'];
          const playlist = `${origin}/m/${profile.accessToken ?? ''}`;
          const providers = profile.sourceIds
            .map(
              (id) =>
                sources.find((source) => source.id === id)?.name ??
                'Removed provider',
            )
            .join(' + ');
          return (
            <article className="ui-card" key={profile.id}>
              <div className="ui-row">
                <div className="ui-grow">
                  <div className="ui-status">
                    <div className="ui-title">{profile.name}</div>
                    {kinds.map((kind) => (
                      <span className="ui-pill" key={kind}>
                        {MEDIA_LABELS[kind]}
                      </span>
                    ))}
                  </div>
                  <div className="ui-soft">{providers}</div>
                </div>
                {confirming === profile.id ? (
                  <>
                    <span className="ui-soft">
                      Players using this link stop working.
                    </span>
                    <button
                      className="ui-button danger"
                      type="button"
                      disabled={busy}
                      onClick={() => void revoke(profile)}
                    >
                      Revoke permanently
                    </button>
                    <button
                      className="ui-button"
                      type="button"
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="ui-button quiet danger"
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirming(profile.id)}
                  >
                    Revoke
                  </button>
                )}
              </div>
              {profile.recoverable && profile.accessToken ? (
                <div className="ui-stack">
                  <CopyField
                    id={`link-playlist-${profile.id}`}
                    label={
                      kinds.length > 1
                        ? 'Playlist (M3U), everything in one'
                        : 'Playlist (M3U)'
                    }
                    value={playlist}
                  />
                  {kinds.length > 1
                    ? kinds.map((kind) => (
                        <CopyField
                          key={kind}
                          id={`link-playlist-${profile.id}-${kind}`}
                          label={`Playlist (M3U), ${MEDIA_LABELS[kind]} only`}
                          value={`${playlist}/${kind === 'vod' ? 'movies' : kind}`}
                        />
                      ))
                    : null}
                  {kinds.includes('live') ? (
                    <CopyField
                      id={`link-guide-${profile.id}`}
                      label="Guide (XMLTV)"
                      value={`${origin}/e/${profile.accessToken}`}
                    />
                  ) : null}
                  <details className="ui-details">
                    <summary>
                      Xtream login
                      {kinds.includes('vod') || kinds.includes('series')
                        ? ' (recommended for movies and series)'
                        : ''}
                    </summary>
                    <div className="ui-stack">
                      <p className="ui-note">
                        Add an Xtream Codes playlist in your player with these
                        details. Series arrive as a compact list of shows, and
                        episodes load only when the player asks for one.
                      </p>
                      <CopyField
                        id={`link-xtream-server-${profile.id}`}
                        label="Server address"
                        value={origin}
                      />
                      <CopyField
                        id={`link-xtream-username-${profile.id}`}
                        label="Username"
                        value="iptvmaster"
                      />
                      <CopyField
                        id={`link-xtream-password-${profile.id}`}
                        label="Password"
                        value={profile.accessToken}
                      />
                    </div>
                  </details>
                </div>
              ) : (
                <div className="ui-row ui-soft">
                  This older link still works but cannot be shown again. Create
                  a new one, update your player, then revoke this one.
                </div>
              )}
            </article>
          );
        })}
        <p className="ui-note">
          Links work like passwords: anyone who has one can load your playlist.
          Revoke a link to cut it off.
        </p>
      </section>

      <section className="ui-section">
        <h2>New link</h2>
        <form
          className="ui-card ui-stack"
          onSubmit={(event) => void create(event)}
        >
          <div className="ui-field">
            <label htmlFor="link-name">Name</label>
            <input
              id="link-name"
              className="ui-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="ui-field">
            <span className="ui-label">Carries</span>
            <div className="ui-chips">
              {MEDIA_TYPES.map(([kind, label]) => (
                <button
                  className="ui-chip"
                  type="button"
                  aria-pressed={mediaTypes.includes(kind)}
                  onClick={() => toggleMedia(kind)}
                  key={kind}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="ui-muted">
              A link for live TV alone keeps the playlist small. Add movies and
              series only for a player that uses them.
            </span>
          </div>
          {sources.length > 1 ? (
            <div className="ui-field">
              <span className="ui-label">Providers</span>
              <div className="ui-chips">
                {sources.map((source) => (
                  <label className="ui-check" key={source.id}>
                    <input
                      type="checkbox"
                      checked={sourceIds.includes(source.id)}
                      onChange={() => toggleSource(source.id)}
                    />
                    {source.name}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <div>
            <button
              className="ui-button primary"
              type="submit"
              disabled={busy || sourceIds.length === 0}
            >
              {busy ? 'Working…' : 'Create link'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
