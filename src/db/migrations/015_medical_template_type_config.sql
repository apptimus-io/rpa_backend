ALTER TABLE coverage_types
  ADD COLUMN code VARCHAR(80) NULL,
  ADD COLUMN config JSON NULL;
-- statement-break
UPDATE coverage_types
SET code = CASE
  WHEN LOWER(name) = 'medical' THEN 'medical'
  WHEN LOWER(name) = 'motor fleet' THEN 'motor_fleet'
  WHEN LOWER(name) = 'commercial property' THEN 'commercial_property'
  WHEN LOWER(name) = 'personal auto' THEN 'personal_auto'
  ELSE LOWER(REPLACE(REPLACE(name, ' ', '_'), '/', '_'))
END
WHERE code IS NULL;
-- statement-break
CREATE UNIQUE INDEX coverage_types_code_unique ON coverage_types (code);
-- statement-break
ALTER TABLE intake_form_templates
  ADD COLUMN coverage_type_code VARCHAR(80) NULL,
  ADD COLUMN template_type VARCHAR(50) NULL,
  ADD COLUMN member_columns JSON NULL;
-- statement-break
UPDATE intake_form_templates
SET template_type = form_type
WHERE template_type IS NULL;
-- statement-break
UPDATE intake_form_templates
SET coverage_type_code = CASE
  WHEN LOWER(coverage_type) = 'medical' THEN 'medical'
  WHEN LOWER(coverage_type) = 'motor fleet' THEN 'motor_fleet'
  WHEN LOWER(coverage_type) = 'commercial property' THEN 'commercial_property'
  WHEN LOWER(coverage_type) = 'personal auto' THEN 'personal_auto'
  ELSE NULL
END
WHERE coverage_type_code IS NULL;
