ALTER TABLE intake_form_templates
  ADD COLUMN form_type VARCHAR(50) NOT NULL DEFAULT 'company' AFTER coverage_type;
-- statement-break
ALTER TABLE intake_form_templates
  ADD KEY intake_form_templates_form_type_idx (form_type);
