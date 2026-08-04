# IPTVMaster

IPTVMaster is a private, self-hosted live-TV playlist and EPG editor designed for TiviMate. It imports changing provider data, preserves permanent channel edits, treats daily sports/event groups as transient snapshots, and publishes clean local M3U/XMLTV endpoints.

The first release is intentionally live-TV only. It does not proxy, relay, transcode, record, or redistribute video.

## Current status

The project is in its first implementation phase. The initial vertical slice provides:

- A streaming M3U parser that separates live entries from VOD/series.
- Event-group policies and placeholder filtering.
- Event-title timezone localization using IANA timezones.
- A small API and browser preview for validating conversions.
- Docker and Proxmox-oriented deployment scaffolding.

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

## Security

Never commit or attach a real provider URL, downloaded playlist, XMLTV feed, database, log, or screenshot containing subscription data. Use only synthetic fixtures in tests and issues. See [SECURITY.md](./SECURITY.md).
