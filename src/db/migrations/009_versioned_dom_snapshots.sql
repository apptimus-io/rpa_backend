ALTER TABLE dom_snapshots
  ADD COLUMN dom_version INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN parent_snapshot_id VARCHAR(32) NULL,
  ADD COLUMN route_fingerprint VARCHAR(128) NULL,
  ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'observed',
  ADD COLUMN change_report JSON NULL,
  ADD KEY dom_snapshots_route_fingerprint_idx (route_fingerprint),
  ADD KEY dom_snapshots_status_idx (status),
  ADD KEY dom_snapshots_version_idx (portal_id, step, route_fingerprint, dom_version),
  ADD CONSTRAINT dom_snapshots_parent_snapshot_id_fk FOREIGN KEY (parent_snapshot_id) REFERENCES dom_snapshots (id);
