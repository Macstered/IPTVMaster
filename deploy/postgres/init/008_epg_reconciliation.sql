ALTER TABLE epg_mapping
  ADD COLUMN epg_channel_upstream_id TEXT;

UPDATE epg_mapping mapping
SET epg_channel_upstream_id = channel.upstream_id
FROM epg_channel channel
WHERE channel.id = mapping.epg_channel_id;

ALTER TABLE epg_mapping
  ALTER COLUMN epg_channel_upstream_id SET NOT NULL,
  ALTER COLUMN epg_channel_id DROP NOT NULL,
  DROP CONSTRAINT epg_mapping_epg_channel_id_fkey,
  ADD CONSTRAINT epg_mapping_epg_channel_id_fkey
    FOREIGN KEY (epg_channel_id) REFERENCES epg_channel(id) ON DELETE SET NULL;

CREATE INDEX epg_mapping_upstream_idx
  ON epg_mapping (epg_channel_upstream_id);

CREATE TABLE epg_mapping_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  epg_channel_upstream_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('manual-map', 'manual-unlock')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX epg_mapping_audit_source_created_idx
  ON epg_mapping_audit (source_id, created_at DESC);
