CREATE TABLE source_audit_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (
    action IN ('snapshot-activate', 'snapshot-reactivate')
  ),
  from_snapshot_id UUID REFERENCES source_snapshot(id) ON DELETE SET NULL,
  to_snapshot_id UUID REFERENCES source_snapshot(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX source_audit_event_source_created_idx
  ON source_audit_event (source_id, created_at DESC);
