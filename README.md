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
- Retained playlist history with two-step restoration, automatic reactivation on a later provider refresh, and a user-visible activity trail.
- Persistent group rules that apply Stockholm-to-Helsinki conversion only to selected live-event groups.
- An event-rule editor and review that show provider/Finnish labels side by side, expose parse warnings and placeholders, and order each event group by calculated Finnish start time.
- Persistent EPG reconciliation that pairs exact TVG IDs and unique normalized names automatically, reports missing/ambiguous coverage, and supports audited manual XMLTV locks that survive guide refreshes.
- First-run single-administrator setup with scrypt password hashing, revocable database-backed sessions, CSRF checks, login throttling, and a dedicated sign-in screen.
- Persistent permanent-channel reconciliation using provider IDs, TVG IDs, and normalized name/group fallbacks, with ambiguous matches left unresolved.
- An expandable permanent-group editor with direct visibility toggles, hidden-group filtering, reusable custom categories, and drag-and-drop group/channel ordering, plus per-channel rename, regroup, logo, and ordering overrides.
- A provider-change review queue for missing or ambiguous permanent channels, with conservative manual matching, match locks, and an audit trail.
- Token-protected, revocable M3U/XMLTV output URLs for TiviMate, including one combined output assembled from multiple providers.
- Non-overlapping automatic playlist refreshes, enabled every 120 minutes by default.
- Streaming XMLTV parsing with bounded downloads and transactional last-known-good EPG replacement.
- Non-overlapping automatic EPG refreshes, enabled every 12 hours by default.
- Bounded exponential retries for transient provider/network failures, without retrying bad credentials or malformed feeds.
- Daily expired-session cleanup; accepted XMLTV guides replace their predecessors transactionally instead of accumulating stale rows.
- Verified PostgreSQL backup and transactional restore scripts, with checksum validation, retention, and a daily Proxmox systemd timer.
- Transactional, checksum-verified SQL migrations that gate application startup on both fresh and existing release-managed databases.
- Immutable versioned container builds with embedded health metadata and a private GHCR tag workflow.
- A small API and browser UI for encrypted setup, playlist imports, group rules, permanent-channel editing, and output creation.
- Docker and Proxmox-oriented deployment scaffolding.

The editor is protected by the local administrator account. Generated TiviMate URLs remain independently protected by their revocable output token. Keep the service LAN-only even with authentication enabled.

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

1. Open the web UI from a LAN address that the Nvidia Shield can reach and create the one local administrator account. The password must be at least 12 characters.
2. Save the provider M3U URL and optional XMLTV URL. They are encrypted before database storage and are not displayed again. Add further providers from the same screen whenever needed.
3. Import the live playlist and XMLTV guide. VOD and series entries are skipped.
4. Filter the provider groups and mark only daily live-event groups as events. Edit their output group, placeholder patterns, timezones, and numeric date order, then review provider and Finnish labels side by side. Ordinary live TV stays unchanged.
5. Filter and expand permanent provider groups. Use the visibility toggle, make reusable custom categories, and drag groups or their fully loaded channels into the desired order; then use the expanded channel list for individual overrides. These edits are retained when a later provider snapshot can be matched safely.
6. If a refresh reports missing or ambiguous channels, use the provider-change review to choose a current provider entry. The original channel identity and edits are preserved and the manual match is locked until explicitly unlocked.
7. Review update history after imports. If an accepted provider playlist is bad, restore a retained snapshot; current channel overrides are reconciled against it and the action is audited.
8. Review EPG mappings. Safe exact-ID/name matches are automatic; search the XMLTV channel list and lock a manual choice only for missing or ambiguous channels.
9. Create the TiviMate URLs, selecting one or more providers for a combined output when appropriate, and copy both the M3U playlist and XMLTV EPG addresses immediately. Combined outputs namespace guide IDs internally to prevent cross-provider EPG collisions. Only the shared token's SHA-256 hash is stored, so the complete URLs cannot be shown again later.
10. Revoke the URL from the same setup session if it is exposed. A revoked token returns `404`.

The generated playlist contains direct provider stream URLs, so playback traffic goes from the Shield to the provider rather than through IPTVMaster.

Playlist automation starts 30 seconds after the application and then runs every 120 minutes. EPG automation starts after 60 seconds and runs every 720 minutes. Override the `PLAYLIST_REFRESH_*` and `EPG_REFRESH_*` values in `.env`, or set the corresponding `*_ENABLED=false` value to disable a scheduler. Overlapping manual and scheduled imports for the same source are coalesced, and a rejected/failed refresh leaves the last-known-good playlist or guide active.

Each provider download is attempted up to three times by default, with bounded exponential delay. Only timeouts, network interruptions, HTTP throttling, and server errors are retried; authentication failures, missing feeds, malformed content, and snapshot validation failures stop immediately. Configure this with `PROVIDER_RETRY_*`. Daily `MAINTENANCE_*` automation removes expired administrator sessions. Playlist history remains retained for deliberate rollback, while each accepted XMLTV guide transactionally replaces the previous guide rows.

## Backup and restore

Create a verified PostgreSQL archive and SHA-256 sidecar:

```sh
./scripts/backup-postgres.sh
```

Backups default to `./backups` with 14-day retention. They contain encrypted provider data and must still be treated as sensitive. The database does not contain `IPTVMASTER_MASTER_KEY`; keep that key backed up separately or the restored provider configuration cannot be decrypted.

Restore an archive with an explicit confirmation prompt:

```sh
./scripts/restore-postgres.sh ./backups/iptvmaster-YYYYMMDDTHHMMSSZ.dump
```

The restore verifies the checksum and archive, stops the app to prevent imports, restores in a single transaction, restarts the app, and waits for a healthy response. See [docs/PROXMOX_INSTALL.md](./docs/PROXMOX_INSTALL.md) for the daily timer and recovery rehearsal.

Release tags, pinned image deployment, upgrades, and the two rollback paths are documented in [docs/RELEASES.md](./docs/RELEASES.md). Do not deploy a floating `latest` image or edit an applied SQL migration.

## Security

Never commit or attach a real provider URL, downloaded playlist, XMLTV feed, database, log, or screenshot containing subscription data. Use only synthetic fixtures in tests and issues. See [SECURITY.md](./SECURITY.md).
