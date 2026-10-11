# Event-Day Runbook — GDGoC NDU Arcade Challenge

## Before the event

- Confirm the frontend is deployed on HTTPS and the Supabase project has the schema and Edge Functions deployed.
- Sign in at `admin.html` and verify your account is listed in `event_admins`.
- Add the real voucher rules and quantities. Never publish a prize value or sponsor not confirmed by the club.
- Use **Export scores CSV** only after a rehearsal to confirm that saved records match the on-screen scores.
- Rehearse with at least two phones (Android and iPhone if available), including a disconnect while holding a direction button.
- Test a unique voucher serial and confirm that a second award cannot reuse it.

## Start the station

1. Connect the laptop to the monitor/TV/projector and set display mirroring or extended display as needed.
2. Open the deployed `index.html` full-screen in a modern desktop browser.
3. Open `admin.html` in another tab of the same browser profile and sign in. The host tab needs that same organizer session.
4. Confirm the big-screen status says **SUPABASE LIVE** and that the deployed QR points to the `/join.html` page.
5. Open registration from the admin console. Students can now scan and join.
6. Click **Start next player** for the first entrant. Subsequent waiting players advance automatically after the previous turn is recorded.

## While playing

- Keep the laptop awake, browser open and internet connected.
- Watch the queue, turn timer, leaderboard and connection status.
- Pause the queue before changing settings or handling a technical issue.
- For a stuck/expired turn, use **End active turn** only if you accept that this turn will not get a saved score.
- If the event requires readiness confirmation, a called player must confirm before the 15-second default window closes. The host skips expired no-shows.
- Never share the organizer password, Supabase service-role key, or controller token. Do not place any service secret in `config.js`.

## Close and award

1. Close registration when no more entrants should join.
2. Allow the active turn and queue to finish. Review the final leaderboard.
3. Verify any threshold/completion eligibility. These entries are **eligible**, not automatically awarded.
4. Enter the actual unique physical voucher serial when marking a voucher awarded. Record it as claimed only after it is handed over.
5. If configured, use **End event & finalize top 3** only after the final standings are settled. This closes the event and records top-three eligibility.
6. Export the score and voucher-winner CSV files and save them in the club's approved location.

## If something breaks

- **Wrong QR:** stop new participants; check `publicBaseUrl` in `config.js`, republish, scan again on a phone.
- **Queue/API issue:** pause queue, check Supabase project availability and Edge Function logs, then refresh the host after connectivity returns.
- **Controller disconnected:** the host releases stale movement after a short heartbeat timeout. Ask the player to reopen `controller.html` from their queue page.
- **Score not saved:** do not invent a score. Check the host console and `score_records`; record the incident separately for the organizer team.
- **Backend unavailable:** stop starting turns. The browser preview is not a substitute for a working multi-device backend.

A complete rehearsal is mandatory before public use.
