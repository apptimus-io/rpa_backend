CREATE TABLE IF NOT EXISTS intake_form_templates (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  fields JSON NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_by VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY intake_form_templates_is_default_idx (is_default),
  KEY intake_form_templates_created_by_idx (created_by),
  CONSTRAINT intake_form_templates_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
ALTER TABLE customer_intake_links
  ADD COLUMN form_template_id VARCHAR(32) NULL,
  ADD KEY customer_intake_links_form_template_id_idx (form_template_id),
  ADD CONSTRAINT customer_intake_links_form_template_id_fk FOREIGN KEY (form_template_id) REFERENCES intake_form_templates (id);
