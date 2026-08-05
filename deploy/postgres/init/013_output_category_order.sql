CREATE TABLE output_category_order (
  source_id UUID NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  output_group TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, output_group)
);

CREATE INDEX output_category_order_source_sort_idx
  ON output_category_order (source_id, sort_order);
