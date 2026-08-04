ALTER TABLE channel
  ADD COLUMN provider_stream_id TEXT,
  ADD COLUMN tvg_id TEXT,
  ADD COLUMN provider_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN provider_group TEXT NOT NULL DEFAULT '',
  ADD COLUMN provider_logo_url TEXT,
  ADD COLUMN reconciliation_status TEXT NOT NULL DEFAULT 'new'
    CHECK (reconciliation_status IN ('matched', 'new', 'missing', 'ambiguous')),
  ADD COLUMN last_seen_at TIMESTAMPTZ;

CREATE UNIQUE INDEX channel_current_upstream_item_idx
  ON channel (current_upstream_item_id)
  WHERE current_upstream_item_id IS NOT NULL;

CREATE INDEX channel_source_provider_group_idx
  ON channel (source_id, provider_group);

CREATE INDEX channel_source_reconciliation_idx
  ON channel (source_id, reconciliation_status);
