# Refresh performance and progress

## What the editor reports

The overview's **Refresh progress** panel reports each playlist/guide job as
waiting, downloading/reading, saving entries, reconciling, committing, completed,
or failed. Elapsed time includes the queue and provider download. Per-stage
timings use a monotonic clock. Saved-row counts are not an ETA: reconciliation
and the final database commit still have to finish.

Manual and scheduled playlist/EPG imports use one shared queue with maintenance.
Repeated requests for the same waiting/running job are coalesced. Importing a
provider's guide from either the provider card or the guide card uses the same
job identity. The queue is per application process; multiple concurrent API
replicas are not supported by this admission mechanism.

Successful history timestamps use the wall clock instead of PostgreSQL's
transaction-start `NOW()`. New jobs retain their enqueue time, and completion is
corrected after commit. If that final bookkeeping write fails, the already
committed snapshot remains successful with its pre-commit wall-clock timestamp.
Old history rows cannot be repaired without matching completion logs. In-memory
stage history resets when the application restarts.

## Reducing unnecessary writes

Snapshot fingerprints describe the **retained selection**, including entry order,
names, URLs, groups, logos, guide IDs, and other retained attributes. Changes only
to discarded catalogue entries, raw formatting, or unrelated Xtream metadata do
not generate another full snapshot. Category discovery/counts still refresh.
Selecting different content changes the fingerprint even if the provider body is
unchanged. The first refresh after adopting this fingerprint scheme may create
one new snapshot; subsequent unchanged selections reuse it.

This does not yet make genuinely changed snapshots incremental: retained entries
are still copied for snapshot recovery, and changed XMLTV guides are still
replaced transactionally. Avoid interpreting the unchanged-import fixture's
speed as a prediction for all real provider updates.

## Moving an existing source to native Xtream

Under **Manage connection → Import method**, choose **Native Xtream API (parent
series)** if the provider offers a compatible API. Leave the URL blank to reuse
the saved login. The saved URL must contain usable Xtream credentials.

Saving the change queues a preflight behind active work. It fetches the proposed
format, checks selected catalogue category names, and applies the live-count
drop safeguard against retained history before changing the source. A failed
check leaves the source unchanged. Source ID, stored credentials, channel edits,
category selections, and player links are retained. No provider is converted
automatically.

After saving, import the playlist to populate the new format. The previously
accepted snapshot remains available until a new import succeeds. If category
names differ across formats, keep M3U until the selections can be mapped safely;
the application deliberately refuses to guess and publish an empty catalogue.

## Database and host settings

Compose disables SQL bind-parameter logging for both slow statements and errors.
It retains slow-query duration/statement diagnostics without dumping large JSON
import payloads. Existing installations can apply those PostgreSQL parameters
through their normal configuration and reload them without restarting. Existing
logs are not deleted or scrubbed by this change.

Check actual memory/swap and disk pressure before tuning. Increasing a guest from
2 GiB to 4 GiB can help when the Proxmox host has enough free capacity, but will
not repair inefficient writes or guarantee faster storage. Do not increase
allocation based on another VM that has not yet shut down. Do not disable durable
commits or run a blocking `VACUUM FULL` as a default performance fix.

## Regression verification

`npm run check` covers unit/API tests and the production build. CI also runs
`scripts/verify-refresh-performance.mjs` against an empty, isolated PostgreSQL
database. The fixture refuses non-local hosts or a different database name and
checks real persistence, wall-clock completion, progress, unchanged snapshot
reuse, category discovery, edits, restore, and in-place import-method settings.
Never point this fixture at an existing installation.
