CREATE TABLE IF NOT EXISTS routes (
  id uuid PRIMARY KEY,
  generated_at timestamptz NOT NULL,
  strategy varchar(40) NOT NULL,
  algorithm_version varchar(20) NOT NULL,
  dataset_version varchar(50) NOT NULL,
  dataset_hash char(64) NOT NULL,
  parameters jsonb NOT NULL,
  result jsonb NOT NULL,
  total_distance_km numeric(10, 3) NOT NULL,
  created_by_sub varchar(255),
  created_by_client_id varchar(255)
);

CREATE INDEX IF NOT EXISTS idx_routes_generated_at ON routes (generated_at DESC);
