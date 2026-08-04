ALTER TABLE channel
  ADD COLUMN archived_at TIMESTAMPTZ;

CREATE INDEX channel_source_active_idx
  ON channel (source_id, reconciliation_status)
  WHERE archived_at IS NULL;

CREATE TABLE channel_match_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  displaced_channel_id UUID REFERENCES channel(id) ON DELETE SET NULL,
  upstream_item_id UUID REFERENCES upstream_item(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('manual-match', 'manual-unlock')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX channel_match_audit_source_created_idx
  ON channel_match_audit (source_id, created_at DESC);
