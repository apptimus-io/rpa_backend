UPDATE intake_form_templates
SET
  description = 'Collect required customer contact and policy details.',
  fields = JSON_ARRAY(
    JSON_OBJECT('id', 'companyName', 'label', 'Company name', 'type', 'text', 'required', true, 'target', 'company.companyName'),
    JSON_OBJECT('id', 'email', 'label', 'Email', 'type', 'email', 'required', true, 'target', 'contact.email'),
    JSON_OBJECT('id', 'phone', 'label', 'Phone', 'type', 'phone', 'required', false, 'target', 'contact.phone'),
    JSON_OBJECT('id', 'coverageType', 'label', 'Coverage type', 'type', 'select', 'required', true, 'target', 'policy.coverageType', 'options', JSON_ARRAY('Motor Fleet', 'Commercial Property', 'Medical', 'Personal Auto')),
    JSON_OBJECT('id', 'policyStartDate', 'label', 'Policy start', 'type', 'date', 'required', false, 'target', 'policy.policyStartDate'),
    JSON_OBJECT('id', 'policyEndDate', 'label', 'Policy end', 'type', 'date', 'required', false, 'target', 'policy.policyEndDate')
  )
WHERE is_default = TRUE
  AND JSON_SEARCH(fields, 'one', 'member_table', NULL, '$[*].type') IS NOT NULL;
