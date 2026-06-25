ALTER TABLE submission_data
  ADD COLUMN verification_status VARCHAR(50) NOT NULL DEFAULT 'pending_review';
-- statement-break
ALTER TABLE submission_data
  ADD COLUMN verification_notes TEXT NULL;
-- statement-break
ALTER TABLE submission_data
  ADD COLUMN assigned_to VARCHAR(32) NULL;
-- statement-break
ALTER TABLE submission_data
  ADD COLUMN verified_by VARCHAR(32) NULL;
-- statement-break
ALTER TABLE submission_data
  ADD COLUMN verified_at DATETIME NULL;
-- statement-break
ALTER TABLE submission_data
  ADD KEY submission_data_verification_status_idx (verification_status);
-- statement-break
ALTER TABLE submission_data
  ADD KEY submission_data_assigned_to_idx (assigned_to);
-- statement-break
ALTER TABLE submission_data
  ADD CONSTRAINT submission_data_assigned_to_fk FOREIGN KEY (assigned_to) REFERENCES users (id);
-- statement-break
ALTER TABLE submission_data
  ADD CONSTRAINT submission_data_verified_by_fk FOREIGN KEY (verified_by) REFERENCES users (id);
-- statement-break
UPDATE submission_data
SET verification_status = CASE
  WHEN JSON_LENGTH(validation_errors) > 0 THEN 'needs_review'
  ELSE 'pending_review'
END
WHERE verification_status = 'pending_review';
