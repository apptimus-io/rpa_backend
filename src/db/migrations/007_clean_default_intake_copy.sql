UPDATE intake_form_templates
SET
  name = 'Customer details',
  description = 'Complete the requested details so your broker can prepare the right insurance submission.'
WHERE is_default = TRUE
  AND name = 'Default customer intake';
-- statement-break
UPDATE intake_form_templates
SET description = 'Complete the requested details so your broker can prepare the right insurance submission.'
WHERE description = 'Collect customer contact, policy dates, and optional member census rows.';
