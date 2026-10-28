-- Run as the migration owner after migrations. Touches only the cwl schema
-- and our dedicated runtime role; it does not change Supabase's system schemas.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cwl_runtime') THEN
    CREATE ROLE cwl_runtime NOLOGIN NOINHERIT;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cwl_runtime'
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'cwl_runtime must be an unprivileged dedicated role';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='cwl_runtime') THEN
    RAISE EXCEPTION 'cwl_runtime must not inherit or assume other database roles';
  END IF;
END $$;
ALTER ROLE cwl_runtime SET search_path = pg_catalog,cwl;
ALTER ROLE cwl_runtime SET statement_timeout = '30s';
ALTER ROLE cwl_runtime SET lock_timeout = '30s';

REVOKE ALL ON SCHEMA cwl FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA cwl FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA cwl FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cwl FROM PUBLIC;
DO $$ DECLARE actor text; BEGIN
  FOREACH actor IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=actor) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA cwl FROM %I',actor);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA cwl FROM %I',actor);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA cwl FROM %I',actor);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cwl FROM %I',actor);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA cwl REVOKE ALL ON TABLES FROM %I',actor);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA cwl REVOKE ALL ON SEQUENCES FROM %I',actor);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA cwl REVOKE ALL ON FUNCTIONS FROM %I',actor);
    END IF;
  END LOOP;
END $$;

-- Explicit grants; a new table will not automatically become accessible.
REVOKE ALL ON ALL TABLES IN SCHEMA cwl FROM cwl_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cwl FROM cwl_runtime;
GRANT USAGE ON SCHEMA cwl TO cwl_runtime;
GRANT SELECT ON cwl.migrations,cwl.rounds,cwl.plans,cwl.revisions,cwl.observations,cwl.attacks,cwl.reviews,cwl.ranking_policies TO cwl_runtime;
GRANT INSERT ON cwl.rounds,cwl.plans,cwl.revisions,cwl.observations,cwl.attacks,cwl.reviews,cwl.ranking_policies TO cwl_runtime;
GRANT UPDATE(war_state,last_observed_at) ON cwl.rounds TO cwl_runtime;
GRANT UPDATE(current_revision) ON cwl.plans TO cwl_runtime;
GRANT UPDATE(duration_seconds) ON cwl.attacks TO cwl_runtime;
DO $$ BEGIN
  IF to_regclass('cwl.plan_archives') IS NOT NULL THEN
    GRANT SELECT,INSERT ON cwl.plan_archives TO cwl_runtime;
  END IF;
END $$;

-- The application role is not the table owner and cannot bypass RLS.
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='cwl' LOOP
    EXECUTE format('ALTER TABLE cwl.%I ENABLE ROW LEVEL SECURITY',item.tablename);
    EXECUTE format('DROP POLICY IF EXISTS cwl_server_only ON cwl.%I',item.tablename);
    EXECUTE format('CREATE POLICY cwl_server_only ON cwl.%I TO cwl_runtime USING (true) WITH CHECK (true)',item.tablename);
  END LOOP;
END $$;
-- Grant LOGIN and set a random password separately, without committing a password.
-- Account access is mutable; leadership rows cannot be created or removed by runtime.
DO $$ BEGIN
  IF to_regclass('cwl.memberships') IS NOT NULL THEN
    GRANT SELECT,INSERT ON cwl.accounts,cwl.access_events TO cwl_runtime;
    GRANT SELECT,INSERT,DELETE ON cwl.memberships TO cwl_runtime;
    DROP POLICY IF EXISTS cwl_server_only ON cwl.memberships;
    DROP POLICY IF EXISTS access_read ON cwl.memberships;
    DROP POLICY IF EXISTS access_grant ON cwl.memberships;
    DROP POLICY IF EXISTS access_revoke ON cwl.memberships;
    CREATE POLICY access_read ON cwl.memberships FOR SELECT TO cwl_runtime USING (true);
    CREATE POLICY access_grant ON cwl.memberships FOR INSERT TO cwl_runtime WITH CHECK (role='coLeader');
    CREATE POLICY access_revoke ON cwl.memberships FOR DELETE TO cwl_runtime USING (role='coLeader');
  END IF;
END $$;
