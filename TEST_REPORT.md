# Test Report

## Checks run in this workspace

- `npm test` — passed. Checks all five HTML entry pages, local asset references and JavaScript module imports, presence of the SQL schema and Supabase CLI configuration, controller-channel scoping guardrails, server-side checkpoint constraints, and score-calculation examples.
- `node --check` — passed for all frontend JavaScript modules.
- Local HTTP smoke test — all five HTML pages (`index.html`, `join.html`, `controller.html`, `leaderboard.html`, and `admin.html`) returned HTTP 200 from a temporary local static server.
- Function source parity — `backend/functions/` and the deployable copies in `supabase/functions/` match.
- Manual source review — the scoring formula in `src/game/scoring.js` was compared with the corresponding server-side SQL formula; the raw controller token is not included in broadcast payloads.

## Not verified in this workspace

No Supabase project URL/key, service key, organizer account, or GitHub repository authorization was supplied. Therefore the app has **not** been connected to a live Supabase project or deployed to GitHub Pages. The SQL schema was not run against a real PostgreSQL/Supabase instance. A full browser-driven end-to-end test was not completed here.

These acceptance tests remain open until a production-like rehearsal is completed:

- Supabase schema installation and Edge Function deployment.
- Organizer authentication and rejection of non-admin users.
- Atomic queue joins under concurrent multi-phone requests.
- Realtime subscription/topic isolation and stale-session rejection against live Supabase.
- Real iPhone and Android touch/browser behavior.
- Mobile/laptop queue updates during disconnect/reconnect.
- Full end-to-end score persistence and ranking across browser/service restarts.
- Voucher eligibility, unique serial enforcement, and claimed status.
- Production QR scan to the exact deployed `join.html` URL.

Do not represent these open items as verified or advertise the project as production-ready until they pass.
