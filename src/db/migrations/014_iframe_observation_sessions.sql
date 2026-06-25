SET @frame_count_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'dom_snapshots'
    AND column_name = 'frame_count'
);
-- statement-break
SET @frame_count_ddl = IF(
  @frame_count_exists = 0,
  'ALTER TABLE dom_snapshots ADD COLUMN frame_count INT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);
-- statement-break
PREPARE frame_count_stmt FROM @frame_count_ddl;
-- statement-break
EXECUTE frame_count_stmt;
-- statement-break
DEALLOCATE PREPARE frame_count_stmt;
-- statement-break
SET @frame_metadata_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'dom_snapshots'
    AND column_name = 'frame_metadata'
);
-- statement-break
SET @frame_metadata_ddl = IF(
  @frame_metadata_exists = 0,
  'ALTER TABLE dom_snapshots ADD COLUMN frame_metadata JSON NULL',
  'SELECT 1'
);
-- statement-break
PREPARE frame_metadata_stmt FROM @frame_metadata_ddl;
-- statement-break
EXECUTE frame_metadata_stmt;
-- statement-break
DEALLOCATE PREPARE frame_metadata_stmt;
-- statement-break
CREATE TABLE IF NOT EXISTS portal_observation_sessions (
  id VARCHAR(32) PRIMARY KEY,
  portal_id VARCHAR(32) NOT NULL,
  coverage_type VARCHAR(100) NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'recording',
  started_by VARCHAR(32) NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  notes TEXT NULL,
  draft_mapping_id VARCHAR(32) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY portal_observation_sessions_portal_id_idx (portal_id),
  KEY portal_observation_sessions_status_idx (status),
  KEY portal_observation_sessions_draft_mapping_id_idx (draft_mapping_id),
  CONSTRAINT portal_observation_sessions_portal_id_fk FOREIGN KEY (portal_id) REFERENCES portals (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE IF NOT EXISTS portal_observation_events (
  id VARCHAR(32) PRIMARY KEY,
  session_id VARCHAR(32) NOT NULL,
  event_index INT UNSIGNED NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  step VARCHAR(100) NULL,
  url VARCHAR(2048) NULL,
  field_label VARCHAR(255) NULL,
  field_type VARCHAR(50) NULL,
  normalized_target VARCHAR(150) NULL,
  selector_candidates JSON NOT NULL,
  value_sample TEXT NULL,
  frame_index INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY portal_observation_events_session_id_idx (session_id),
  KEY portal_observation_events_event_index_idx (session_id, event_index),
  CONSTRAINT portal_observation_events_session_id_fk FOREIGN KEY (session_id) REFERENCES portal_observation_sessions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
