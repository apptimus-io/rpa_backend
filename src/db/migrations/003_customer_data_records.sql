CREATE TABLE IF NOT EXISTS customer_data (
  id VARCHAR(32) PRIMARY KEY,
  customer_id VARCHAR(32) NOT NULL,
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
  UNIQUE KEY customer_data_customer_id_unique (customer_id),
  KEY customer_data_customer_id_idx (customer_id),
  KEY customer_data_source_idx (source),
  KEY customer_data_locked_at_idx (locked_at),
  CONSTRAINT customer_data_customer_id_fk FOREIGN KEY (customer_id) REFERENCES customers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS customer_intake_links (
  id VARCHAR(32) PRIMARY KEY,
  token_hash VARCHAR(128) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  used_at DATETIME NULL,
  created_by VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY customer_intake_links_token_hash_unique (token_hash),
  KEY customer_intake_links_expires_at_idx (expires_at),
  KEY customer_intake_links_revoked_at_idx (revoked_at),
  KEY customer_intake_links_created_by_idx (created_by),
  CONSTRAINT customer_intake_links_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
