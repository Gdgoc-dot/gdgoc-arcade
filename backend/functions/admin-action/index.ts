import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, isOptions, errorMessage } from '../_shared/http.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const service = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const UUID_RE = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const clampInt = (value: unknown, min: number, max: number, fallback: number) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback));

async function authenticate(request: Request) {
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token || !ANON_KEY) throw new Error('Sign in with the configured organizer account first.');
  const verifier = createClient(URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await verifier.auth.getUser(token);
  if (error || !data?.user) throw new Error('Your organizer session is expired. Sign in again.');
  const { data: adminRow, error: adminError } = await service.from('event_admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
  if (adminError) throw adminError;
  if (!adminRow) throw new Error('This account is not authorized as a GDGoC NDU event organizer.');
  return data.user;
}
async function audit(actorId: string, action: string, details: Record<string, unknown> = {}) {
  const { error } = await service.from('audit_log').insert({ actor_id: actorId, action, details });
  if (error) console.warn('Audit write did not succeed:', error.message);
}
async function dashboard() {
  const [eventRes, queueRes, sessionRes, scoreRes, rewardRes, awardRes] = await Promise.all([
    service.from('event_config').select('*').eq('id', true).single(),
    service.from('queue_entries').select('id,participant_id,nickname,status,created_at,updated_at,score,ready_deadline,ready_confirmed').order('created_at', { ascending: true }).limit(1500),
    service.from('arcade_state').select('active_session_id').eq('id', true).single(),
    service.from('score_records').select('*').order('created_at', { ascending: false }).limit(5000),
    service.from('voucher_rules').select('*').order('created_at', { ascending: true }),
    service.from('voucher_awards').select('*').order('created_at', { ascending: false }).limit(2000),
  ]);
  for (const res of [eventRes, queueRes, sessionRes, scoreRes, rewardRes, awardRes]) if (res.error) throw res.error;
  let activeSession = null;
  if (sessionRes.data?.active_session_id) {
    const { data, error } = await service.from('game_sessions').select('*').eq('id', sessionRes.data.active_session_id).maybeSingle();
    if (error) throw error;
    if (data) {
      const { data: entry, error: entryError } = await service.from('queue_entries').select('nickname').eq('id', data.queue_entry_id).maybeSingle();
      if (entryError) throw entryError;
      activeSession = { ...data, nickname: entry?.nickname || 'PLAYER' };
    }
  }
  const rewardLabels = new Map((rewardRes.data || []).map((r: any) => [r.id, r.label]));
  const awards = (awardRes.data || []).map((a: any) => ({ ...a, reward_label: rewardLabels.get(a.reward_id) || 'Reward' }));
  return { event: eventRes.data, queue: queueRes.data || [], activeSession, scores: scoreRes.data || [], rewards: rewardRes.data || [], awards };
}

Deno.serve(async (request: Request) => {
  if (isOptions(request)) return json({ ok: true });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let actor: any = null;
  try {
    actor = await authenticate(request);
    const body = await request.json();
    const action = String(body?.action || '');
    const p = body || {};
    let result: unknown = { ok: true };
    switch (action) {
      case 'get-dashboard':
        result = await dashboard();
        break;
      case 'open-registration': {
        const { error } = await service.from('event_config').update({ registration_open: true, event_ended: false, queue_paused: false, maintenance_message: '', updated_at: new Date().toISOString() }).eq('id', true);
        if (error) throw error; await audit(actor.id, action); break;
      }
      case 'close-registration': {
        const { error } = await service.from('event_config').update({ registration_open: false, updated_at: new Date().toISOString() }).eq('id', true);
        if (error) throw error; await audit(actor.id, action); break;
      }
      case 'pause-queue': {
        const { error } = await service.from('event_config').update({ queue_paused: true, updated_at: new Date().toISOString() }).eq('id', true);
        if (error) throw error; await audit(actor.id, action); break;
      }
      case 'resume-queue': {
        const { error } = await service.from('event_config').update({ queue_paused: false, updated_at: new Date().toISOString() }).eq('id', true);
        if (error) throw error; await audit(actor.id, action); break;
      }
      case 'start-next': {
        const { data, error } = await service.rpc('arcade_start_next', { p_actor: actor.id });
        if (error) throw error; result = data; break;
      }
      case 'advance-stale': {
        const { data, error } = await service.rpc('arcade_advance_stale', { p_actor: actor.id });
        if (error) throw error; result = data; break;
      }
      case 'finish-turn': {
        if (!UUID_RE.test(String(p.sessionId || ''))) throw new Error('Invalid game session ID.');
        const safeResult = p.result && typeof p.result === 'object' ? p.result : {};
        const { data, error } = await service.rpc('arcade_finish_turn', { p_session_id: p.sessionId, p_result: safeResult, p_actor: actor.id });
        if (error) throw error; result = data; break;
      }
      case 'end-active-turn': {
        const { data, error } = await service.rpc('arcade_cancel_active_turn', { p_actor: actor.id, p_reason: 'Organizer ended active turn without a score' });
        if (error) throw error; result = data; break;
      }
      case 'save-settings': {
        const duration = clampInt(p.turnDuration, 15, 180, 60);
        const { error } = await service.from('event_config').update({ turn_duration_seconds: duration, require_ready: Boolean(p.requireReady), repeat_attempts_enabled: p.repeatAttempts !== false, updated_at: new Date().toISOString() }).eq('id', true);
        if (error) throw error; await audit(actor.id, action, { turn_duration_seconds: duration, require_ready: Boolean(p.requireReady), repeat_attempts_enabled: p.repeatAttempts !== false }); break;
      }
      case 'save-maintenance': {
        const message = String(p.message || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 300);
        const { error } = await service.from('event_config').update({ maintenance_message: message, updated_at: new Date().toISOString() }).eq('id', true);
        if (error) throw error; await audit(actor.id, action, { has_message: Boolean(message) }); break;
      }
      case 'clear-queue': {
        const { data, error } = await service.rpc('arcade_clear_queue', { p_actor: actor.id });
        if (error) throw error; result = { removed: data }; break;
      }
      case 'skip-entry':
      case 'remove-entry': {
        if (!UUID_RE.test(String(p.entryId || ''))) throw new Error('Invalid queue entry ID.');
        const status = action === 'skip-entry' ? 'skipped' : 'removed';
        const { data, error } = await service.from('queue_entries').update({ status, updated_at: new Date().toISOString(), ready_deadline: null }).eq('id', p.entryId).in('status', ['waiting', 'called']).select('id,nickname,status').maybeSingle();
        if (error) throw error; if (!data) throw new Error('The participant is no longer waiting and could not be changed.');
        await audit(actor.id, action, { entry_id: data.id, nickname: data.nickname }); result = data; break;
      }
      case 'add-reward': {
        const label = String(p.label || '').trim().slice(0, 80);
        const type = String(p.type || 'score');
        if (!label || !['score', 'complete', 'top3'].includes(type)) throw new Error('Provide a reward name and a supported eligibility rule.');
        const payload = { label, reward_type: type, threshold: type === 'score' ? clampInt(p.threshold, 0, 1000000, 0) : 0, quantity: clampInt(p.quantity, 1, 500, 1), enabled: true, created_by: actor.id };
        const { data, error } = await service.from('voucher_rules').insert(payload).select('*').single();
        if (error) throw error; await audit(actor.id, action, { reward_id: data.id, type }); result = data; break;
      }
      case 'delete-reward': {
        if (!UUID_RE.test(String(p.rewardId || ''))) throw new Error('Invalid reward ID.');
        const { error } = await service.from('voucher_rules').update({ enabled: false }).eq('id', p.rewardId);
        if (error) throw error; await audit(actor.id, action, { reward_id: p.rewardId }); break;
      }
      case 'invalidate-score': {
        if (!UUID_RE.test(String(p.scoreId || ''))) throw new Error('Invalid score ID.');
        const reason = String(p.reason || '').trim().slice(0, 300); if (reason.length < 3) throw new Error('An invalidation reason is required.');
        const { data, error } = await service.from('score_records').update({ invalidated_at: new Date().toISOString(), invalidated_by: actor.id, invalidation_reason: reason }).eq('id', p.scoreId).is('invalidated_at', null).select('id,nickname,score').maybeSingle();
        if (error) throw error; if (!data) throw new Error('Score was already invalidated or was not found.');
        await audit(actor.id, action, { score_id: p.scoreId, reason }); result = data; break;
      }
      case 'reset-leaderboard': {
        const reason = String(p.reason || '').trim().slice(0, 300);
        const { data, error } = await service.rpc('arcade_reset_leaderboard', { p_actor: actor.id, p_reason: reason });
        if (error) throw error; result = { invalidated: data }; break;
      }
      case 'set-award-status': {
        if (!UUID_RE.test(String(p.awardId || ''))) throw new Error('Invalid award ID.');
        const status = String(p.status || '');
        if (status === 'awarded') {
          const voucherCode = String(p.voucherCode || '').trim().slice(0, 100);
          if (voucherCode.length < 2) throw new Error('Enter the actual unique voucher serial/code before marking it awarded.');
          const { data, error } = await service.from('voucher_awards').update({ status: 'awarded', voucher_code: voucherCode, awarded_at: new Date().toISOString(), updated_by: actor.id }).eq('id', p.awardId).eq('status', 'eligible').select('*').maybeSingle();
          if (error) throw error; if (!data) throw new Error('This reward is no longer eligible for awarding.'); result = data;
        } else if (status === 'claimed') {
          const { data, error } = await service.from('voucher_awards').update({ status: 'claimed', claimed_at: new Date().toISOString(), updated_by: actor.id }).eq('id', p.awardId).eq('status', 'awarded').not('voucher_code', 'is', null).is('claimed_at', null).select('*').maybeSingle();
          if (error) throw error; if (!data) throw new Error('This voucher must be awarded with a unique code before it can be claimed.'); result = data;
        } else if (status === 'revoked') {
          const { data, error } = await service.from('voucher_awards').update({ status: 'revoked', updated_by: actor.id }).eq('id', p.awardId).in('status', ['eligible', 'awarded']).select('*').maybeSingle();
          if (error) throw error; if (!data) throw new Error('This award can no longer be revoked.'); result = data;
        } else throw new Error('Unsupported award status.');
        await audit(actor.id, 'voucher_award_status_changed', { award_id: p.awardId, status }); break;
      }
      case 'end-event': {
        const { data, error } = await service.rpc('arcade_end_event', { p_actor: actor.id });
        if (error) throw error; result = data; break;
      }
      default:
        return json({ error: 'Unknown organizer action.' }, 400);
    }
    return json({ ok: true, result });
  } catch (error) {
    const message = errorMessage(error);
    console.error('admin-action failed:', actionSafe(request), message);
    const status = /session is expired|sign in|not authorized|not an event admin/i.test(message) ? 403 : 400;
    return json({ error: message }, status);
  }
});
function actionSafe(_request: Request) { return 'request'; }
