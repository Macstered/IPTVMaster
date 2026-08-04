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
- Persistent permanent-channel reconciliation using provider IDs, TVG IDs, and normalized name/group fallbacks, with ambiguous matches left unresolved.
- A searchable channel editor for hide/show, rename, regroup, logo, and ordering overrides, including bulk visibility and group actions.
- A provider-change review queue for missing or ambiguous permanent channels, with conservative manual matching, match locks, and an audit trail.
- Token-protected, revocable M3U output URLs for TiviMate.
- Non-overlapping automatic playlist refreshes, enabled every 120 minutes by default.
- Streaming XMLTV parsing with bounded downloads and transactional last-known-good EPG replacement.
- Non-overlapping automatic EPG refreshes, enabled every 12 hours by default.
- A small API and browser UI for encrypted setup, playlist imports, group rules, permanent-channel editing, and output creation.
- Docker and Proxmox-oriented deployment scaffolding.

Administrator authentication remains a future milestone; the current slice is intended for LAN-only evaluation.

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
3. Import the live playlist and XMLTV guide. VOD and series entries are skipped.
4. Filter the provider groups and mark only daily live-event groups as events. Edit their output group, placeholder patterns, timezones, and numeric date order, then review provider and Finnish labels side by side. Ordinary live TV stays unchanged.
5. Search the permanent-channel list and apply individual or bulk visibility/group overrides. Name, group, logo, and order edits are retained when a later provider snapshot can be matched safely.
6. If a refresh reports missing or ambiguous channels, use the provider-change review to choose a current provider entry. The original channel identity and edits are preserved and the manual match is locked until explicitly unlocked.
7. Review update history after imports. If an accepted provider playlist is bad, restore a retained snapshot; current channel overrides are reconciled against it and the action is audited.
8. Create the TiviMate URLs and copy both the M3U playlist and XMLTV EPG addresses immediately. Only the shared token's SHA-256 hash is stored, so the complete URLs cannot be shown again later.
9. Revoke the URL from the same setup session if it is exposed. A revoked token returns `404`.

The generated playlist contains direct provider stream URLs, so playback traffic goes from the Shield to the provider rather than through IPTVMaster.

Playlist automation starts 30 seconds after the application and then runs every 120 minutes. EPG automation starts after 60 seconds and runs every 720 minutes. Override the `PLAYLIST_REFRESH_*` and `EPG_REFRESH_*` values in `.env`, or set the corresponding `*_ENABLED=false` value to disable a scheduler. Overlapping manual and scheduled imports for the same source are coalesced, and a rejected/failed refresh leaves the last-known-good playlist or guide active.

## Security

Never commit or attach a real provider URL, downloaded playlist, XMLTV feed, database, log, or screenshot containing subscription data. Use only synthetic fixtures in tests and issues. See [SECURITY.md](./SECURITY.md).
