# Contributing

Thanks for taking a look. IPTVMaster is a small self-hosted tool, so the bar
is practical: changes should keep it safe to run on a home network and easy to
operate without reading the source.

## Ground rules

**Never include real provider data.** Provider URLs contain credentials in
query strings and stream paths. Do not paste playlists, XMLTV files, database
dumps, logs, or screenshots containing them into issues, pull requests, or
tests. Use synthetic fixtures — see the existing ones in
`packages/core/src/*.test.ts`.

**Scope.** IPTVMaster manages playlists and guide data. It deliberately does
not proxy, relay, transcode, record, or redistribute video, and pull requests
adding those capabilities will not be merged.

## Development setup

```sh
npm install
npm run dev      # core watcher, API on :8080, Vite UI on :5173
```

The API starts without a database and reports reduced capabilities; the UI
shows what is unavailable. For the full experience run the stack:

```sh
cp .env.example .env
# set POSTGRES_PASSWORD and IPTVMASTER_MASTER_KEY (openssl rand -base64 32)
docker compose up --build -d
```

To develop against realistic data without a real provider, serve a synthetic
M3U and XMLTV over HTTP locally and point a provider at that URL.

## Before opening a pull request

```sh
npm run check
```

That runs formatting, lint, version verification, typecheck, tests, and the
build — the same gate CI applies. Please also:

- Add or update tests for behavior changes. API behavior is covered through
  `apps/api/src/app.test.ts` against an in-memory repository; parsing and
  policy logic is covered in `packages/core`.
- Keep database changes as a new numbered, forward-only migration in
  `deploy/postgres/init/`. Migrations are checksum-verified, so never edit one
  that has shipped.
- Preserve the security properties described in [SECURITY.md](./SECURITY.md):
  secrets stay encrypted at rest and out of logs and responses, editor routes
  stay behind the session and CSRF checks, and output tokens remain revocable.

## Code style

Formatting and lint are enforced by Prettier and ESLint; run `npm run format`
rather than hand-formatting. Beyond that:

- Prefer clear names over comments. Write a comment when it states a
  constraint the code cannot express.
- Keep user-facing copy player-agnostic — IPTVMaster is used with many
  different IPTV players.
- New UI belongs in a focused component under `apps/web/src/workspaces/` or
  `apps/web/src/components/` rather than growing existing large files.

## Reporting security issues

Please do not open a public issue for a vulnerability. Follow the process in
[SECURITY.md](./SECURITY.md).
