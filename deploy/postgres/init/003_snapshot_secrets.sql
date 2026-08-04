ALTER TABLE upstream_item
  RENAME COLUMN stream_secret_ref TO encrypted_stream_url;

CREATE UNIQUE INDEX source_snapshot_one_last_known_good_idx
  ON source_snapshot (source_id)
  WHERE is_last_known_good = TRUE;

