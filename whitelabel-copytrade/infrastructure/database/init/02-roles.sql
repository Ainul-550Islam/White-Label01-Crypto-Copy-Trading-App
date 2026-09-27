-- ---------------------------------------------------------------------------
-- Least-privilege application role.
--
-- The migration role owns the schema; the runtime role only reads and writes
-- rows. Running the API as the schema owner would mean a SQL-injection bug
-- could DROP a table rather than merely read one, so the two are separated.
--
-- The password is supplied through the server parameter `wlct.app_password`.
-- It is never written into this file.
-- ---------------------------------------------------------------------------

DO
$$
DECLARE
    app_password text := current_setting('wlct.app_password', true);
BEGIN
    IF app_password IS NULL OR app_password = '' THEN
        RAISE NOTICE 'wlct.app_password is not set; skipping runtime role creation.';
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wlct_app') THEN
        EXECUTE format('CREATE ROLE wlct_app LOGIN PASSWORD %L', app_password);
    END IF;

    -- Every statement below is a utility command, so PL/pgSQL requires EXECUTE.
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO wlct_app', current_database());
    EXECUTE 'GRANT USAGE ON SCHEMA public TO wlct_app';

    -- Applies to tables that already exist.
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wlct_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wlct_app';

    -- Applies to tables created later by migrations.
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wlct_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
            'GRANT USAGE, SELECT ON SEQUENCES TO wlct_app';

    -- The runtime role must never create objects in the public schema.
    EXECUTE 'REVOKE CREATE ON SCHEMA public FROM wlct_app';
END
$$;
