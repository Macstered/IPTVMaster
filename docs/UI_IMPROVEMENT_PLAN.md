# UI improvement plan

Working plan for the usability and presentation overhaul reviewed on 2026-08-05, plus the
EPG-exclusion fix and the remote deploy pipeline. Each phase is independently shippable and
ends with `npm run check` green and a deploy to the Proxmox instance (<host>).
Phases are ordered by user value; Track A (deploys) runs in parallel and only needs one-time
host setup.

Review evidence in brief: the workflows and output pipeline are solid end to end. The
problems are concentration of everything in `apps/web/src/SourceSetup.tsx` (~3.6k lines),
feature-oriented rather than attention-oriented navigation, an EPG screen that scales badly,
drag-only ordering, and a visual layer without a system (227 distinct colors, 8 border
radii and 9 font sizes on one screen, 9–11px muted text at 3.9–4.1:1 contrast, gradients
and glow shadows). Channel logos exist in the data but are never rendered.

Conventions for every phase:

- Extract the UI section being touched out of `SourceSetup.tsx` into its own component
  under `apps/web/src/workspaces/` as part of the phase (incremental de-monolith, no
  big-bang rewrite).
- New SQL migrations continue the numbered sequence in `deploy/postgres/init/`
  (next: `014_...`).
- Forward-only migrations; UI must tolerate the API of the previous release during
  rolling upgrades on the LAN instance.
- Finish with: `npm run check`, local fixture-stack verification (Appendix A), deploy via
  Track A, quick verification against the real provider.

---

## Track A — remote deploy capability (parallel, blocks on host setup)

**Status: DONE 2026-08-05** — scripts/deploy-remote.sh, docs/DEPLOY.md; rollback tested both ways.

Goal: update the app inside Docker on the Proxmox VM (<host>) from this machine,
without moving secrets off the host.

Model (matches `docs/PROXMOX_INSTALL.md`): build the image locally on the workstation,
stream it over SSH into the VM's Docker, sync compose/migration files via git, flip
`IPTVMASTER_IMAGE` in the host `.env`, `docker compose up -d --no-build`, verify health.
No registry required; GHCR remains available for tagged releases per `docs/RELEASES.md`.

One-time setup Sami does on the VM (see chat message for the public key):

- A1. Confirm SSH is enabled and reachable from the LAN; provide username + port.
- A2. Append the provided `iptvmaster_deploy` public key to that user's
  `~/.ssh/authorized_keys`.
- A3. Ensure that user can run Docker (`docker` group) and confirm the compose project
  path (assumed `/opt/iptvmaster`) and that it is a git checkout.

Steps I do once access works:

- A4. Smoke test: `ssh -i ~/.ssh/iptvmaster_deploy <user>@<host> docker compose ps`
  from the repo path; record current image tag and app `/health` revision.
- A5. Write `scripts/deploy-remote.sh` (run from this repo on the workstation):
  1. Refuse to run with a dirty working tree unless `--dirty` is passed.
  2. `TAG=$(git describe --always --tags --dirty)`; `docker compose build app` with
     `IPTVMASTER_VERSION/REVISION` build args; tag `iptvmaster:$TAG`.
  3. `docker save iptvmaster:$TAG | gzip | ssh ... 'gunzip | docker load'`.
  4. On host: `git fetch && git checkout <same commit>` (fallback: rsync compose.yaml,
     `deploy/postgres/init/`, `scripts/migrate-postgres.sh` when GitHub is unreachable).
  5. Update `IPTVMASTER_IMAGE=iptvmaster:$TAG` in host `.env` (keep a `.env.bak`).
  6. `docker compose up -d --no-build`; wait for `migrate` to exit 0 and `/ready` 200;
     verify `/health` reports `$TAG`'s revision.
  7. Keep the previously deployed image; print the one-line rollback command
     (previous tag + `up -d --no-build`). Prune images older than the previous one.
