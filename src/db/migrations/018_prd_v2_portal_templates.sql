ALTER TABLE portals
  ADD COLUMN quotation_url VARCHAR(2048) NULL,
  ADD COLUMN login_type VARCHAR(50) NOT NULL DEFAULT 'credentials',
  ADD COLUMN workflow_type VARCHAR(50) NOT NULL DEFAULT 'hybrid',
  ADD COLUMN census_download_required TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN calculate_required TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN quote_pdf_strategy VARCHAR(80) NOT NULL DEFAULT 'direct_download',
  ADD COLUMN portal_config JSON NULL;

-- statement-break

UPDATE portals
SET quotation_url = COALESCE(quotation_url, login_url)
WHERE quotation_url IS NULL;

-- statement-break

CREATE TABLE portal_templates (
  id VARCHAR(32) PRIMARY KEY,
  portal_id VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  coverage_type VARCHAR(100) NOT NULL,
  coverage_type_code VARCHAR(80) NULL,
  template_version INT UNSIGNED NOT NULL DEFAULT 1,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  workflow_type VARCHAR(50) NOT NULL DEFAULT 'hybrid',
  dom_snapshot_ids JSON NOT NULL,
  field_mappings JSON NOT NULL,
  census_mapping JSON NULL,
  dialog_rules JSON NOT NULL,
  submit_rules JSON NOT NULL,
  quote_capture_rules JSON NOT NULL,
  required_sections JSON NOT NULL,
  test_status VARCHAR(50) NOT NULL DEFAULT 'not_run',
  test_report JSON NULL,
  parent_template_id VARCHAR(32) NULL,
  approved_by VARCHAR(32) NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY portal_templates_portal_id_idx (portal_id),
  KEY portal_templates_coverage_type_idx (coverage_type),
  KEY portal_templates_coverage_type_code_idx (coverage_type_code),
  KEY portal_templates_status_idx (status),
  KEY portal_templates_execution_idx (portal_id, coverage_type, status),
  CONSTRAINT portal_templates_portal_id_fk FOREIGN KEY (portal_id) REFERENCES portals (id),
  CONSTRAINT portal_templates_parent_template_id_fk FOREIGN KEY (parent_template_id) REFERENCES portal_templates (id),
  CONSTRAINT portal_templates_approved_by_fk FOREIGN KEY (approved_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- statement-break

CREATE TABLE census_templates (
  id VARCHAR(32) PRIMARY KEY,
  portal_id VARCHAR(32) NOT NULL,
  portal_template_id VARCHAR(32) NULL,
  dom_snapshot_id VARCHAR(32) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  status VARCHAR(50) NOT NULL DEFAULT 'observed',
  filename VARCHAR(255) NULL,
  file_hash VARCHAR(128) NOT NULL,
  file_public_id VARCHAR(255) NULL,
  file_url VARCHAR(2048) NULL,
  sheet_name VARCHAR(255) NULL,
  headers JSON NOT NULL,
  column_mapping JSON NULL,
  validation_rules JSON NULL,
  parent_template_id VARCHAR(32) NULL,
  approved_by VARCHAR(32) NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY census_templates_portal_id_idx (portal_id),
  KEY census_templates_portal_template_id_idx (portal_template_id),
  KEY census_templates_file_hash_idx (file_hash),
  KEY census_templates_status_idx (status),
  CONSTRAINT census_templates_portal_id_fk FOREIGN KEY (portal_id) REFERENCES portals (id),
  CONSTRAINT census_templates_portal_template_id_fk FOREIGN KEY (portal_template_id) REFERENCES portal_templates (id),
  CONSTRAINT census_templates_dom_snapshot_id_fk FOREIGN KEY (dom_snapshot_id) REFERENCES dom_snapshots (id),
  CONSTRAINT census_templates_parent_template_id_fk FOREIGN KEY (parent_template_id) REFERENCES census_templates (id),
  CONSTRAINT census_templates_approved_by_fk FOREIGN KEY (approved_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- statement-break

CREATE TABLE portal_dialogs (
  id VARCHAR(32) PRIMARY KEY,
  portal_id VARCHAR(32) NOT NULL,
  portal_template_id VARCHAR(32) NULL,
  name VARCHAR(255) NOT NULL,
  trigger_step VARCHAR(100) NULL,
  detection_pattern JSON NOT NULL,
  observed_content JSON NULL,
  default_action VARCHAR(50) NOT NULL DEFAULT 'ESCALATE',
  approved_action VARCHAR(50) NULL,
  preconditions JSON NULL,
  irreversible TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'observed',
  approved_by VARCHAR(32) NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY portal_dialogs_portal_id_idx (portal_id),
  KEY portal_dialogs_portal_template_id_idx (portal_template_id),
  KEY portal_dialogs_status_idx (status),
  CONSTRAINT portal_dialogs_portal_id_fk FOREIGN KEY (portal_id) REFERENCES portals (id),
  CONSTRAINT portal_dialogs_portal_template_id_fk FOREIGN KEY (portal_template_id) REFERENCES portal_templates (id),
  CONSTRAINT portal_dialogs_approved_by_fk FOREIGN KEY (approved_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- statement-break

ALTER TABLE portal_jobs
  ADD COLUMN portal_template_id VARCHAR(32) NULL,
  ADD COLUMN census_template_id VARCHAR(32) NULL,
  ADD KEY portal_jobs_portal_template_id_idx (portal_template_id),
  ADD KEY portal_jobs_census_template_id_idx (census_template_id),
  ADD CONSTRAINT portal_jobs_portal_template_id_fk FOREIGN KEY (portal_template_id) REFERENCES portal_templates (id),
  ADD CONSTRAINT portal_jobs_census_template_id_fk FOREIGN KEY (census_template_id) REFERENCES census_templates (id);
