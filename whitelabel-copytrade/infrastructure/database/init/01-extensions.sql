-- ---------------------------------------------------------------------------
-- Executed once, by the postgres image, on an empty data directory.
--
-- Only the pieces Prisma cannot express live here. Everything schema-related
-- belongs in a Prisma migration so there is a single source of truth.
-- ---------------------------------------------------------------------------

-- pgcrypto: gen_random_uuid() for database-side UUID defaults.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- citext: case-insensitive comparison support for domain and slug lookups.
CREATE EXTENSION IF NOT EXISTS "citext";

-- pg_trgm: trigram indexes backing the "search" filters on user and tenant
-- lists. Without it, ILIKE '%term%' degrades to a sequential scan.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Statement timeout: no application query should ever run for a minute. A
-- runaway query on a multi-tenant database is an availability incident for
-- every tenant, not just the one that issued it.
DO
$$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET statement_timeout = %L', current_database(), '60s');
    EXECUTE format(
        'ALTER DATABASE %I SET idle_in_transaction_session_timeout = %L',
        current_database(),
        '30s'
    );
END
$$;
