CREATE TABLE custom_output_category (
  source_id UUID NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, name)
);

CREATE INDEX custom_output_category_source_sort_idx
  ON custom_output_category (source_id, sort_order, name);
