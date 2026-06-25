ALTER TABLE customer_data
  ADD COLUMN verification_status VARCHAR(50) NOT NULL DEFAULT 'pending_review',
  ADD COLUMN verification_notes TEXT NULL,
  ADD COLUMN assigned_to VARCHAR(32) NULL,
  ADD COLUMN verified_by VARCHAR(32) NULL,
  ADD COLUMN verified_at DATETIME NULL,
  ADD KEY customer_data_verification_status_idx (verification_status),
  ADD KEY customer_data_assigned_to_idx (assigned_to),
  ADD CONSTRAINT customer_data_assigned_to_fk FOREIGN KEY (assigned_to) REFERENCES users (id),
  ADD CONSTRAINT customer_data_verified_by_fk FOREIGN KEY (verified_by) REFERENCES users (id);
-- statement-break
UPDATE customer_data
SET verification_status = CASE
  WHEN JSON_LENGTH(validation_errors) > 0 THEN 'needs_review'
  ELSE 'pending_review'
END
WHERE verification_status = 'pending_review';
