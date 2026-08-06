ALTER TABLE channel
  ADD COLUMN missed_refreshes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE group_policy
  ADD COLUMN excluded BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX channel_missing_retention_idx
  ON channel (source_id, missed_refreshes)
  WHERE current_upstream_item_id IS NULL;

COMMENT ON COLUMN channel.missed_refreshes IS
  'Consecutive provider refreshes in which this channel was not found. Reset '
  'to zero on a match. Rows past the retention threshold are removed.';

COMMENT ON COLUMN group_policy.excluded IS
  'Set when the operator removes a provider group. Its channels are deleted '
  'and later refreshes do not recreate them until the group is restored.';

-- Retiring channels and removing groups both delete rows, so they belong in
-- the activity feed next to the snapshot events.
ALTER TABLE source_audit_event
  DROP CONSTRAINT source_audit_event_action_check;

ALTER TABLE source_audit_event
  ADD CONSTRAINT source_audit_event_action_check CHECK (
    action IN (
      'snapshot-activate',
      'snapshot-reactivate',
      'channels-retired',
      'group-removed',
      'group-restored'
    )
  );
