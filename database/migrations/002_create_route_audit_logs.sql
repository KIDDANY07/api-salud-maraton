CREATE TABLE IF NOT EXISTS route_audit_logs (
  id uuid PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  occurred_at timestamptz NOT NULL,
  correlation_id varchar(100) NOT NULL,
  actor_sub varchar(255),
  actor_client_id varchar(255),
  scopes text[] NOT NULL DEFAULT '{}',
  status varchar(20) NOT NULL CHECK (status IN ('SUCCESS', 'VALIDATION_ERROR', 'FORBIDDEN')),
  route_id uuid REFERENCES routes (id),
  received_parameters jsonb,
  applied_parameters jsonb,
  algorithm_version varchar(20) NOT NULL,
  dataset_version varchar(50) NOT NULL,
  dataset_hash char(64) NOT NULL,
  result jsonb,
  score_breakdown jsonb,
  error_details jsonb,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  previous_hash char(64) NOT NULL,
  record_hash char(64) NOT NULL UNIQUE,
  CONSTRAINT chk_route_audit_success_has_route CHECK (status <> 'SUCCESS' OR route_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_route_audit_logs_occurred_at ON route_audit_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_route_audit_logs_status ON route_audit_logs (status);
CREATE INDEX IF NOT EXISTS idx_route_audit_logs_actor_sub ON route_audit_logs (actor_sub);
CREATE INDEX IF NOT EXISTS idx_route_audit_logs_actor_client_id ON route_audit_logs (actor_client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_route_audit_logs_route_id ON route_audit_logs (route_id) WHERE route_id IS NOT NULL;
