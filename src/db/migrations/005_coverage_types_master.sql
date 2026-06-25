CREATE TABLE IF NOT EXISTS coverage_types (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY coverage_types_name_unique (name),
  KEY coverage_types_is_active_idx (is_active),
  KEY coverage_types_sort_order_idx (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
INSERT INTO coverage_types (id, name, description, is_active, sort_order)
VALUES
  ('cov_motor_fleet', 'Motor Fleet', 'Fleet motor insurance customer census and vehicle/risk submission.', TRUE, 10),
  ('cov_commercial_property', 'Commercial Property', 'Commercial property quote and risk submission.', TRUE, 20),
  ('cov_medical', 'Medical', 'Medical or health insurance census submission.', TRUE, 30),
  ('cov_personal_auto', 'Personal Auto', 'Individual motor insurance submission.', TRUE, 40)
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  is_active = VALUES(is_active),
  sort_order = VALUES(sort_order);
