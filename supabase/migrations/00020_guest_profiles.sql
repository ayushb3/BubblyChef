-- Settings work for guests (issue #914).
--
-- Anonymous users have no email, and user_profiles.email was NOT NULL, so a guest
-- never had a profile row and the settings stored on it (dietary preferences,
-- allergies/dislikes, expiry priority) could not save. The app now creates the
-- guest's row on demand (nextjs/src/lib/profile-ensure.ts) with a NULL email.
-- UNIQUE still allows many NULLs in Postgres.
ALTER TABLE user_profiles ALTER COLUMN email DROP NOT NULL;

-- When a guest later attaches an email, the row already exists, so the old
-- ON CONFLICT DO NOTHING would leave email NULL. Fill it in instead (keeping the
-- username and every saved preference). CREATE OR REPLACE of an existing function.
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
    ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email
      WHERE user_profiles.email IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
