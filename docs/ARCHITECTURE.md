# Architecture

## Boundaries

IPTVMaster manages metadata and generated playlist/EPG artifacts. It does not proxy or transcode video. The application must remain usable when the provider is temporarily unavailable by retaining the most recent validated output.

## Components

- **API:** source configuration, editing, preview, status, and artifact endpoints.
- **Worker:** scheduled streaming imports, reconciliation, EPG cleanup, and publication.
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

Accepted playlist snapshots remain available for deliberate restoration. Snapshot activation takes a per-source database lock, switches the last-known-good pointer and reconciles permanent channels in one transaction, and records the transition in the source audit log. If the next provider refresh matches a retained non-current fingerprint, that snapshot is reactivated instead of being treated as unchanged; this prevents a manual rollback from becoming stuck. The browser uses a two-step confirmation because activation changes the published TiviMate playlist immediately.

Manual and scheduled playlist imports use the same refresh coordinator. It coalesces concurrent work for each source, executes enabled sources sequentially to avoid provider bursts, and exposes only redacted failure details. The initial single-process deployment makes this lock process-local; a database lease is required before supporting multiple app replicas.

## Permanent-channel reconciliation

Permanent channels store provider identity separately from snapshot-scoped upstream rows. Each accepted playlist refresh attempts exact provider-stream matching first, then TVG ID, then a normalized provider-name and group fallback. A locked match cannot use the name fallback. Only unique, uncontested matches are attached automatically; collisions remain `ambiguous`, removed channels become `missing`, and unmatched current entries become `new` channels. Event-policy groups are excluded from permanent reconciliation.

Hide/show, custom name, custom group, custom logo, and sort order are user-owned fields on the permanent channel and are not overwritten during reconciliation. Playlist publication joins the current upstream item to these fields, omits disabled channels, and applies the remaining event/group policies before serialization.

The review API exposes missing and ambiguous permanent channels alongside unmatched current provider entries. A manual match retains the established channel row and its user-owned fields, locks the selected provider identity, and only displaces a completely untouched auto-created `new` channel. Displaced rows are archived rather than deleted, and manual match/unlock actions are written to an audit table. Bulk editing is intentionally limited to reversible visibility, group, and logo overrides.

Event groups are evaluated dynamically from the current snapshot and their persistent group policy. The review API returns only safe metadata: original and localized labels, parse status, calculated source/display instants, placeholder reasons, and rollover warnings—never stream URLs. Parsed events are ordered by their calculated display instant within each event group; unparseable entries remain in provider order after timed events. Reordering preserves the surrounding positions of ordinary live-TV channels.

XMLTV follows the same bounded refresh model on an independent schedule. The SAX parser normalizes explicit XMLTV offsets to UTC, detects duplicate/invalid channel IDs, caps channel/programme counts, and does not apply the event-title timezone rule. A valid guide replaces its predecessor in one PostgreSQL transaction; an unchanged fingerprint skips replacement and a suspicious count drop retains the prior guide.

EPG reconciliation runs after playlist, group-policy, channel-edit, and XMLTV changes. Exact TVG IDs take priority, followed by a unique normalized display-name match; duplicate candidates remain ambiguous instead of being guessed. Manual mappings store the provider's stable XMLTV channel ID separately from the replaceable `epg_channel` row, so a full guide refresh can reconnect the lock transactionally. Published M3U entries receive the canonical mapped `tvg-id`, while XMLTV IDs remain provider-native. Manual map/unlock actions are audited and exposed in source activity.

## Time handling

All instants are stored as UTC. Provider source and output display zones are stored as IANA timezone names. Event-title localization is applied through selected event-group policies and never as a global EPG offset.

## Published playlist access

An output profile receives a cryptographically random token. PostgreSQL stores only its SHA-256 hash; the plaintext token is returned once when the profile is created. Requests resolve the token, load the current last-known-good data, and serialize M3U or XMLTV. M3U generation applies enabled group policies; XMLTV timestamps are emitted in UTC. Revoking a profile disables both URLs without touching the source or snapshots.

Published M3U entries contain the upstream stream URL so the server is not in the playback data path. The endpoint uses private/no-store cache headers until conditional publication and versioning are added.