- A6. Document the flow in `docs/DEPLOY.md`; note the rollback caveat from
  `PROXMOX_INSTALL.md` §6 (application-only rollback only when schema-compatible).
- A7. Open item: pushing to GitHub from this machine. `origin` is HTTPS and this Windows
  user has no stored credential; first push will tell. If needed: `gh auth login` once in
  an interactive terminal, or Sami pushes while deploys use the rsync fallback.

Acceptance: a no-op deploy of the current commit succeeds end to end, `/health` revision
matches, and rollback to the recorded prior tag is tested once.

---

## Phase 1 — EPG mapping correctness: channels that never have EPG

**Status: DONE 2026-08-06** (EpgWorkspace extraction landed in Phase 2 instead).

The reported problem: the EPG mappings screen lists channels that will never have guide
data — decorative separator entries such as `-=Finland=-` used as group placeholders, and
transient live-event stream channels — so "missing" counts are permanently inflated and
the real gaps drown in noise.

Design:

- 1.1 Storage: migration `014_channel_epg_exclusion.sql` adds a persistent per-channel
  boolean `epg_excluded` (default false) alongside the existing channel overrides so it
  survives provider refreshes and reconciliation, like `custom_name` does.
- 1.2 API: accept `epgExcluded` in the existing single and bulk channel PATCH routes
  (`apps/api/src/app.ts`); `GET .../epg-mappings` excludes these channels from `mappings`,
  `total`, and `missingCount`, and returns `excludedCount` (and the excluded rows when
  `status=excluded` is requested). Audit the change in source activity like manual EPG
  locks are audited today.
- 1.3 Separator heuristic in `packages/core`: `isSeparatorChannelName(name)` — true when
  the name is wrapped on both sides by ≥2 decorative characters (`-=*#~─═ .`) with a short
  label between, e.g. `-=Finland=-`, `── SPORTS ──`, `*** FI ***`. Unit tests with real
  provider patterns. Suggest-only: never auto-exclude.
- 1.4 UI (extract `EpgWorkspace` while here):
  - Row action "No EPG" (and bulk action for selected/filtered rows); excluded rows move
    under an "Excluded" filter chip with an "Undo" action.
  - A one-time suggestion banner when separator-like names are present among missing rows:
    "12 channels look like separators — exclude all", listing them before applying.
  - Coverage line becomes "X of Y mappable matched · Z excluded".
  - Note: channels in groups marked as live-event are already excluded server-side —
    verified against the fixture stack. When a _missing_ channel's provider group looks
    event-like (matches the event heuristics but is still `permanent`), show an inline
    hint linking to the Live events workspace, since marking the group is the right fix.
- 1.5 Separator channels stay in the published M3U (many users keep them as visual
  dividers in TiviMate) — exclusion affects EPG accounting only. Hiding them entirely is
  already possible per-channel in the lineup editor.

Acceptance: on the real provider, EPG coverage counts only mappable channels; separators
and event streams no longer appear as "missing"; exclusions survive a playlist refresh
and are undoable; `epg-reconciliation` tests cover the filter.

Size: M.

## Phase 2 — EPG mapping interaction rework

**Status: DONE 2026-08-06.**

- 2.1 Split rows by status: missing/ambiguous first with controls; matched rows collapse
  to compact one-liners (name → guide name) with controls on expand; filter chips
  All / Missing / Ambiguous / Manual / Matched / Excluded.
- 2.2 Use the `candidateIds` the API already returns for ambiguous channels (currently
  unused by the UI): render the actual candidates as one-click choices with a
  "lock this" per candidate.
- 2.3 Replace the shared global guide list + 200-option `<select>` per row with a per-row
  type-ahead combobox querying `GET .../epg-channels?search=` (debounced ~250 ms,
  keyboard navigable, shows guide icon + id). Remove the separate "Search XMLTV choices"
  form and its submit button.
- 2.4 Make the playlist-channel filter live (debounced) like the group filters; remove
  the Filter submit button.

