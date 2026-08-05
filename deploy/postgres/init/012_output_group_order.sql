CREATE TABLE output_group_order (
  source_id UUID NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  provider_group TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, provider_group)
);

CREATE INDEX output_group_order_source_sort_idx
  ON output_group_order (source_id, sort_order);
