CREATE OR REPLACE FUNCTION prevent_route_audit_log_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'route_audit_logs es append-only: la operacion % no esta permitida', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_route_audit_logs_block_update_delete ON route_audit_logs;
CREATE TRIGGER trg_route_audit_logs_block_update_delete
  BEFORE UPDATE OR DELETE ON route_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_route_audit_log_changes();

DROP TRIGGER IF EXISTS trg_route_audit_logs_block_truncate ON route_audit_logs;
CREATE TRIGGER trg_route_audit_logs_block_truncate
  BEFORE TRUNCATE ON route_audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_route_audit_log_changes();
