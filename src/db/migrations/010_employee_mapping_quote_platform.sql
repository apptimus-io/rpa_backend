CREATE TABLE IF NOT EXISTS customer_members (
  id VARCHAR(32) PRIMARY KEY,
  customer_id VARCHAR(32) NOT NULL,
  customer_data_id VARCHAR(32) NULL,
  employee_no VARCHAR(100) NULL,
  employee_name VARCHAR(255) NOT NULL,
  first_name VARCHAR(120) NULL,
  last_name VARCHAR(120) NULL,
  relationship VARCHAR(100) NULL,
  date_of_birth DATE NULL,
  age INT UNSIGNED NULL,
  gender VARCHAR(30) NULL,
  marital_status VARCHAR(80) NULL,
  nationality VARCHAR(120) NULL,
  emirates_location VARCHAR(120) NULL,
  salary DECIMAL(12,2) NULL,
  salary_band VARCHAR(120) NULL,
  visa_status VARCHAR(120) NULL,
  passport_number VARCHAR(120) NULL,
  mobile_number VARCHAR(80) NULL,
  email VARCHAR(255) NULL,
  category VARCHAR(120) NULL,
  member_type VARCHAR(120) NULL,
  normalized_payload JSON NOT NULL,
  validation_errors JSON NOT NULL,
  import_batch_id VARCHAR(32) NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'ready',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY customer_members_customer_id_idx (customer_id),
  KEY customer_members_customer_data_id_idx (customer_data_id),
  KEY customer_members_import_batch_id_idx (import_batch_id),
  KEY customer_members_status_idx (status),
  CONSTRAINT customer_members_customer_id_fk FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT customer_members_customer_data_id_fk FOREIGN KEY (customer_data_id) REFERENCES customer_data (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS dynamic_field_definitions (
  id VARCHAR(32) PRIMARY KEY,
  field_name VARCHAR(120) NOT NULL UNIQUE,
  field_label VARCHAR(160) NOT NULL,
  data_type VARCHAR(50) NOT NULL DEFAULT 'text',
  required BOOLEAN NOT NULL DEFAULT FALSE,
  coverage_type VARCHAR(100) NULL,
  insurer_mapping JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY dynamic_field_definitions_coverage_type_idx (coverage_type),
  KEY dynamic_field_definitions_field_name_idx (field_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS member_field_values (
  id VARCHAR(32) PRIMARY KEY,
  member_id VARCHAR(32) NOT NULL,
  field_id VARCHAR(32) NOT NULL,
  value TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY member_field_values_member_id_idx (member_id),
  KEY member_field_values_field_id_idx (field_id),
  UNIQUE KEY member_field_values_member_field_unique (member_id, field_id),
  CONSTRAINT member_field_values_member_id_fk FOREIGN KEY (member_id) REFERENCES customer_members (id),
  CONSTRAINT member_field_values_field_id_fk FOREIGN KEY (field_id) REFERENCES dynamic_field_definitions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS excel_mapping_templates (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  coverage_type VARCHAR(100) NOT NULL,
  portal_id VARCHAR(32) NULL,
  mappings JSON NOT NULL,
  created_by VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY excel_mapping_templates_coverage_type_idx (coverage_type),
  KEY excel_mapping_templates_portal_id_idx (portal_id),
  CONSTRAINT excel_mapping_templates_portal_id_fk FOREIGN KEY (portal_id) REFERENCES portals (id),
  CONSTRAINT excel_mapping_templates_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS portal_field_mappings (
  id VARCHAR(32) PRIMARY KEY,
  portal_id VARCHAR(32) NOT NULL,
  coverage_type VARCHAR(100) NOT NULL,
  dom_snapshot_id VARCHAR(32) NULL,
  mapping_version INT UNSIGNED NOT NULL DEFAULT 1,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  mappings JSON NOT NULL,
  required_fields JSON NOT NULL,
  approved_by VARCHAR(32) NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY portal_field_mappings_portal_id_idx (portal_id),
  KEY portal_field_mappings_coverage_type_idx (coverage_type),
  KEY portal_field_mappings_status_idx (status),
  CONSTRAINT portal_field_mappings_portal_id_fk FOREIGN KEY (portal_id) REFERENCES portals (id),
  CONSTRAINT portal_field_mappings_dom_snapshot_id_fk FOREIGN KEY (dom_snapshot_id) REFERENCES dom_snapshots (id),
  CONSTRAINT portal_field_mappings_approved_by_fk FOREIGN KEY (approved_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS insurer_workflows (
  id VARCHAR(32) PRIMARY KEY,
  portal_id VARCHAR(32) NOT NULL,
  coverage_type VARCHAR(100) NOT NULL,
  workflow_mode VARCHAR(50) NOT NULL DEFAULT 'individual_entry',
  upload_method VARCHAR(100) NULL,
  quote_download_method VARCHAR(100) NULL,
  template_config JSON NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY insurer_workflows_portal_id_idx (portal_id),
  KEY insurer_workflows_coverage_type_idx (coverage_type),
  KEY insurer_workflows_workflow_mode_idx (workflow_mode),
  CONSTRAINT insurer_workflows_portal_id_fk FOREIGN KEY (portal_id) REFERENCES portals (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
ALTER TABLE portal_jobs
  ADD COLUMN member_id VARCHAR(32) NULL,
  ADD COLUMN workflow_mode VARCHAR(50) NULL,
  ADD COLUMN mapping_version INT UNSIGNED NULL,
  ADD KEY portal_jobs_member_id_idx (member_id),
  ADD KEY portal_jobs_workflow_mode_idx (workflow_mode),
  ADD CONSTRAINT portal_jobs_member_id_fk FOREIGN KEY (member_id) REFERENCES customer_members (id);
-- statement-break
ALTER TABLE quotes
  ADD COLUMN member_id VARCHAR(32) NULL,
  ADD COLUMN quote_pdf_url VARCHAR(2048) NULL,
  ADD COLUMN quote_pdf_public_id VARCHAR(255) NULL,
  ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'extracted',
  ADD KEY quotes_member_id_idx (member_id),
  ADD CONSTRAINT quotes_member_id_fk FOREIGN KEY (member_id) REFERENCES customer_members (id);
