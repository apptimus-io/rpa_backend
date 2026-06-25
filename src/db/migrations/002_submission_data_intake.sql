CREATE TABLE IF NOT EXISTS submission_data (
  id VARCHAR(32) PRIMARY KEY,
  submission_id VARCHAR(32) NOT NULL,
  source VARCHAR(50) NOT NULL,
  source_filename VARCHAR(255) NULL,
  company_details JSON NOT NULL,
  contact_details JSON NOT NULL,
  policy_details JSON NOT NULL,
  census_members JSON NOT NULL,
  validation_errors JSON NOT NULL,
  locked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY submission_data_submission_id_unique (submission_id),
  KEY submission_data_submission_id_idx (submission_id),
  KEY submission_data_source_idx (source),
  KEY submission_data_locked_at_idx (locked_at),
  CONSTRAINT submission_data_submission_id_fk FOREIGN KEY (submission_id) REFERENCES submissions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS public_intake_links (
  id VARCHAR(32) PRIMARY KEY,
  submission_id VARCHAR(32) NOT NULL,
  token_hash VARCHAR(128) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  used_at DATETIME NULL,
  created_by VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY public_intake_links_token_hash_unique (token_hash),
  KEY public_intake_links_submission_id_idx (submission_id),
  KEY public_intake_links_expires_at_idx (expires_at),
  KEY public_intake_links_revoked_at_idx (revoked_at),
  CONSTRAINT public_intake_links_submission_id_fk FOREIGN KEY (submission_id) REFERENCES submissions (id),
  CONSTRAINT public_intake_links_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
