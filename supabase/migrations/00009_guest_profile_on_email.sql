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

-- Pick a username that won't collide with user_profiles.username (NOT NULL
-- UNIQUE, 00001). The preferred base is the caller-supplied username or the
-- email local-part, but two accounts on the same local-part (alice@gmail.com
-- vs alice@yahoo.com) both want "alice" — the second INSERT would raise a
-- UNIQUE violation on username. Since these functions run inside the same
-- transaction GoTrue uses to create/update auth.users, that violation rolls
-- back the whole sign-up / email-attach, silently. Here we fall back to a
-- base + short-UID suffix when the base is already taken, so the insert
-- always succeeds. The suffix is deterministic per user, so re-running is
-- idempotent under ON CONFLICT (user_id).
CREATE OR REPLACE FUNCTION unique_username(preferred TEXT, user_id UUID)
RETURNS TEXT AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE username = preferred) THEN
    RETURN preferred;
  END IF;
  RETURN preferred || '-' || left(user_id::text, 8);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
    unique_username(
      COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
      NEW.id
    ),
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
      unique_username(
        COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
        NEW.id
      ),
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
