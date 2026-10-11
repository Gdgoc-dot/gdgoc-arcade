# GDGoC NDU Arcade Challenge

A standalone, browser-based arcade attraction for GDGoC NDU recruitment day. The laptop runs an original 2D rage-platformer; students join a first-come-first-served queue from their phones; the active player's phone becomes the controller; valid scores persist to a live leaderboard; organizers can configure voucher eligibility and record physical voucher awards.

This repository is independent of the Techverse quiz website. It has its own pages, game, backend schema, queue, controller authorization, leaderboard, administration, and deployment instructions.

## What's included

- **Big-screen game and presentation** — 2D platformer with movement, jump physics, platform gaps, spikes, moving hazards, checkpoints, respawning, a 60-second default turn, server-recomputed scoring, and victory/timeout states.
- **Mobile join and queue** — nickname-only registration, position, approximate wait, readiness confirmation when enabled, leave/rejoin flow, and no account or contact details for ordinary participants.
- **Phone controller** — touch and keyboard controls, active-turn checks, a high-entropy per-entry token, a SHA-256-derived per-participant Realtime topic, live score/timer updates, and stale-control release. The raw bearer token is never broadcast; the host checks the scoped channel key against the stored token hash.
- **Live leaderboard** — persistent best valid score per browser participant ID, deterministic ties, top-three styling, and a full-screen view.
- **Organizer console** — Supabase Auth sign-in, queue controls, registration, turn settings, readiness, repeat attempts, maintenance notices, score invalidation, CSV exports, reward rules, unique voucher serials, claim status, event closeout, and an audit trail.
- **Supabase backend** — SQL schema, row-level access policies, atomic queue/session functions, public-safe views, rate-limited Edge Functions, and organizer-only administrative actions.
- **Local preview mode** — a browser-only mode so you can inspect the UI and play a local keyboard test before configuring a backend. It is clearly labeled and is **not** the multi-device event system.

## Architecture

| Part | Implementation | Responsibility |
|---|---|---|
| Static frontend | HTML, CSS, JavaScript modules | Public screen, game, join flow, controller, leaderboard, admin UI |
| Game host | Canvas physics loop on the trusted organizer laptop | Simulates the level and emits live controller telemetry |
| Real-time messages | Supabase Realtime Broadcast | Phone input to host; score/time/death telemetry back to controller |
| Persistence | Supabase Postgres | Queue, event settings, sessions, scores, leaderboard, rewards, voucher claims, audit log |
| Trusted operations | Supabase Edge Functions + SQL functions | Join authorization, token verification, rate limits, atomic turn transitions, server-side score formula, protected organizer actions |
| Static hosting | GitHub Pages | HTTPS pages and QR destination |

The phone never submits a score. At turn end, the trusted organizer browser sends the run result to an organizer-authenticated Edge Function; Postgres recomputes the score from furthest distance, validated checkpoint identifiers, completion, and remaining time. As with most browser-hosted games, an attacker who compromises the organizer laptop/session or alters that trusted browser can still tamper with the simulation inputs. Keep the host laptop and organizer account under organizer control.

## 1. Run the local preview

Requires Python 3 or another static HTTP server. From this folder:

```bash
python -m http.server 8080
```

Open <http://localhost:8080/>. The browser labels the app **LOCAL PREVIEW** because the Supabase URL and public key in `config.js` are blank.

Press **Enter** on the big-screen page to start a local 60-second test run. Use **← / →** or **A / D** to move and **Space / ↑ / W** to jump. The local preview stores its demo queue and scores in that browser's local storage. Phones on separate devices will not share state until Supabase is configured.

Run the repository's available checks:

```bash
npm test
```

## 2. Create and configure Supabase

### A. Create the project

