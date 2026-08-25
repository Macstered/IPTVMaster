# Architecture

Refresh intervals come from the environment on a fresh installation and can be
changed at runtime from the editor. An override is stored in `automation_setting`
and applied to the running scheduler immediately, re-arming any pending run, so
shortening an interval takes effect without waiting out the previous one. A
column left NULL means the configured environment value is used.

## Boundaries

IPTVMaster manages metadata and generated playlist/EPG artifacts. It does not proxy or transcode video. The application must remain usable when the provider is temporarily unavailable by retaining the most recent validated output.

## Components

- **API:** source configuration, editing, preview, status, and artifact endpoints.
- **Worker:** scheduled streaming imports, reconciliation, expired-session cleanup, and publication.
- **Web:** local single-administrator interface.
- **Core:** provider-independent parsing, classification, event rules, matching, and serialization.
- **PostgreSQL:** user intent, parsed snapshots, EPG data, audit history, and publication state.

The API and worker may initially run in one container/process. Their module boundaries should remain separate so long imports can move into a dedicated worker without changing domain code.

## Snapshot safety

Imports use a staging-and-promote workflow:

1. Download while enforcing response and size limits.
2. Parse incrementally and collect validation statistics.
3. Reject empty, malformed, HTML, or unexpectedly small snapshots.
4. Reconcile against the current last-known-good snapshot.
5. Generate new artifacts into a versioned staging directory.
6. Validate the generated M3U/XMLTV.
7. Atomically promote database and artifacts.

Provider downloads are not retained after successful parsing. Stream URL fields are encrypted individually before snapshot persistence and never returned in ordinary API responses. A fingerprint prevents identical refreshes from duplicating snapshot data, while a partial or failed transaction leaves the previous last-known-good snapshot active.

Accepted playlist snapshots remain available for deliberate restoration. Snapshot activation takes a per-source database lock, switches the last-known-good pointer and reconciles permanent channels in one transaction, and records the transition in the source audit log. If the next provider refresh matches a retained non-current fingerprint, that snapshot is reactivated instead of being treated as unchanged; this prevents a manual rollback from becoming stuck. The browser uses a two-step confirmation because activation changes the published playlist immediately.

Manual and scheduled playlist imports use the same refresh coordinator. It coalesces concurrent work for each source, executes enabled sources sequentially to avoid provider bursts, and exposes only redacted failure details. Downloads retry timeouts, network interruptions, throttling, and provider server errors with bounded exponential backoff. Authentication/client errors, malformed content, and snapshot validation failures are not retried. Persistence begins only after a complete validated inspection, so retry exhaustion cannot replace last-known-good data. The initial single-process deployment makes this lock process-local; a database lease is required before supporting multiple app replicas.

## Permanent-channel reconciliation

Permanent channels store provider identity separately from snapshot-scoped upstream rows. Each accepted playlist refresh attempts exact provider-stream matching first, then TVG ID, then a normalized provider-name and group fallback. A locked match cannot use the name fallback. Only unique, uncontested matches are attached automatically; collisions remain `ambiguous`, removed channels become `missing`, and unmatched current entries become `new` channels. Event-policy groups are excluded from permanent reconciliation.

Hide/show, custom name, custom group, custom logo, and sort order are user-owned fields on the permanent channel and are not overwritten during reconciliation. Playlist publication joins the current upstream item to these fields, omits disabled channels, and applies the remaining event/group policies before serialization.

Providers rotate identifiers, so `missing` accumulates. Each channel counts the consecutive refreshes it was absent from; a match resets the count and `CHANNEL_RETENTION_REFRESHES` consecutive misses (default five) delete the row and its edits, recorded as a `channels-retired` audit event. Only refreshes that produce a new snapshot count: an unchanged fingerprint returns before reconciliation, and policy edits and snapshot activation reconcile without counting. Event-policy groups never age, because they are matched through upstream items rather than channel rows and would otherwise be deleted for standing still.

Groups are never retired automatically. An operator can remove one explicitly, which deletes its channels and sets `group_policy.excluded`; the policy row and playlist ordering survive so the group can be restored, and every query that lists or publishes groups filters excluded ones out. Reconciliation will not recreate an excluded group's channels, so the removal survives refreshes until it is undone.

The review API exposes missing and ambiguous permanent channels alongside unmatched current provider entries. A manual match retains the established channel row and its user-owned fields, locks the selected provider identity, and only displaces a completely untouched auto-created `new` channel. Displaced rows are archived rather than deleted, and manual match/unlock actions are written to an audit table. Bulk editing is intentionally limited to reversible visibility, group, and logo overrides.

Event groups are evaluated dynamically from the current snapshot and their persistent group policy. The review API returns only safe metadata: original and localized labels, parse status, calculated source/display instants, placeholder reasons, and rollover warnings—never stream URLs. Parsed events are ordered by their calculated display instant within each event group; unparseable entries remain in provider order after timed events. A source-owned output-group order can place permanent TV and event groups together in any sequence before playlist serialization.

