---
paths:
  - "database/**"
  - "apps/api/**"
  - "packages/analysis/src/automation/**"
  - "scripts/**"
---

# Database Safety (ABSOLUTE - NO EXCEPTIONS)

**NEVER execute without explicit user confirmation:**
- `DROP TABLE/DATABASE/SCHEMA`
- `TRUNCATE TABLE`
- `DELETE FROM`
- `ALTER TABLE DROP COLUMN`
- Any schema migration that removes data

**Always use UPSERT patterns** (`INSERT ... ON CONFLICT DO UPDATE`), never delete-and-reinsert.

**Migrations** go through `database/migrations/*.sql` — the migration route was deleted for security.

**Partial unique indexes break ON CONFLICT** — PostgreSQL can't match partial indexes (`WHERE col IS NOT NULL`) with `ON CONFLICT (cols)`. Don't use WHERE clauses on unique indexes used for upserts.

**pg_trgm `similarity()` is NOT available** on production PostgreSQL — don't use it in API queries.
