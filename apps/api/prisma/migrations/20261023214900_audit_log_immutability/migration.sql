-- Audit-log integrity + least-privilege runtime role.
--
-- Threat model (see docs/ARCHITECTURE.md "Audit-log integrity"):
--   * A compromised or buggy API process (SQL injection, bad code path) must not be able to
--     rewrite or delete security audit records.
--   * Layer 1 — privileges: the API connects as a member of `qyou_app`, which gets INSERT/SELECT
--     on audit_logs but no UPDATE/DELETE/TRUNCATE, and is not the table owner (so it cannot
--     GRANT itself more, ALTER the table or disable the triggers below).
--   * Layer 2 — triggers: UPDATE/DELETE/TRUNCATE raise an error for EVERY role, including the
--     table owner, so a mistaken migration or ad-hoc owner session cannot silently edit history.
--   * NOT protected: a superuser/table owner can still DROP/DISABLE the triggers or set
--     session_replication_role = replica. That is out of reach for in-database controls; it needs
--     external log shipping / WORM storage (Phase 6).

-- The group role normally pre-exists (infra creates it); create it if missing so that migrations
-- also work on a fresh database. Login roles are created by infra and added to this group.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qyou_app') THEN
    CREATE ROLE qyou_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO qyou_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO qyou_app;

-- Tables created by later migrations get normal DML automatically; append-only tables must
-- explicitly revoke (and add triggers) in their own migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qyou_app;

-- The API never touches Prisma's migration bookkeeping. (The table does not exist yet while
-- Prisma replays migrations in its shadow database, hence the guard.)
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE "_prisma_migrations" FROM qyou_app;
  END IF;
END
$$;

-- Layer 1: audit_logs is insert/select only for the runtime role.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_logs" FROM qyou_app;

-- Layer 2: tamper-evident for every role.
CREATE FUNCTION audit_logs_reject_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_mutation();
