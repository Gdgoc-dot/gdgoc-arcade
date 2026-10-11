import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, isOptions, errorMessage, sha256Hex, consumeRateLimit } from '../_shared/http.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const service = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (request: Request) => {
  if (isOptions(request)) return json({ ok: true });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    if (!await consumeRateLimit(service, request, 'join-queue', 10, 60)) return json({ error: 'Too many join attempts. Please wait a minute and try again.' }, 429);
    const body = await request.json();
    const nickname = String(body?.nickname ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);
    const browserId = String(body?.browserId ?? '').trim();
    if (nickname.length < 2 || nickname.length > 18) return json({ error: 'Nickname must be 2–18 characters.' }, 400);
    if (!/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(browserId)) return json({ error: 'Invalid browser session. Reload the page and try again.' }, 400);
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = [...tokenBytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const tokenHash = await sha256Hex(token);
    const { data: entry, error } = await service.rpc('arcade_join_queue', {
      p_nickname: nickname,
      p_participant_id: browserId,
      p_token_hash: tokenHash,
    });
    if (error) {
      const message = errorMessage(error);
      const status = /already has an active queue entry/i.test(message) ? 409 : /registration is closed|event has ended|maintenance/i.test(message) ? 403 : 400;
      return json({ error: message }, status);
    }
    return json({ entry, token, mode: 'live' }, 201);
  } catch (error) {
    console.error('join-queue failed:', error);
    return json({ error: errorMessage(error) }, 500);
  }
});
