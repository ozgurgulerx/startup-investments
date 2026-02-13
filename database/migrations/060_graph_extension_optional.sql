-- Migration 060: Optional Graph Extension (AGE)
--
-- Graph extension support is best-effort. If the extension is unavailable on
-- the current PostgreSQL server, migration continues and SQL edge tables remain
-- the production fallback.

DO $$
BEGIN
    BEGIN
        CREATE EXTENSION IF NOT EXISTS age;
        RAISE NOTICE '[capital-graph] Extension "age" enabled.';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '[capital-graph] Extension "age" unavailable, continuing with SQL graph model: %', SQLERRM;
    END;
END $$;
