CREATE TABLE automation_setting (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  playlist_interval_minutes INTEGER
    CHECK (playlist_interval_minutes BETWEEN 15 AND 10080),
  playlist_enabled BOOLEAN,
  epg_interval_minutes INTEGER
    CHECK (epg_interval_minutes BETWEEN 30 AND 10080),
  epg_enabled BOOLEAN,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE automation_setting IS
  'Operator overrides for refresh scheduling. A NULL column means the value '
  'configured in the environment is used.';
