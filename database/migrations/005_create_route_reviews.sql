CREATE TABLE IF NOT EXISTS route_reviews (
  id uuid PRIMARY KEY,
  route_id uuid NOT NULL UNIQUE REFERENCES routes (id),
  decision varchar(20) NOT NULL CHECK (decision IN ('APROBADA', 'RECHAZADA')),
  observations text,
  reviewed_at timestamptz NOT NULL,
  reviewer_sub varchar(255) NOT NULL,
  reviewer_username varchar(255),
  reviewer_roles text[] NOT NULL DEFAULT '{}',
  correlation_id varchar(100) NOT NULL,
  CONSTRAINT chk_route_reviews_rejection_has_observations CHECK (
    decision <> 'RECHAZADA' OR (observations IS NOT NULL AND length(btrim(observations)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_route_reviews_reviewed_at ON route_reviews (reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_route_reviews_decision ON route_reviews (decision);

CREATE OR REPLACE FUNCTION prevent_route_review_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'route_reviews es append-only: la operacion % no esta permitida', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_route_reviews_block_update_delete ON route_reviews;
CREATE TRIGGER trg_route_reviews_block_update_delete
  BEFORE UPDATE OR DELETE ON route_reviews
  FOR EACH ROW
  EXECUTE FUNCTION prevent_route_review_changes();

DROP TRIGGER IF EXISTS trg_route_reviews_block_truncate ON route_reviews;
CREATE TRIGGER trg_route_reviews_block_truncate
  BEFORE TRUNCATE ON route_reviews
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_route_review_changes();
