CREATE TABLE epg_source (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('provider', 'custom')),
  owner_source_id UUID UNIQUE REFERENCES source(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  credential_ref UUID REFERENCES secret_value(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((kind = 'provider') = (owner_source_id IS NOT NULL))
);

INSERT INTO epg_source (kind, owner_source_id, name)
SELECT 'provider', s.id, s.name || ' guide'
FROM source s
WHERE EXISTS (SELECT 1 FROM epg_channel c WHERE c.source_id = s.id)
   OR EXISTS (
     SELECT 1 FROM epg_snapshot_state st WHERE st.source_id = s.id
   );

ALTER TABLE epg_channel
  ALTER COLUMN source_id DROP NOT NULL,
  ADD COLUMN epg_source_id UUID REFERENCES epg_source(id) ON DELETE CASCADE;

UPDATE epg_channel
SET epg_source_id = es.id
FROM epg_source es
WHERE es.owner_source_id = epg_channel.source_id;

CREATE INDEX epg_channel_epg_source_upstream_idx
  ON epg_channel (epg_source_id, upstream_id);

ALTER TABLE epg_mapping
  ADD COLUMN epg_source_id UUID REFERENCES epg_source(id) ON DELETE CASCADE;

UPDATE epg_mapping
SET epg_source_id = es.id
FROM channel c
JOIN epg_source es ON es.owner_source_id = c.source_id
WHERE epg_mapping.channel_id = c.id;

CREATE TABLE epg_source_snapshot_state (
  epg_source_id UUID PRIMARY KEY REFERENCES epg_source(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  channel_count INTEGER NOT NULL,
  programme_count INTEGER NOT NULL,
  issue_count INTEGER NOT NULL DEFAULT 0
);

INSERT INTO epg_source_snapshot_state
  (epg_source_id, fingerprint, imported_at, channel_count, programme_count,
   issue_count)
SELECT es.id, st.fingerprint, st.imported_at, st.channel_count,
       st.programme_count, st.issue_count
FROM epg_snapshot_state st
JOIN epg_source es ON es.owner_source_id = st.source_id;

ALTER TABLE sync_run
  ALTER COLUMN source_id DROP NOT NULL,
  ADD COLUMN epg_source_id UUID REFERENCES epg_source(id) ON DELETE CASCADE,
  ADD CONSTRAINT sync_run_target_check
    CHECK (source_id IS NOT NULL OR epg_source_id IS NOT NULL);
