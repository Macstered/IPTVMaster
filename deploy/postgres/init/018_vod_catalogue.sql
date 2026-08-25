-- A provider's film and series catalogue dwarfs its live lineup: one real
-- account lists 260,076 titles against 24,096 channels. Storing every title on
-- every refresh would multiply snapshot size and import time by an order of
-- magnitude for content the operator mostly does not publish.
--
-- Instead each refresh records the catalogue's shape here, cheaply, and only
-- the categories switched on have their titles retained as upstream items.

CREATE TABLE vod_category (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('vod', 'series')),
  provider_group TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, media_type, provider_group)
);

-- The import reads the enabled set for a source before parsing, so that
-- lookup is the one that has to be quick.
CREATE INDEX vod_category_enabled_idx
  ON vod_category (source_id, media_type, enabled);

COMMENT ON TABLE vod_category IS
  'Film and series categories offered by a provider, with the operator''s '
  'choice of which to publish. Titles are stored only for enabled rows.';

COMMENT ON COLUMN vod_category.enabled IS
  'Off by default. Enabling a category stores its titles at the next refresh, '
  'so nothing is retained until it is deliberately asked for.';

COMMENT ON COLUMN vod_category.item_count IS
  'Titles the provider last offered in this category, counted whether or not '
  'they were retained, so the catalogue can be browsed before choosing.';

COMMENT ON COLUMN vod_category.media_type IS
  'Kept separate from group_policy because a film category and a live group '
  'can share a name, and they are configured independently.';