1. Create a Supabase project for this arcade. This is separate from any quiz or other website backend.
2. In **SQL Editor**, open `backend/schema.sql`, paste the full contents, and run it. This creates the tables, views, access policies, atomic functions, reward records, and rate-limit storage.
3. In **Project Settings → API** (or the project's API keys page), copy the **Project URL** and the **anon/publishable public key**.
4. Edit the two relevant fields in `config.js`:

```js
window.ARCADE_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseAnonKey: "YOUR_PUBLIC_ANON_KEY",
  publicBaseUrl: "https://YOUR_GITHUB_USERNAME.github.io/gdgoc-arcade/",
  eventName: "GDGoC NDU Arcade Challenge",
};
```

The anon/publishable key is intended for browser use with the included policies. **Never put the `service_role`/secret key in `config.js`.**

### B. Create an organizer account

1. In Supabase **Authentication → Users**, create the organizer login with an email and password.
2. Copy the user's UUID from the user details.
3. Run this in SQL Editor, replacing the two placeholders:

```sql
insert into public.event_admins (user_id, email)
values ('YOUR_AUTH_USER_UUID', 'organizer@example.com')
on conflict (user_id) do update set email = excluded.email;
```

Only user IDs in `event_admins` are accepted by the organizer Edge Function or `arcade_host_state` RPC.

### C. Deploy the Edge Functions

The deployable function sources and configuration are under `supabase/functions/` and `supabase/config.toml`. The same reviewed source copies are included under `backend/functions/` as the backend implementation reference.

Install or use the current Supabase CLI, then from the repository root:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy join-queue --project-ref YOUR_PROJECT_REF
npx supabase functions deploy get-participant-state --project-ref YOUR_PROJECT_REF
npx supabase functions deploy admin-action --project-ref YOUR_PROJECT_REF
```

The first two functions allow unauthenticated access only because they verify a participant's token and apply server-side rate limits. `admin-action` keeps JWT verification enabled and independently checks the caller against `event_admins`. Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions; the functions also read `SUPABASE_ANON_KEY` to verify the signed-in user. If your project/environment does not expose the legacy anon environment variable, add it as a function secret through the Supabase dashboard/CLI. Never add a service-role key to a public file.

### D. Turn on registration

1. Deploy the static frontend (next section) and open `admin.html` using the deployed HTTPS URL.
2. Sign in with the organizer account.
3. Open registration from the organizer dashboard.
4. Configure the turn length (default 60 seconds), readiness confirmation (off by default), repeat attempts, and reward rules.
5. Open the public big-screen page and confirm the connection label says **SUPABASE LIVE** before showing the QR code to students.

## 3. Deploy the frontend with GitHub Pages

1. Create a **new, separate GitHub repository** named `gdgoc-arcade` (or another name you prefer). Do not place the files inside the Techverse quiz repository.
2. Upload/commit the contents of this project folder to the new repository's root so `index.html`, `join.html`, `controller.html`, `admin.html`, and `config.js` are at the root.
3. In the repository, open **Settings → Pages** and publish from the `main` branch, `/ (root)`.
4. Wait until GitHub Pages provides the HTTPS address.
5. Put that exact root address, including the repository path and trailing slash, in `ARCADE_CONFIG.publicBaseUrl` in `config.js` and commit the change. Example: `https://YOUR_GITHUB_USERNAME.github.io/gdgoc-arcade/`.
6. Open the deployed `index.html` and verify the QR target below the code ends in `/join.html` and opens the same deployment.

No build step is needed for the frontend. The Supabase backend is required for actual multi-device queueing, private organizer operations, persistent scores and voucher claims.

## 4. Event-day operating guide

1. Open the Supabase-backed organizer dashboard and sign in.
2. Open the big-screen page on the laptop connected to the TV/projector. Use the deployed HTTPS URL, not `localhost`.
3. Check the connection label, confirm the queue is initially clear, and open registration from the organizer console.
4. Show the QR code and readable fallback URL. Students enter a nickname and join the line.
5. Use **Start next player** for the first turn. After a valid turn finishes, the host automatically advances to the next waiting participant after a short transition. If readiness confirmation is enabled, the next participant must confirm within the configured response window; no-shows are skipped.
6. Keep the big-screen tab open and the laptop awake. Do not sign out of the organizer session while turns are running. The host screen needs the organizer session to retrieve the controller-token hash and operate the trusted game loop.
7. Use **Pause queue** when you need to stop new turns. Use **Close registration** when you want to stop new entrants but finish the current queue.
8. Review the leaderboard and voucher eligibility. Before marking a voucher **awarded**, enter its real, unique physical voucher serial/code. Mark **claimed** only after handing the voucher to the winner.
9. Use **Export scores CSV** and **Export winners CSV** to save the event results. Use **End event & finalize top 3** only when the competition is actually over; this closes registration and records eligibility for any configured top-three rules.

## Scoring rules

The browser game and server-side SQL use the same formula:

- **Distance:** 1 point per 8 pixels of furthest horizontal progress. Furthest progress only increases, so dying/restarting cannot farm points.
- **Checkpoints:** 75 points for each unique checkpoint reached (two checkpoints in the included level).
- **Finish:** 500 bonus points for reaching the finish.
- **Time:** up to 600 additional points, at 10 points per remaining whole second, only after clearing the level.
- **Deaths:** tracked for display and review; no arbitrary score reduction.
- **Ties:** a higher score ranks first; equal scores are ordered by the earlier recorded score, then nickname for stable display.

The SQL function independently clamps and recalculates the distance, checkpoint, finish and time portions before inserting a score record. Scores are not accepted from phone-controller messages.

## Privacy and identity limits

Participants only provide a nickname. A stable random browser ID is used to group attempts into a single leaderboard identity across refreshes/retries in that browser. It is not account-grade identity verification: clearing browser storage or using another browser/device creates a different identity. Do not promise protection against deliberate duplicate identities. Do not collect emails, phone numbers, or passwords from public participants.

## Common troubleshooting

**The page says LOCAL PREVIEW:** `config.js` is blank, malformed, or the Supabase UMD library failed to load. Check the browser console and the Supabase URL/public key.

**The QR placeholder remains:** the page needs to be on an HTTPS deployment URL, or `publicBaseUrl` must be set to the actual public root URL. A production QR is intentionally not generated for a localhost URL.

**The organizer cannot sign in:** confirm the user exists in Supabase Auth, then confirm its UUID is present in `public.event_admins`. Check the `admin-action` Edge Function logs.

**Phones can join but controls do not respond:** keep the big-screen tab open, sign in as an organizer in the same browser profile, check the Supabase Realtime connection, and verify the active session has not expired. The controller token is intentionally not public-readable.

**No score appears:** check `admin-action` logs and the Supabase score record. A score is stored only when the trusted host finishes the turn; if the host browser is closed/crashes, an expired turn may be closed without a score.

**The QR works but phone and laptop disagree:** ensure the Supabase URL/key are the same in the deployed `config.js`, confirm the schema was run on that exact project, and check Edge Function deployments.

## Important implementation boundary

This environment had no Supabase project credentials or GitHub repository authorization, so the app is built and packaged but **not deployed or connected to a live backend here**. The local preview and repository checks can be tested now; real-time multi-device operation, authenticated admin actions, mobile-browser compatibility and voucher handling still require the setup and rehearsal above. Do not advertise it as production-ready until those live tests pass.
