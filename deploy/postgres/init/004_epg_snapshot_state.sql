CREATE TABLE epg_snapshot_state (
  source_id UUID PRIMARY KEY REFERENCES source(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  channel_count INTEGER NOT NULL,
  programme_count INTEGER NOT NULL,
  issue_count INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX epg_channel_source_upstream_unique_idx
  ON epg_channel (source_id, upstream_id)
  WHERE upstream_id IS NOT NULL;
