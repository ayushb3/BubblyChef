-- Fix handle_new_user() to not fail on anonymous sign-ins (issue #382 / #382's guest mode).
--
-- Supabase anonymous users (created via signInAnonymously()) get a real
-- auth.users row with NEW.email = NULL. The original handle_new_user()
-- trigger unconditionally inserted NEW.email straight into
-- user_profiles.email, which is NOT NULL UNIQUE (00001_initial_schema.sql)
-- — every guest sign-in would violate that constraint and roll back the
-- anonymous sign-in itself inside the same transaction GoTrue uses to
-- create the auth.users row. signInAnonymously() would fail outright.
--
-- Fix: skip creating a profile row for an anonymous sign-in. Nothing
-- downstream assumes one always exists — GET /api/profile/[id] already
-- 404s cleanly on a missing row, and ai-service's get_profile() already
-- returns None — so "no profile yet" is an existing, handled state, not
-- a new one this migration has to invent.
--
-- A guest's profile then needs to be created the moment they attach a
-- real email (via supabase.auth.updateUser({ email, ... }) or identity
-- linking) — but that's an UPDATE on auth.users, not an INSERT, so the
-- original AFTER INSERT trigger never fires for it. A second trigger
-- below handles exactly that transition.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS NULL THEN
    -- Anonymous sign-in: no email to build a profile from yet.
    -- handle_user_email_attached() creates the row once one is attached.
    RETURN NEW;
  END IF;

  INSERT INTO user_profiles (user_id, username, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Creates the profile row a guest never got, the moment they go from no
-- email to a real one. ON CONFLICT DO NOTHING makes this safe to fire
-- alongside handle_new_user() for the ordinary (non-guest) signup path
-- too, where AFTER INSERT already created the row and this would
-- otherwise be a genuine UNIQUE violation rather than a no-op.
CREATE OR REPLACE FUNCTION handle_user_email_attached()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.email IS NULL AND NEW.email IS NOT NULL THEN
    INSERT INTO user_profiles (user_id, username, email)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
      NEW.email
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_email_attached
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_user_email_attached();
