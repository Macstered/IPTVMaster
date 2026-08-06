# IPTVMaster

IPTVMaster is a private, self-hosted manager for live-TV playlists and EPG
data. It sits between your IPTV provider and your player: it imports the
provider's changing M3U and XMLTV feeds on a schedule, preserves your permanent
edits across those changes, and publishes clean, token-protected playlist and
guide URLs that any IPTV player can consume.

It is intentionally live-TV only. It does not proxy, relay, transcode, record,
or redistribute video — published playlists contain direct provider stream
URLs, so playback traffic never passes through IPTVMaster.

## What it does

**Lineup editing that survives provider refreshes**

- Rename provider groups, build custom categories, and reorder groups and
  channels with drag or keyboard/touch-friendly arrow buttons.
- Per-channel renames, logos, visibility, and ordering, with bulk selection
  tools for large playlists.
- Provider changes are reconciled conservatively: safe matches follow
  automatically, uncertain ones go to a review queue with an audit trail, and
  manual matches are locked until you release them.

**Daily live-event groups**

- Mark transient sports/event groups as events (individually or in bulk).
  Event entries are localized from the provider timezone to yours, sorted by
  start time, and placeholder entries ("please reload your playlist") are
  hidden by pattern.
- Publish or hide whole event groups with one click.

**A shared EPG pool**

- Provider guides and any number of custom XMLTV guides are imported into one
  pool that every provider's channels can map against.
- Exact-ID and unique-name matches are automatic, with the provider's own
  guide always taking priority; ambiguous channels show their real candidates
  for one-click resolution, and a type-ahead picker searches the whole pool.
- Channels that can never have guide data (decorative separators, event
  streams) can be excluded from coverage counting — separators are detected
  and offered as a one-click bulk exclusion.

**Operations**

- A status board shows per-provider channel counts, EPG coverage, last
  refresh results, and anything that needs your attention.
- Non-overlapping scheduled refreshes with bounded retries; rejected or failed
  feeds leave the last-known-good data active.
- Retained playlist snapshots with two-step restore and a full activity log.
- Verified PostgreSQL backups with a daily systemd timer and rehearsable
  transactional restore.

**Security posture**

- Single local administrator account (scrypt, database-backed revocable
  sessions, CSRF protection, login throttling).
- Provider and guide URLs are encrypted with AES-256-GCM before storage and
  never displayed again.
- Output URLs are long random tokens, individually revocable; only their
  hashes are stored for verification.
- Designed for trusted LAN use over a stable local address: no DNS entry,
  domain, or certificate required. Keep it off the public internet — see
  [SECURITY.md](./SECURITY.md). If your network is shared more widely, an
  optional overlay adds HTTPS; see [docs/HTTPS.md](./docs/HTTPS.md).

## Requirements

- Docker with the Compose plugin (deployment), or Node.js 22+ and npm 10+
  (development)
- PostgreSQL 17 (provided by the compose stack)

## Quick start

```sh
cp .env.example .env
# set POSTGRES_PASSWORD and IPTVMASTER_MASTER_KEY (openssl rand -base64 32)
docker compose up --build -d
```

Open `http://localhost:8080`, create the administrator account, add your
provider's M3U (and optional XMLTV) URL, import, and shape the lineup. Then
create output URLs and point your IPTV player at the generated `/m/<token>`
playlist and `/e/<token>` guide addresses.

Losing `IPTVMASTER_MASTER_KEY` makes stored provider credentials
unrecoverable; back it up separately and never commit it.

## Development

```sh
npm install
npm run dev      # core watcher, API on :8080, Vite UI on :5173
npm run check    # format, lint, versions, typecheck, tests, build
```

## Documentation

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — how the pieces fit together
- [docs/PROXMOX_INSTALL.md](./docs/PROXMOX_INSTALL.md) — production VM runbook
  (backups, upgrades, rollback)
- [docs/HTTPS.md](./docs/HTTPS.md) — optional TLS deployment
- [docs/DEPLOY.md](./docs/DEPLOY.md) — pushing a build to a LAN host over SSH
- [docs/RELEASES.md](./docs/RELEASES.md) — versioned images and GHCR releases
- [SECURITY.md](./SECURITY.md) — threat model and reporting

## License

Licensed under the [GNU Affero General Public License v3.0](./LICENSE).

In short: you may use, modify, and redistribute IPTVMaster, but modified
versions must remain open source under the same license — including versions
you run as a network service for others.
