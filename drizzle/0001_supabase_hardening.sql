-- 1. Keep "updatedAt" current on every UPDATE, like MySQL's ON UPDATE CURRENT_TIMESTAMP.
CREATE OR REPLACE FUNCTION "gym_set_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = current_schema() AND c.column_name = 'updatedAt' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS gym_updated_at ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER gym_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION "gym_set_updated_at"()',
      t
    );
  END LOOP;
END;
$$;
--> statement-breakpoint
-- 2. Supabase publishes tables in "public" through its Data API (the anon / authenticated
-- keys). This software only talks to the database through its own server, so close that
-- door: row level security with no policies, and no table rights for those roles. Members'
-- phone numbers, payments and fingerprint templates must never be reachable with the
-- public key. The app's own connection (the table owner) is not affected.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM anon', current_schema());
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM anon', current_schema());
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM authenticated', current_schema());
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM authenticated', current_schema());
  END IF;
END;
$$;
