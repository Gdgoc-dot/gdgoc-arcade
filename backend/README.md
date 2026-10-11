# Backend files

- `schema.sql` is the canonical Supabase SQL setup. Run it in the Supabase SQL Editor.
- `functions/` contains the matching Edge Function source reference. For direct Supabase CLI deployment, use the corresponding deployable copies under `../supabase/functions/` together with `../supabase/config.toml`.
- The browser is allowed to use only the public anon/publishable key. Service-role access is used only by Edge Functions.
