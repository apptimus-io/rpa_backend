ALTER TABLE portal_field_mappings
  ADD COLUMN ai_suggested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN ai_model VARCHAR(100) NULL,
  ADD COLUMN escalation_id VARCHAR(32) NULL,
  ADD COLUMN parent_mapping_id VARCHAR(32) NULL,
  ADD KEY portal_field_mappings_escalation_id_idx (escalation_id),
  ADD KEY portal_field_mappings_parent_mapping_id_idx (parent_mapping_id);
-- statement-break
ALTER TABLE escalations
  ADD COLUMN escalation_type VARCHAR(80) NULL,
  ADD COLUMN portal_id VARCHAR(32) NULL,
  ADD COLUMN new_snapshot_id VARCHAR(32) NULL,
  ADD COLUMN draft_mapping_id VARCHAR(32) NULL,
  ADD COLUMN metadata JSON NULL,
  ADD KEY escalations_type_idx (escalation_type),
  ADD KEY escalations_portal_id_idx (portal_id),
  ADD KEY escalations_new_snapshot_id_idx (new_snapshot_id),
  ADD KEY escalations_draft_mapping_id_idx (draft_mapping_id);
