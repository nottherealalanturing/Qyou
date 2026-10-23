-- Roles for LOCAL DEVELOPMENT and CI only (passwords below are public dev values).
-- Production: have your DBA create the same two roles with a real secret and rotate it.
--
--   qyou_app      NOLOGIN group role. Holds the runtime privileges (granted by migrations).
--   qyou_runtime  LOGIN role the API connects as (DATABASE_URL). Member of qyou_app.
--                 NOT the table owner and not a superuser, so it can never ALTER/DROP tables,
--                 disable triggers, or rewrite audit_logs.
--
-- The owner role (`qyou` locally) runs migrations via MIGRATION_DATABASE_URL.
-- Idempotent: safe to run repeatedly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qyou_app') THEN
    CREATE ROLE qyou_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qyou_runtime') THEN
    CREATE ROLE qyou_runtime LOGIN PASSWORD 'qyou_runtime_dev_password' IN ROLE qyou_app
      NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
