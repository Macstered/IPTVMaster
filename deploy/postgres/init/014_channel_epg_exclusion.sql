ALTER TABLE channel
  ADD COLUMN epg_excluded BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE epg_mapping_audit
  DROP CONSTRAINT epg_mapping_audit_action_check,
  ADD CONSTRAINT epg_mapping_audit_action_check
    CHECK (action IN ('manual-map', 'manual-unlock', 'epg-exclude', 'epg-include'));
