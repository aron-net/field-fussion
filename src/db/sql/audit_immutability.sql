-- Production PostgreSQL Hardening Script for Append-Only Audit Logs & Boundary Revisions
-- Prevents ordinary application operations from modifying historical audit records
-- or mutating/deleting boundary revision history for active farms.

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % operations are prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_mutation();

DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE OR REPLACE FUNCTION prevent_boundary_revision_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'farm_boundary_revisions is append-only: TRUNCATE operations are prohibited';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'farm_boundary_revisions is append-only: UPDATE operations are prohibited';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM farms WHERE id = OLD.farm_id) THEN
      RAISE EXCEPTION 'farm_boundary_revisions is append-only: DELETE operations are prohibited for existing farms';
    END IF;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_audit_log_mutation();

DROP TRIGGER IF EXISTS trg_farm_boundary_revisions_no_update ON farm_boundary_revisions;
CREATE TRIGGER trg_farm_boundary_revisions_no_update
  BEFORE UPDATE ON farm_boundary_revisions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_boundary_revision_mutation();

DROP TRIGGER IF EXISTS trg_farm_boundary_revisions_no_delete ON farm_boundary_revisions;
CREATE TRIGGER trg_farm_boundary_revisions_no_delete
  BEFORE DELETE ON farm_boundary_revisions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_boundary_revision_mutation();

DROP TRIGGER IF EXISTS trg_farm_boundary_revisions_no_truncate ON farm_boundary_revisions;
CREATE TRIGGER trg_farm_boundary_revisions_no_truncate
  BEFORE TRUNCATE ON farm_boundary_revisions
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_boundary_revision_mutation();

-- Role Separation & Production Least-Privilege Hardening:
-- 1. Schema ownership: Run migrations (drizzle-kit) as the migration/admin role (e.g. Render DB owner
--    or ai_studio_admin via DATABASE_ADMIN_URL). All tables and trigger functions remain owned by that
--    migration role so the runtime app role cannot ALTER TABLE, DISABLE TRIGGER, DROP TRIGGER, or
--    replace trigger functions.
-- 2. Runtime privilege separation: Create a dedicated non-superuser runtime role (field_fussion_app)
--    with LOGIN and a strong password in managed PostgreSQL (Render), and configure DATABASE_URL to
--    connect as field_fussion_app instead of the database owner.

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO PUBLIC;
REVOKE ALL ON TABLE audit_logs, farm_boundary_revisions FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'field_fussion_app') THEN
    CREATE ROLE field_fussion_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO field_fussion_app;
GRANT SELECT, INSERT ON TABLE audit_logs, farm_boundary_revisions TO field_fussion_app;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_logs, farm_boundary_revisions FROM field_fussion_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  users,
  user_roles,
  organisations,
  organisation_memberships,
  organisation_invitations,
  farms,
  farm_access_grants
TO field_fussion_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO field_fussion_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO field_fussion_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO field_fussion_app;

