ALTER TABLE users
  ADD COLUMN failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_login_at;
-- statement-break
ALTER TABLE users
  ADD COLUMN locked_until DATETIME NULL AFTER failed_login_attempts;
-- statement-break
ALTER TABLE users
  ADD KEY users_locked_until_idx (locked_until);
-- statement-break
CREATE TABLE IF NOT EXISTS auth_sessions (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  refresh_token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  last_used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY auth_sessions_refresh_token_hash_unique (refresh_token_hash),
  KEY auth_sessions_user_id_idx (user_id),
  KEY auth_sessions_expires_at_idx (expires_at),
  KEY auth_sessions_revoked_at_idx (revoked_at),
  CONSTRAINT auth_sessions_user_id_fk FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
