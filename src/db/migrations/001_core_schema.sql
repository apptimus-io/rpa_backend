CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(32) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  permissions JSON NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret_ciphertext TEXT NULL,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY users_email_unique (email),
  KEY users_role_idx (role),
  KEY users_status_idx (status),
  KEY users_created_at_idx (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS portals (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  login_url VARCHAR(2048) NOT NULL,
  portal_type VARCHAR(100) NOT NULL,
  health VARCHAR(50) NOT NULL DEFAULT 'healthy',
  success_rate INT UNSIGNED NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_health_check DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY portals_portal_type_idx (portal_type),
  KEY portals_health_idx (health),
  KEY portals_is_active_idx (is_active),
  KEY portals_last_health_check_idx (last_health_check)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS portal_credentials (
  id VARCHAR(32) PRIMARY KEY,
  portal_id VARCHAR(32) NOT NULL,
  username_ciphertext TEXT NOT NULL,
  password_ciphertext TEXT NOT NULL,
  totp_seed_ciphertext TEXT NULL,
  encryption_key_version VARCHAR(64) NOT NULL,
  rotated_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY portal_credentials_portal_id_unique (portal_id),
  CONSTRAINT portal_credentials_portal_id_fk FOREIGN KEY (portal_id) REFERENCES portals (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(32) PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL,
  date_of_birth DATE NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(50) NULL,
  address TEXT NULL,
  created_by VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY customers_created_by_idx (created_by),
  KEY customers_created_at_idx (created_at),
  CONSTRAINT customers_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS submissions (
  id VARCHAR(32) PRIMARY KEY,
  customer_id VARCHAR(32) NULL,
  customer VARCHAR(255) NOT NULL,
  coverage_type VARCHAR(100) NOT NULL,
  risk_details JSON NULL,
  status VARCHAR(50) NOT NULL,
  portal_count INT UNSIGNED NOT NULL DEFAULT 0,
  document_count INT UNSIGNED NOT NULL DEFAULT 0,
  confidence INT NOT NULL DEFAULT 0,
  created_by VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY submissions_status_idx (status),
  KEY submissions_customer_id_idx (customer_id),
  KEY submissions_created_by_idx (created_by),
  KEY submissions_created_at_idx (created_at),
  CONSTRAINT submissions_customer_id_fk FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT submissions_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS submission_documents (
  id VARCHAR(32) PRIMARY KEY,
  submission_id VARCHAR(32) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  cloudinary_public_id VARCHAR(255) NOT NULL,
  cloudinary_url VARCHAR(2048) NOT NULL,
  document_type VARCHAR(100) NOT NULL,
  uploaded_by VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY submission_documents_submission_id_idx (submission_id),
  KEY submission_documents_uploaded_by_idx (uploaded_by),
  KEY submission_documents_document_type_idx (document_type),
  KEY submission_documents_created_at_idx (created_at),
  CONSTRAINT submission_documents_submission_id_fk FOREIGN KEY (submission_id) REFERENCES submissions (id),
  CONSTRAINT submission_documents_uploaded_by_fk FOREIGN KEY (uploaded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS portal_jobs (
  id VARCHAR(32) PRIMARY KEY,
  submission_id VARCHAR(32) NOT NULL,
  portal_id VARCHAR(32) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'queued',
  queue_job_id VARCHAR(255) NULL,
  payload_version VARCHAR(20) NOT NULL DEFAULT 'v1',
  job_payload JSON NOT NULL,
  step VARCHAR(255) NOT NULL DEFAULT 'Queued',
  confidence INT NOT NULL DEFAULT 0,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY portal_jobs_status_idx (status),
  KEY portal_jobs_portal_id_idx (portal_id),
  KEY portal_jobs_submission_id_idx (submission_id),
  KEY portal_jobs_queue_job_id_idx (queue_job_id),
  KEY portal_jobs_created_at_idx (created_at),
  CONSTRAINT portal_jobs_submission_id_fk FOREIGN KEY (submission_id) REFERENCES submissions (id),
  CONSTRAINT portal_jobs_portal_id_fk FOREIGN KEY (portal_id) REFERENCES portals (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS agent_actions (
  id VARCHAR(32) PRIMARY KEY,
  portal_job_id VARCHAR(32) NOT NULL,
  action_type VARCHAR(100) NOT NULL,
  confidence_score DECIMAL(5,2) NOT NULL,
  action_payload JSON NOT NULL,
  before_screenshot_url VARCHAR(2048) NULL,
  after_screenshot_url VARCHAR(2048) NULL,
  status VARCHAR(50) NOT NULL,
  executed_by VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY agent_actions_portal_job_id_idx (portal_job_id),
  KEY agent_actions_action_type_idx (action_type),
  KEY agent_actions_status_idx (status),
  KEY agent_actions_created_at_idx (created_at),
  CONSTRAINT agent_actions_portal_job_id_fk FOREIGN KEY (portal_job_id) REFERENCES portal_jobs (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS dom_snapshots (
  id VARCHAR(32) PRIMARY KEY,
  portal_id VARCHAR(32) NOT NULL,
  portal_job_id VARCHAR(32) NULL,
  url VARCHAR(2048) NOT NULL,
  step VARCHAR(100) NOT NULL,
  sanitized_dom LONGTEXT NOT NULL,
  visible_labels JSON NOT NULL,
  fingerprint VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY dom_snapshots_portal_id_idx (portal_id),
  KEY dom_snapshots_portal_job_id_idx (portal_job_id),
  KEY dom_snapshots_fingerprint_idx (fingerprint),
  KEY dom_snapshots_created_at_idx (created_at),
  CONSTRAINT dom_snapshots_portal_id_fk FOREIGN KEY (portal_id) REFERENCES portals (id),
  CONSTRAINT dom_snapshots_portal_job_id_fk FOREIGN KEY (portal_job_id) REFERENCES portal_jobs (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS quotes (
  id VARCHAR(32) PRIMARY KEY,
  portal_job_id VARCHAR(32) NOT NULL,
  portal_id VARCHAR(32) NOT NULL,
  submission_id VARCHAR(32) NOT NULL,
  premium DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  quote_reference VARCHAR(255) NULL,
  quote_payload JSON NOT NULL,
  extracted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY quotes_portal_job_id_idx (portal_job_id),
  KEY quotes_portal_id_idx (portal_id),
  KEY quotes_submission_id_idx (submission_id),
  KEY quotes_extracted_at_idx (extracted_at),
  CONSTRAINT quotes_portal_job_id_fk FOREIGN KEY (portal_job_id) REFERENCES portal_jobs (id),
  CONSTRAINT quotes_portal_id_fk FOREIGN KEY (portal_id) REFERENCES portals (id),
  CONSTRAINT quotes_submission_id_fk FOREIGN KEY (submission_id) REFERENCES submissions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS escalations (
  id VARCHAR(32) PRIMARY KEY,
  portal_job_id VARCHAR(32) NOT NULL,
  submission_id VARCHAR(32) NOT NULL,
  agent_action_id VARCHAR(32) NULL,
  reason TEXT NOT NULL,
  suggested_action TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  confidence INT NOT NULL DEFAULT 0,
  screenshot_url VARCHAR(2048) NULL,
  resolution_payload JSON NULL,
  resolved_by VARCHAR(32) NULL,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY escalations_status_idx (status),
  KEY escalations_portal_job_id_idx (portal_job_id),
  KEY escalations_submission_id_idx (submission_id),
  KEY escalations_agent_action_id_idx (agent_action_id),
  KEY escalations_resolved_by_idx (resolved_by),
  KEY escalations_created_at_idx (created_at),
  CONSTRAINT escalations_portal_job_id_fk FOREIGN KEY (portal_job_id) REFERENCES portal_jobs (id),
  CONSTRAINT escalations_submission_id_fk FOREIGN KEY (submission_id) REFERENCES submissions (id),
  CONSTRAINT escalations_agent_action_id_fk FOREIGN KEY (agent_action_id) REFERENCES agent_actions (id),
  CONSTRAINT escalations_resolved_by_fk FOREIGN KEY (resolved_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS daily_stats (
  stat_date DATE PRIMARY KEY,
  submissions_count INT UNSIGNED NOT NULL DEFAULT 0,
  completed_count INT UNSIGNED NOT NULL DEFAULT 0,
  escalated_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_jobs_count INT UNSIGNED NOT NULL DEFAULT 0,
  pending_escalations_count INT UNSIGNED NOT NULL DEFAULT 0,
  average_completion_minutes DECIMAL(10,2) NOT NULL DEFAULT 0,
  operator_stats JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY daily_stats_updated_at_idx (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