Acceptance: mapping one missing channel = type in its row, pick, done — no scrolling
round-trips; ambiguous channels resolvable in one click; screen stays light with
hundreds of rows (matched rows render no dropdowns).

Size: M.

## Phase 3 — design tokens and visual calm (the "AI-ish" fix)

**Status: DONE 2026-08-06** — tokens live at the top of styles.css; helper-copy demotion (3.5) only partially done (eyebrow removed; secret-notes remain).

- 3.1 Create `apps/web/src/tokens.css`: ~10 colors (bg / surface / surface-raised,
  border, text / text-muted, accent, ok / warn / danger), two radii (6px containers,
  3px controls; pill reserved for status dots), type scale 12/14/16/22 with weights
  400/500/600 only, spacing scale, `tabular-nums` for counts. Minimum text size 12px;
  all muted-on-surface pairs ≥4.5:1 contrast.
- 3.2 Mechanically migrate `styles.css` to tokens; delete the 227 raw colors, the
  gradients (buttons, panels), glow shadows, and backdrop blur; flat surfaces with 1px
  borders and at most one subtle elevation.
- 3.3 Remove per-section tinted themes (green event panels, amber EPG, brown review):
  neutral surfaces everywhere; status communicated by a small colored dot / 2px left
  border / badge only.
- 3.4 Replace unicode glyph icons (⌂ ▤ ◷ ▦ ↻ ⋮⋮ ⠿) and the "IM"/"TV" letter tiles with
  one small inline-SVG icon set (lucide-style, 16px stroke, vendored locally — no CDN);
  add an SVG favicon; either ship Inter locally or drop it from the font stack (it is
  declared today but never loaded).
- 3.5 Copy diet: demote the always-visible `.secret-note` helper paragraphs to an ⓘ
  tooltip or one collapsible "How this works" per screen; drop the repeated
  "LOCAL PLAYLIST CONTROL" eyebrow; reserve ALL-CAPS micro-labels for one style.
- 3.6 Sweep for the row-height/spacing regressions this causes and fix responsive
  breakpoints accordingly.

Acceptance: one screen shows ≤2 radii and ≤5 font sizes; no gradients/glows; contrast
audit passes 4.5:1 for body and muted text; the app reads as a purpose-built console
rather than a template dashboard.

Size: M–L (mostly mechanical, wide blast radius — do as its own PR with before/after
screenshots per workspace).

## Phase 4 — Overview as a status board + attention model + feedback

**Status: DONE 2026-08-06** — next-run display simplified to interval + last-result (honest, no fake precision).

- 4.1 API: `GET /api/v1/system/status` returning, per source: channel/group counts,
  last playlist/EPG refresh time and outcome, next scheduled run (schedulers expose
  this), EPG coverage (mappable denominator from Phase 1), pending counts (provider
  change review, EPG missing/ambiguous), active output profile count.
- 4.2 Overview: replace the three static feature cards with live cards driven by 4.1,
  each linking to its workspace; a "Needs attention" block listing nonzero queues; show
  the refresh schedule ("every 120 min · next 14:32") instead of the bare
  "Automatic refresh enabled" dot.
- 4.3 Sidebar: count badges on "EPG mappings" and a new review indicator on "Lineup"
  (provider-change queue) driven by the same endpoint; poll it lightly (60 s) so badges
  stay honest after background refreshes.
- 4.4 Feedback unification: one fixed toast/banner region (aria-live) for success and
  error of every mutation; errors no longer render only at the bottom of the panel
  (`SourceSetup.tsx` end-of-section message today); replace the native
  `window.confirm` on "Remove provider" with the inline styled confirm pattern already
  used for snapshot restore; add success confirmation for bulk operations
  ("14 channels hidden").
- 4.5 Channel logos: render `providerLogoUrl`/`customLogoUrl` thumbnails with letter
  fallback in channel rows, EPG rows (guide `iconUrl` too), and the provider card
  (`referrerpolicy="no-referrer"`, lazy, graceful broken-image fallback). Extract
  `OverviewWorkspace` while here.

