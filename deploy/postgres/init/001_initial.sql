CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE source (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('m3u', 'xtream')),
  credential_ref TEXT NOT NULL,
  source_timezone TEXT NOT NULL DEFAULT 'Europe/Stockholm',
  display_timezone TEXT NOT NULL DEFAULT 'Europe/Helsinki',
  playlist_schedule TEXT NOT NULL DEFAULT '0 */2 * * *',
  epg_schedule TEXT NOT NULL DEFAULT '0 */12 * * *',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sync_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('playlist', 'epg')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'rejected')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  safe_error TEXT
);

CREATE INDEX sync_run_source_started_idx ON sync_run (source_id, started_at DESC);

CREATE TABLE source_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  sync_run_id UUID NOT NULL UNIQUE REFERENCES sync_run(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  live_count INTEGER NOT NULL,
  skipped_vod_count INTEGER NOT NULL DEFAULT 0,
  issue_count INTEGER NOT NULL DEFAULT 0,
  is_last_known_good BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX source_snapshot_fingerprint_idx
  ON source_snapshot (source_id, fingerprint);

CREATE TABLE upstream_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES source_snapshot(id) ON DELETE CASCADE,
  provider_stream_id TEXT,
  media_type TEXT NOT NULL CHECK (media_type IN ('live', 'vod', 'series', 'unknown')),
  original_name TEXT NOT NULL,
  provider_group TEXT NOT NULL DEFAULT '',
  tvg_id TEXT,
  tvg_name TEXT,
  logo_url TEXT,
  stream_secret_ref TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX upstream_item_snapshot_group_idx
  ON upstream_item (snapshot_id, provider_group);
CREATE INDEX upstream_item_snapshot_stream_idx
  ON upstream_item (snapshot_id, provider_stream_id);
CREATE INDEX upstream_item_tvg_id_idx ON upstream_item (tvg_id) WHERE tvg_id IS NOT NULL;

CREATE TABLE channel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  current_upstream_item_id UUID REFERENCES upstream_item(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  custom_name TEXT,
  custom_group TEXT,
  custom_logo_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  match_locked BOOLEAN NOT NULL DEFAULT FALSE,
  match_confidence NUMERIC(5, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX channel_source_sort_idx ON channel (source_id, sort_order);

CREATE TABLE group_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  provider_group TEXT NOT NULL,
  behavior TEXT NOT NULL CHECK (behavior IN ('permanent', 'event')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  output_group TEXT,
  hide_placeholders BOOLEAN NOT NULL DEFAULT TRUE,
  placeholder_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_timezone TEXT,
  display_timezone TEXT,
  numeric_date_order TEXT CHECK (numeric_date_order IN ('month-day', 'day-month')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, provider_group)
);

CREATE TABLE event_entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES source_snapshot(id) ON DELETE CASCADE,
  upstream_item_id UUID NOT NULL UNIQUE REFERENCES upstream_item(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  localized_name TEXT NOT NULL,
  source_starts_at TIMESTAMPTZ,
  display_starts_at TIMESTAMPTZ,
  is_placeholder BOOLEAN NOT NULL DEFAULT FALSE,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('localized', 'no-time', 'invalid-time', 'invalid-timezone'))
);

CREATE TABLE epg_channel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  upstream_id TEXT,
  display_name TEXT NOT NULL,
  icon_url TEXT,
  duplicate_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX epg_channel_upstream_idx ON epg_channel (source_id, upstream_id);

CREATE TABLE epg_programme (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  epg_channel_id UUID NOT NULL REFERENCES epg_channel(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  stops_at TIMESTAMPTZ,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  is_synthetic_event BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX epg_programme_channel_start_idx
  ON epg_programme (epg_channel_id, starts_at);
CREATE INDEX epg_programme_retention_idx ON epg_programme (starts_at);

CREATE TABLE epg_mapping (
  channel_id UUID PRIMARY KEY REFERENCES channel(id) ON DELETE CASCADE,
  epg_channel_id UUID NOT NULL REFERENCES epg_channel(id) ON DELETE CASCADE,
  confidence NUMERIC(5, 4),
  manually_locked BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE output_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  access_token_hash TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  published_version TEXT,
  published_at TIMESTAMPTZ,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

