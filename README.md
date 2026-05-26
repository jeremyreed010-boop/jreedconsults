# J. Reed Consults LLC — Dashboard

Personal tax-deduction tracking dashboard. MVP scope: log games (income), log mileage (largest deduction), see a YTD summary.

## Setup

1. **Create a Supabase project** at https://supabase.com → "New project". Pick a name like `jreedconsults`.
2. In Supabase → **SQL Editor** → paste the contents of `sql/001_init.sql` → click Run.
3. In Supabase → **Authentication → URL Configuration**:
   - **Site URL:** `http://localhost:3000` (switch to `https://jreedconsults.com` after deploy)
   - **Redirect URLs:** add `http://localhost:3000/auth-callback.html` and (later) `https://jreedconsults.com/auth-callback.html`
4. Copy `.env.example` to `.env`. From Supabase → **Project Settings → API**, fill in:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (the public anon key)
   - `SUPABASE_SERVICE_KEY` (the `service_role` key — secret, never expose in browser code)
5. Edit `supabase-config.js`: replace the two `YOUR-…` placeholders with the same `SUPABASE_URL` and `SUPABASE_ANON_KEY` values.
6. Install + run:
   ```
   npm install
   npm start
   ```
7. Open http://localhost:3000 → enter your email → click the magic link Supabase sends → you're in.

## Deploy

Deploy as a **separate Railway service** from the Drink With Me service. Add `jreedconsults.com` as a custom domain on the new service. Remove `jreedconsults.com` from the DWM service only after the new one is live — DWM keeps serving on drinkwithme.com untouched.