Acceptance: opening the app answers "did everything refresh, and does anything need
me?" without navigation; every action gives visible feedback near the pointer or in the
toast region.

Size: M.

## Phase 5 — lineup editor restructure + ordering accessibility

**Status: PARTIAL 2026-08-06** — 5.2/5.4 done (arrow ordering, drop indicator, badge calm, rename-on-expand); 5.1/5.3 master-detail merge and column alignment still open.

- 5.1 Merge "Playlist order" and "Group & channel editor" into one master–detail
  Lineup screen: left pane = output groups (order, visibility, rename, badges), right
  pane = channels of the selected group (search, bulk bar, per-channel edit). Kills the
  current disconnect where an expanded group's channels render below the whole group
  list. Keep the two sub-nav entries as deep links into the same screen initially.
- 5.2 Ordering without drag: up/down buttons and an editable position number on group
  rows and channel rows (channels already persist `sortOrder`); keep HTML5 drag as an
  enhancement with a visible drop-indicator line; disable-on-filter gets an explanatory
  tooltip instead of silently not dragging. This also makes reordering work on touch
  devices, where HTML5 drag does not exist.
- 5.3 Row layout: aligned columns (logo | name | group | status | actions), actions
  revealed on hover/focus-within; per-group "Move all/Reset" forms move into the
  expanded detail pane instead of rendering on every row.
- 5.4 Reduce the "MATCHED" badge noise: badge exceptions only (missing/ambiguous/new/
  locked); matched is the unmarked default.

Acceptance: group → channels is one spatial motion; full reorder possible with
keyboard only and on a tablet; per-row visual weight drops noticeably.

Size: L (the largest UI change; extract `LineupWorkspace` first).

## Phase 6 — app shell and platform polish

**Status: PARTIAL 2026-08-06** — 6.1 (workspace routing, without provider id), 6.3, 6.4 (Copy, no QR), 6.5, 6.6, 6.7 done; 6.2 data layer/virtualization still open.

- 6.1 Hash routing: `#/overview`, `#/lineup/order`, `#/lineup/channels`, `#/events`,
  `#/epg`, `#/updates` plus selected provider id; restore on load (F5 currently always
  lands on Overview).
- 6.2 Data layer: introduce TanStack Query (vendored via npm, LAN-friendly) with
  targeted invalidation; apply PATCH responses in place instead of the current
  3–4-list reload after every toggle; virtualize channel lists >200 rows.
- 6.3 Mobile: make Sign out reachable (status card is `display:none` under 980px
  today); audit tap targets on the horizontal nav strip.
- 6.4 Output URLs: Copy buttons with confirmation + QR code (tiny local generator) for
  phone-based TiviMate Companion setup.
- 6.5 Timezone fields become selects/datalists fed by
  `Intl.supportedValuesOf('timeZone')` (free-text IANA strings today).
- 6.6 Honest truncation: "showing N of M" wherever lists are capped — event group list
  (`slice(0, 50)` with no note today), channel list (2000), snapshots (6), activity
  (10) — with search hints.
- 6.7 Events workspace clarity: segmented control "Event groups (n) / All groups"
  replacing the empty-filter-shows-only-events behavior and the hardcoded "Events FI"
  default filter text.

Acceptance: refresh keeps place; provider switch and channel toggles feel instant on
a 10k-channel playlist; the app is fully operable from a phone.

Size: M.

---

## Phase 7 — shared EPG pool and custom guide imports (planned 2026-08-06)

Goal: import standalone XMLTV guides that belong to no provider, and let every
provider's channels map against every imported guide instead of only their own.

Current constraint: guide data (`epg_channel`, `epg_programme`,
`epg_snapshot_state`) is keyed by provider `source_id`, the one optional XMLTV
URL lives inside the provider's encrypted credentials, and reconciliation only
searches the owning provider's guide.

Design: promote guides to first-class **EPG sources**.

