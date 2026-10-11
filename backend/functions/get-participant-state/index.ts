import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, isOptions, errorMessage, sha256Hex, consumeRateLimit } from '../_shared/http.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const service = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const UUID_RE = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

Deno.serve(async (request: Request) => {
  if (isOptions(request)) return json({ ok: true });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    if (!await consumeRateLimit(service, request, 'participant-state', 150, 60)) return json({ error: 'Too many requests. Wait a moment and try again.' }, 429);
    const body = await request.json();
    const entryId = String(body?.entryId ?? '');
    const token = String(body?.token ?? '');
    if (!UUID_RE.test(entryId) || !/^[a-f\d]{64}$/i.test(token)) return json({ error: 'Invalid queue session.' }, 400);
    const tokenHash = await sha256Hex(token);
    const { data: secret, error: secretError } = await service.from('participant_secrets').select('queue_entry_id').eq('queue_entry_id', entryId).eq('token_hash', tokenHash).maybeSingle();
    if (secretError) throw secretError;
    if (!secret) return json({ error: 'Queue session not found or token expired.' }, 401);

    const { data: entry, error: entryError } = await service.from('queue_entries').select('id,participant_id,nickname,status,created_at,updated_at,score,ready_deadline,ready_confirmed').eq('id', entryId).maybeSingle();
    if (entryError) throw entryError;
    if (!entry) return json({ found: false });

    if (body?.leave === true) {
      if (!['waiting', 'called'].includes(entry.status)) return json({ error: 'You cannot leave once your turn has started.' }, 409);
      const { error } = await service.from('queue_entries').update({ status: 'removed', updated_at: new Date().toISOString() }).eq('id', entryId).in('status', ['waiting', 'called']);
      if (error) throw error;
      await service.from('audit_log').insert({ action: 'participant_left_queue', details: { entry_id: entryId, nickname: entry.nickname } });
      return json({ left: true });
    }
    if (body?.ready === true) {
      if (entry.status !== 'called') return json({ error: 'Your turn is not being called right now.' }, 409);
      const { data: activated, error } = await service.rpc('arcade_confirm_ready', { p_entry_id: entryId, p_actor: null });
      if (error) return json({ error: errorMessage(error) }, 409);
    }

    const { data: refreshed, error: refreshedError } = await service.from('queue_entries').select('id,participant_id,nickname,status,created_at,updated_at,score,ready_deadline,ready_confirmed').eq('id', entryId).single();
    if (refreshedError) throw refreshedError;
    const { data: event, error: eventError } = await service.from('event_config').select('*').eq('id', true).single();
    if (eventError) throw eventError;
    const { data: queued, error: queueError } = await service.from('queue_entries').select('id,status,created_at').in('status', ['waiting', 'called', 'active']).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1000);
    if (queueError) throw queueError;
    const positionIndex = (queued || []).findIndex((row: any) => row.id === entryId);
    const position = ['waiting', 'called'].includes(refreshed.status) && positionIndex >= 0 ? positionIndex + 1 : null;
    const { data: arcadeState, error: stateError } = await service.from('arcade_state').select('active_session_id').eq('id', true).single();
    if (stateError) throw stateError;
    let active = null;
    if (arcadeState?.active_session_id) {
      const { data: session, error: sessionError } = await service.from('game_sessions').select('id,queue_entry_id,started_at,expires_at,status,current_score,deaths,completed,duration_seconds').eq('id', arcadeState.active_session_id).maybeSingle();
      if (sessionError) throw sessionError;
      if (session) {
        const { data: activeEntry, error: activeEntryError } = await service.from('queue_entries').select('nickname').eq('id', session.queue_entry_id).maybeSingle();
        if (activeEntryError) throw activeEntryError;
        active = { id: session.id, entryId: session.queue_entry_id, nickname: activeEntry?.nickname || 'PLAYER', startedAt: session.started_at, expiresAt: session.expires_at, status: session.status, score: session.current_score, deaths: session.deaths, completed: session.completed, duration: session.duration_seconds };
      }
    }
    const { data: recent, error: recentError } = await service.from('score_records').select('id,score,completed,deaths,created_at').eq('queue_entry_id', entryId).is('invalidated_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (recentError) throw recentError;
    return json({
      found: true,
      entry: { id: refreshed.id, nickname: refreshed.nickname, status: refreshed.status, created_at: refreshed.created_at, score: refreshed.score, ready_deadline: refreshed.ready_deadline, ready_confirmed: refreshed.ready_confirmed },
      position,
      playersAhead: position ? Math.max(0, position - 1) : 0,
      queueLength: (queued || []).length,
      active,
      event,
      recentResult: recent || null,
    });
  } catch (error) {
    console.error('get-participant-state failed:', error);
    return json({ error: errorMessage(error) }, 500);
  }
});