XMLTV follows the same bounded refresh model on an independent schedule. The SAX parser normalizes explicit XMLTV offsets to UTC, detects duplicate/invalid channel IDs, caps channel/programme counts, and does not apply the event-title timezone rule. A valid guide replaces its predecessor in one PostgreSQL transaction; an unchanged fingerprint skips replacement and a suspicious count drop retains the prior guide.

EPG reconciliation runs after playlist, group-policy, channel-edit, and XMLTV changes. Exact TVG IDs take priority, followed by a unique normalized display-name match; duplicate candidates remain ambiguous instead of being guessed. Manual mappings store the provider's stable XMLTV channel ID separately from the replaceable `epg_channel` row, so a full guide refresh can reconnect the lock transactionally. Published M3U entries receive the canonical mapped `tvg-id`, while XMLTV IDs remain provider-native. Manual map/unlock actions are audited and exposed in source activity.

## Film and series catalogue

A provider's catalogue is an order of magnitude larger than its live lineup; one real account offers 260,076 titles against 24,096 channels. Retaining all of it on every refresh would multiply snapshot size, import time, and per-item stream-URL encryption for content that is mostly never published, so the catalogue is handled by category rather than by title.

Every accepted refresh counts each film and series category while the playlist streams and upserts those counts into `vod_category`, which is what the operator browses. Titles are retained only for categories marked enabled: the refresh reads the enabled set before fetching and passes it to the parser, which keeps matching entries and discards the rest as it goes. Enabling a category therefore takes effect at the next refresh, while disabling one deletes its stored items immediately, because that content must stop being published at once. A category the provider stops offering keeps its row and the operator's choice, so a provider blip does not silently discard a selection.

Categories are keyed by media type as well as name because a film category and a live group can share one, and they are configured independently. For the same reason every query that means "live" joins `upstream_item` on `media_type = 'live'` in the join itself rather than a later filter. Films and series get no channel rows, so they are outside permanent reconciliation, retention, and EPG matching entirely.

Publication is per media type: an output profile records which kind it carries, and profiles created before this existed carry none, which continues to mean live. Each kind therefore has its own token URL rather than one playlist carrying everything.

## Time handling

All instants are stored as UTC. Provider source and output display zones are stored as IANA timezone names. Event-title localization is applied through selected event-group policies and never as a global EPG offset.

## Published playlist access

An output profile receives a cryptographically random token. PostgreSQL stores only its SHA-256 hash; the plaintext token is returned once when the profile is created. Requests resolve the token, load the current last-known-good data, and serialize M3U or XMLTV. M3U generation applies enabled group policies; XMLTV timestamps are emitted in UTC. Revoking a profile disables both URLs without touching the source or snapshots.

Published M3U entries contain the upstream stream URL so the server is not in the playback data path. The endpoint uses private/no-store cache headers until conditional publication and versioning are added.

## Administrator boundary

The browser editor and every `/api/v1` route outside the authentication endpoints require a database-backed administrator session. First-run setup is guarded by a database singleton constraint so concurrent requests cannot create multiple administrators. Passwords use scrypt with per-account random salts. Random session and CSRF values are returned only as cookies while PostgreSQL stores their SHA-256 hashes; the session cookie is `HttpOnly`, both are `SameSite=Strict`, and the `Secure` attribute is enabled when HTTPS mode is configured.

Unsafe editor requests require the session, a matching readable CSRF cookie/header pair, the stored CSRF hash, and a same-origin browser request. Login failures are throttled without revealing whether a username exists. Liveness remains public, readiness checks database access, and tokenized `/p/` endpoints remain outside browser authentication so IPTV players can refresh without a session cookie. Security headers deny framing, MIME sniffing, unnecessary browser capabilities, and off-origin scripts.

Expired session rows are removed when a session is issued and by an independent daily maintenance scheduler, so cleanup still runs during long periods without administrator logins. Playlist history is not pruned automatically because it is the rollback source of record. Accepted XMLTV imports delete and replace source guide rows in the same transaction, so a separate programme-retention deletion job is unnecessary.

## Recovery boundary

Application-level backups use PostgreSQL's custom archive format with owner and privilege metadata omitted, then validate the archive and write a SHA-256 sidecar before retention is applied. Restore validates both checksum and archive before stopping the application, terminates stale database sessions, and uses `pg_restore --single-transaction` so a failed restore does not leave a partially replaced schema. The app restarts only after the restore command returns, followed by an internal health check.

Database archives contain encrypted upstream URLs but intentionally exclude the environment-held master key. Production recovery therefore requires two separately protected assets: a recent database archive and the matching `IPTVMASTER_MASTER_KEY`. Proxmox guest backups remain a second recovery layer outside this application boundary.

## Release and migration boundary

The application image embeds a semantic version and source revision in both OCI labels and the public liveness response. Release automation publishes only numbered and commit-addressed GHCR tags; it intentionally does not publish `latest`.

PostgreSQL schema changes run in a one-shot Compose service before application startup. Each numbered SQL file is applied in a transaction and recorded with a SHA-256 checksum in `schema_migration`. A failed migration prevents the app from starting, and changing an already recorded file is treated as corruption. Migrations are forward-only: image-only rollback is allowed only when the prior app is schema compatible, otherwise recovery uses the pre-upgrade database backup and prior release checkout together.
