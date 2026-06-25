ALTER TABLE intake_form_templates
  ADD COLUMN coverage_type VARCHAR(100) NULL,
  ADD KEY intake_form_templates_coverage_type_idx (coverage_type);
