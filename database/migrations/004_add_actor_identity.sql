ALTER TABLE routes ADD COLUMN IF NOT EXISTS created_by_username varchar(255);
ALTER TABLE routes ADD COLUMN IF NOT EXISTS created_by_roles text[] NOT NULL DEFAULT '{}';

ALTER TABLE route_audit_logs ADD COLUMN IF NOT EXISTS actor_username varchar(255);
ALTER TABLE route_audit_logs ADD COLUMN IF NOT EXISTS actor_roles text[];

CREATE INDEX IF NOT EXISTS idx_routes_created_by_sub ON routes (created_by_sub);
CREATE INDEX IF NOT EXISTS idx_routes_created_by_username ON routes (created_by_username);
CREATE INDEX IF NOT EXISTS idx_route_audit_logs_actor_username ON route_audit_logs (actor_username);