- 7.1 Migration `015_epg_sources.sql` (additive, forward-only): new `epg_source`
  table (`kind` = provider|custom, `owner_source_id` for provider guides,
  `credential_ref` for custom guides' encrypted URLs, `enabled`). Backfill one
  provider-kind row per source that has guide data; add `epg_source_id` to
  `epg_channel` (backfilled; kept nullable at the DB level so the previous
  release stays rollback-compatible, enforced in code) with
  `UNIQUE (epg_source_id, upstream_id)`; add `epg_source_id` to `epg_mapping`
  (backfilled) because upstream ids like `bbc1.uk` may exist in several guides;
  rekey `epg_snapshot_state` per guide. Provider guides keep their URL inside
  provider credentials (no credential migration); missing provider rows are
  created lazily at import time. Custom guides store their URL through the
  existing encrypted `secret_value` mechanism.
- 7.2 Import/refresh: XMLTV import pipeline and the EPG scheduler iterate
  `epg_source` rows (custom ones included) with the same bounded downloads,
  unchanged-feed detection, transactional replacement, and non-overlap
  coordination, now keyed per guide.
- 7.3 API/UI for custom guides: CRUD + import-now on an "EPG sources" panel on
  Overview (name + URL entered once, encrypted, never shown again — same
  contract as provider connections), last-sync lines on the status board and in
  `system/status`.
- 7.4 Cross-guide manual mapping: the EPG picker searches all enabled guides,
  every option/candidate/matched note carries a guide badge, manual locks store
  (guide, upstream id). Combined XMLTV outputs namespace ids per guide, not per
  provider, so identical upstream ids cannot collide.
- 7.5 Cross-guide auto-matching with a conservative priority ladder so no
  existing match regresses: manual lock, then exact tvg-id in the provider's
  own guide, then unique tvg-id across all guides, then unique normalized name
  in the own guide, then unique normalized name across all guides; otherwise
  missing/ambiguous with candidates drawn from all guides.
- 7.6 Optional polish: per-provider guide priority ordering, per-guide health
  cards, bulk re-map tooling.

Delivery order: 7.1–7.4 first (custom guides + cross-provider mapping usable
manually), 7.5 second (automatic coverage), 7.6 as needed. The migration gets
rehearsed on the fixture stack with pre-existing guide data before touching the
LAN instance.

## Appendix A — local verification stack

Reproducible recipe (used for the 2026-08-05 review):

1. `.env` in the repo root (gitignored) with throwaway `POSTGRES_PASSWORD`,
   `IPTVMASTER_MASTER_KEY` (`openssl rand -base64 32`), `IPTVMASTER_PORT=18085`,
   refresh initial delays 3600 to keep schedulers quiet.
2. `docker compose up --build -d` → app on `http://localhost:18085`.
3. Synthetic provider served from a scratch dir on `0.0.0.0:18090` (reachable from the
   container as `host.docker.internal:18090`): an M3U with Nordic-style permanent groups,
   `EVENTS…` groups whose entries look like `17:00 Montreal ATP Tennis 8/5`, separator
   entries like `-=Finland=-`, placeholder entries ("PLEASE RELOAD YOUR PLAYLIST"), and
   `/movie/`+`/series/` URLs for VOD skipping; an XMLTV guide crafted to produce exact-id
   matches, name-only matches, ambiguous duplicates, and missing channels.
4. Seed over the API with curl: `POST /api/v1/auth/setup`, then send the `iptvmaster_csrf`
   cookie value as `x-iptvmaster-csrf` plus an `Origin` header on mutations:
   `POST /api/v1/sources`, `POST /api/v1/sources/:id/import`, `.../epg/import`,
   `PUT .../group-policies` for event groups.
5. Tear down with `docker compose down -v`.

## Appendix B — deploy quick reference (once Track A lands)

```sh
./scripts/deploy-remote.sh            # build → ship → migrate → health-check
./scripts/deploy-remote.sh --rollback # previous tag, schema-compatible releases only
```

Host: <host>, compose project `/opt/iptvmaster`, secrets stay in the host `.env`.
