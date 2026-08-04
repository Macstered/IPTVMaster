# IPTVMaster

IPTVMaster is a private, self-hosted live-TV playlist and EPG editor designed for TiviMate. It imports changing provider data, preserves permanent channel edits, treats daily sports/event groups as transient snapshots, and publishes clean local M3U/XMLTV endpoints.

The first release is intentionally live-TV only. It does not proxy, relay, transcode, record, or redistribute video.

## Current status

The project is in its first implementation phase. The initial vertical slice provides:

- A streaming M3U parser that separates live entries from VOD/series.
- Event-group policies and placeholder filtering.
- Event-title timezone localization using IANA timezones.
- AES-256-GCM encrypted provider source storage in PostgreSQL.
- A live-only remote playlist inspection flow with bounded streaming downloads.
- Transactional last-known-good snapshots with encrypted stream URLs and unchanged-feed detection.
- Persistent group rules that apply Stockholm-to-Helsinki conversion only to selected live-event groups.
- Token-protected, revocable M3U output URLs for TiviMate.
- Non-overlapping automatic playlist refreshes, enabled every 120 minutes by default.
- A small API and browser UI for encrypted setup, playlist imports, group rules, and output creation.
- Docker and Proxmox-oriented deployment scaffolding.

XMLTV ingestion, automatic EPG refreshes, and XMLTV publication are the next implementation milestone.

See [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) for the complete delivery plan.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Docker with the Compose plugin for containerized development/deployment

## Local development

```sh
npm install
npm run dev
```

The API listens on `http://localhost:8080` and the Vite development UI on `http://localhost:5173`.

Run all verification checks:

```sh
npm run check
```

## Docker

Copy `.env.example` to `.env`, replace the database password, then run:

```sh
docker compose up --build
```

Open `http://localhost:8080`.

Replace `IPTVMASTER_MASTER_KEY` with the output of `openssl rand -base64 32` before starting the stack. Losing this key makes stored provider credentials unrecoverable; committing it would expose them.

## First-use workflow

1. Open the web UI from a LAN address that the Nvidia Shield can reach.
2. Save the provider M3U URL and optional XMLTV URL. They are encrypted before database storage and are not displayed again.
3. Import the live playlist. VOD and series entries are skipped.
4. Filter the provider groups and mark only daily live-event groups as events. Those groups use `Europe/Stockholm` to `Europe/Helsinki` title conversion; ordinary live TV stays unchanged.
5. Create the TiviMate URL and copy it immediately. Only its SHA-256 hash is stored, so the complete URL cannot be shown again later.
6. Revoke the URL from the same setup session if it is exposed. A revoked token returns `404`.

The generated playlist contains direct provider stream URLs, so playback traffic goes from the Shield to the provider rather than through IPTVMaster.

Playlist automation starts 30 seconds after the application and then runs every 120 minutes. Override `PLAYLIST_REFRESH_INTERVAL_MINUTES` and `PLAYLIST_REFRESH_INITIAL_DELAY_SECONDS` in `.env`, or set `PLAYLIST_REFRESH_ENABLED=false` to disable it. Overlapping manual and scheduled imports for the same source are coalesced, and a rejected/failed refresh leaves the last-known-good snapshot active.

## Security

Never commit or attach a real provider URL, downloaded playlist, XMLTV feed, database, log, or screenshot containing subscription data. Use only synthetic fixtures in tests and issues. See [SECURITY.md](./SECURITY.md).
