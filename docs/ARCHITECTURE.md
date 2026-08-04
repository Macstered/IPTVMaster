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

Manual and scheduled playlist imports use the same refresh coordinator. It coalesces concurrent work for each source, executes enabled sources sequentially to avoid provider bursts, and exposes only redacted failure details. The initial single-process deployment makes this lock process-local; a database lease is required before supporting multiple app replicas.

XMLTV follows the same bounded refresh model on an independent schedule. The SAX parser normalizes explicit XMLTV offsets to UTC, detects duplicate/invalid channel IDs, caps channel/programme counts, and does not apply the event-title timezone rule. A valid guide replaces its predecessor in one PostgreSQL transaction; an unchanged fingerprint skips replacement and a suspicious count drop retains the prior guide.

## Time handling

All instants are stored as UTC. Provider source and output display zones are stored as IANA timezone names. Event-title localization is applied through selected event-group policies and never as a global EPG offset.

## Published playlist access

An output profile receives a cryptographically random token. PostgreSQL stores only its SHA-256 hash; the plaintext token is returned once when the profile is created. Requests resolve the token, load the current last-known-good data, and serialize M3U or XMLTV. M3U generation applies enabled group policies; XMLTV timestamps are emitted in UTC. Revoking a profile disables both URLs without touching the source or snapshots.

Published M3U entries contain the upstream stream URL so the server is not in the playback data path. The endpoint uses private/no-store cache headers until conditional publication and versioning are added.
