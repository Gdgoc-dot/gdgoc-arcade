import { supabase, backendConfigured } from './client.js';
import { demoStore, leaderboardFrom } from './demo-store.js';

async function checked(queryPromise) {
  const { data, error } = await queryPromise;
  if (error) throw error;
  return data;
}
export async function getPublicSnapshot() {
  if (!backendConfigured) {
    const demo = demoStore.get();
    const queued = demo.queue.filter(row => ['waiting','called','active'].includes(row.status));
    const active = demo.activeSession;
    return {
      mode: 'demo', event: { registration_open: demo.event.registrationOpen, event_ended: demo.event.eventEnded, queue_paused: demo.event.queuePaused, turn_duration_seconds: demo.event.turnDuration, maintenance_message: demo.event.maintenanceMessage },
      queue: queued.map(row => ({ id:row.id,nickname:row.nickname,status:row.status,created_at:row.createdAt })),
      activeSession: active ? { id:active.id,queue_entry_id:active.entryId,nickname:active.nickname,started_at:new Date(active.startedAt).toISOString(),expires_at:new Date(active.expiresAt).toISOString(),score:active.score,deaths:active.deaths,status:'active' } : null,
      leaderboard: leaderboardFrom(demo.scores), scores: demo.scores, rewards: demo.rewards,
    };
  }
  const [event, queue, sessions, leaderboard, scores, rewards] = await Promise.all([
    checked(supabase.from('event_config').select('*').eq('id', true).maybeSingle()),
    checked(supabase.from('queue_entries').select('id,nickname,status,created_at,participant_id,ready_deadline,ready_confirmed').in('status',['waiting','called','active']).order('created_at',{ascending:true}).limit(500)),
    checked(supabase.from('game_sessions').select('id,queue_entry_id,started_at,expires_at,status,current_score,deaths,completed').in('status',['countdown','active']).order('started_at',{ascending:false}).limit(1)),
    checked(supabase.from('leaderboard_public').select('*').order('rank',{ascending:true}).limit(100)),
    checked(supabase.from('score_records').select('id,queue_entry_id,participant_id,nickname,score,completed,deaths,created_at,invalidated_at').order('created_at',{ascending:false}).limit(1000)),
    checked(supabase.from('voucher_rules_public').select('*').order('label',{ascending:true})),
  ]);
  const activeRaw = sessions?.[0] || null;
  const activeEntry = activeRaw ? queue?.find(item => item.id === activeRaw.queue_entry_id) : null;
  return { mode:'live', event, queue:queue || [], activeSession:activeRaw ? {...activeRaw,nickname:activeEntry?.nickname || 'PLAYER'} : null, leaderboard:leaderboard || [], scores:scores || [], rewards:rewards || [] };
}
export async function joinQueue(nickname, browserId) {
  if (!backendConfigured) return { mode:'demo', entry: demoStore.join(nickname,browserId) };
  const { data, error } = await supabase.functions.invoke('join-queue',{body:{nickname,browserId}});
  if(error) throw error;
  if(data?.error) throw new Error(data.error);
  return { mode:'live', ...data };
}
export async function getParticipantState(entryId, token) {
  if (!backendConfigured) {
    const demo=demoStore.get(); const entry=demo.queue.find(row=>row.id===entryId && row.token===token);
    if(!entry) return { found:false };
    const queue=demo.queue.filter(row=>['waiting','called','active'].includes(row.status));
    const index=queue.findIndex(row=>row.id===entry.id);
    return { found:true,entry:{id:entry.id,nickname:entry.nickname,status:entry.status},position:index>=0?index+1:null,playersAhead:index>0?index:0,queueLength:queue.length,active:demo.activeSession?{id:demo.activeSession.id,entryId:demo.activeSession.entryId,nickname:demo.activeSession.nickname,startedAt:new Date(demo.activeSession.startedAt).toISOString(),expiresAt:new Date(demo.activeSession.expiresAt).toISOString(),score:demo.activeSession.score,deaths:demo.activeSession.deaths}:null,event:demo.event, recentResult:demo.scores.filter(s=>s.entryId===entry.id).at(-1)||null };
  }
  const {data,error}=await supabase.functions.invoke('get-participant-state',{body:{entryId,token}});
  if(error) throw error;
  if(data?.error) throw new Error(data.error);
  return data;
}
export async function adminAction(action, payload={}) {
  if(!backendConfigured) throw new Error('Organizer actions require the configured Supabase backend and an authenticated organizer account.');
  const {data,error}=await supabase.functions.invoke('admin-action',{body:{action,...payload}});
  if(error) throw error;
  if(data?.error) throw new Error(data.error);
  return data?.result !== undefined ? data.result : data;
}
export async function getHostState() {
  if(!backendConfigured) {
    const demo=demoStore.get(); const session=demo.activeSession; const entry=session?demo.queue.find(row=>row.id===session.entryId):null;
    return {event:demo.event,queue:demo.queue,activeSession:session?{...session,nickname:session.nickname,controller_token_hash:null,entryStatus:entry?.status}:null,scores:demo.scores};
  }
  const {data,error}=await supabase.rpc('arcade_host_state');
  if(error) throw error;
  return data;
}
export function subscribePublicChanges(callback) {
  if(!backendConfigured) return demoStore.subscribe(callback);
  const channel=supabase.channel('arcade-public-state').on('postgres_changes',{event:'*',schema:'public',table:'queue_entries'},callback).on('postgres_changes',{event:'*',schema:'public',table:'event_config'},callback).on('postgres_changes',{event:'*',schema:'public',table:'game_sessions'},callback).on('postgres_changes',{event:'*',schema:'public',table:'score_records'},callback).subscribe();
  return ()=>supabase.removeChannel(channel);
}
export async function createControlChannel(channelKey, onInput = () => {}, onGameState = () => {}) {
  if(!backendConfigured) return { send:async()=>{}, sendState:async()=>{}, close:()=>{} };
  // The topic is a bearer capability derived from the random per-entry token hash.
  // Do not use a shared public topic: that would expose active controller traffic to other participants.
  if(!/^[a-f\d]{64}$/i.test(String(channelKey || ''))) throw new Error('Invalid controller channel key.');
  const channel=supabase.channel(`arcade-controls-${channelKey}`,{config:{broadcast:{ack:false,self:false}}});
  channel.on('broadcast',{event:'input'},({payload})=>onInput(payload));
  channel.on('broadcast',{event:'game-state'},({payload})=>onGameState(payload));
  try {
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Timed out connecting to arcade realtime channel.')),12000);
      channel.subscribe(status=>{
        if(status==='SUBSCRIBED'){clearTimeout(timeout);resolve(true);}
        else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){clearTimeout(timeout);reject(new Error(`Realtime controller channel status: ${status}`));}
      });
    });
  } catch (error) {
    await supabase.removeChannel(channel);
    throw error;
  }
  return { send:payload=>channel.send({type:'broadcast',event:'input',payload}), sendState:payload=>channel.send({type:'broadcast',event:'game-state',payload}), close:()=>supabase.removeChannel(channel) };
}
