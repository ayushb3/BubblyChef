# Supabase Setup Guide — BubblyChef

Step-by-step guide to set up the Supabase project for BubblyChef.

---

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in (or create an account)
2. Click **New Project**
3. Fill in:
   - **Name**: `BubblyChef`
   - **Database Password**: save this somewhere safe
   - **Region**: pick the closest to your users
4. Click **Create new project** — wait ~2 minutes for provisioning

## 2. Get Your API Keys

Once the project is ready, go to **Settings → API**. You need three values:

| Key | Where to use | Example |
|---|---|---|
| **Project URL** | `NEXT_PUBLIC_SUPABASE_URL` | `https://abcxyz.supabase.co` |
| **Publishable key** | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | `sb_publishable_...` |

Also go to **Settings → API → JWT Settings** and copy:
| Key | Where to use |
|---|---|
| **JWT Secret** | `BUBBLY_SUPABASE_JWT_SECRET` (AI microservice) |

For the AI microservice, you also need the **Secret key** from Settings → API:
| Key | Where to use | Example |
|---|---|---|
| **Secret key** | `BUBBLY_SUPABASE_SECRET_KEY` (server-only!) | `sb_secret_...` |

> **Warning**: Never expose the secret key or JWT secret in frontend code.

## 3. Run the Migrations

### Option A: Supabase Dashboard (quick)

1. Go to **SQL Editor** in the Supabase dashboard
2. Open `supabase/migrations/00001_initial_schema.sql` — paste and run
3. Open `supabase/migrations/00002_rls_policies.sql` — paste and run

### Option B: Supabase CLI (recommended)

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
cd BubblyChef
supabase link --project-ref YOUR_PROJECT_REF

# Push migrations
supabase db push
```

## 4. Verify the Schema

In the Supabase dashboard, go to **Table Editor**. You should see:

- `pantry_items`
- `recipes`
- `user_profiles`
- `conversation_history`
- `conversation_sessions`
- `decorations`
- `ingestion_logs`
- `food_catalog`

Each table (except `food_catalog`) has a `user_id` column referencing `auth.users`.

## 5. Configure Auth

### Email/Password (default)

Already enabled. Users can sign up with email + password.

To disable email confirmation (for development):
1. Go to **Authentication → Providers → Email**
2. Toggle off **Confirm email**

### Google OAuth (optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create OAuth 2.0 credentials (Web application)
3. Set authorized redirect URI to:
   ```
   https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
   ```
4. In Supabase: **Authentication → Providers → Google**
5. Paste your Client ID and Client Secret
6. Enable the provider

## 6. Set Up Environment Variables

### Next.js (`nextjs/.env.local`)

```bash
cp nextjs/.env.local.example nextjs/.env.local
```

Edit with your values:
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=sb_publishable_...your-key
NEXT_PUBLIC_AI_SERVICE_URL=http://localhost:8888
```

### AI Microservice (`ai-service/.env`)

```bash
cp ai-service/.env.example ai-service/.env
```

Edit with your values:
```
BUBBLY_SUPABASE_URL=https://YOUR_REF.supabase.co
BUBBLY_SUPABASE_SECRET_KEY=sb_secret_...your-secret-key
BUBBLY_SUPABASE_JWT_SECRET=your-jwt-secret
BUBBLY_GEMINI_API_KEY=your-gemini-key
BUBBLY_CORS_ORIGINS=["http://localhost:3000"]
```

## 7. Migrate Existing Data (Optional)

If you have data in the old SQLite database:

```bash
pip install supabase

export SUPABASE_URL=https://YOUR_REF.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=eyJ...

python scripts/migrate_sqlite_to_supabase.py \
  --db bubbly_chef.db \
  --user-email your@email.com \
  --dry-run  # remove --dry-run when ready
```

This creates a Supabase auth user and migrates all your pantry items, recipes, conversations, and decorations.

## 8. Test It

```bash
# Start Next.js
cd nextjs && npm run dev

# Visit http://localhost:3000
# Sign up with an email → you should see the dashboard
# Check Supabase dashboard → Authentication → Users to see the new user
# Check Table Editor → user_profiles to see the auto-created profile
```

## 9. RLS Verification

To confirm Row Level Security is working:

1. In the SQL Editor, run:
   ```sql
   -- This should return 0 rows (no auth context)
   SELECT * FROM pantry_items;
   ```
2. Insert a row via the Next.js app (sign in first)
3. Check that the row has your `user_id` in the Supabase dashboard

## Troubleshooting

| Problem | Fix |
|---|---|
| "relation does not exist" | Run migrations (Step 3) |
| "new row violates RLS" | Make sure you're authenticated before inserting |
| "duplicate key on user_profiles" | The auto-create trigger fired twice — safe to ignore |
| Login redirects back to login | Check that `NEXT_PUBLIC_SUPABASE_URL` and `ANON_KEY` are correct in `.env.local` |
| AI service returns 401 | Check `BUBBLY_SUPABASE_JWT_SECRET` matches Supabase project JWT secret |
