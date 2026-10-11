import { backendConfigured, publicBaseUrl } from '../services/client.js';
import { $, escapeHtml, toast } from '../services/utils.js';
import { getPublicSnapshot, getHostState, subscribePublicChanges, createControlChannel, adminAction } from '../services/api.js';
import { demoStore } from '../services/demo-store.js';
import { ArcadeGame } from '../game/physics.js';

const canvas=$('#game-canvas');
const initialOverlayMarkup=$('#stage-overlay').innerHTML;
const game=new ArcadeGame(canvas, { onUpdate: updateHud, onEnd: handleTurnEnd, onDeath: result=>{ $('#stage-hint').textContent=`Oof. Death ${result.deaths} — go again!`; }, onCheckpoint: info=>{ $('#stage-hint').textContent=`Checkpoint ${info.count} secured`; } });
let snapshot=null, hostState=null, activeId=null, controlChannel=null, activeTokenHash=null, keyboardControls={left:false,right:false,jump:false}, phoneControls={left:false,right:false,jump:false}, lastPhoneInputAt=0, lastInputReceivedAt=0, countdownTimer=null, endingSessionIds=new Set(), refreshPending=false, lastBroadcastAt=0, autoAdvanceTimer=null;
const allowKeyboard = !backendConfigured || new URLSearchParams(location.search).get('keyboard') === '1';

function joinUrl(){ return new URL('join.html', publicBaseUrl()).href; }
function setupJoinQr(){
  const url=joinUrl(); $('#join-url').textContent=url;
  const qr=$('#qr-code'); qr.innerHTML='';
  const livePublic = /^https:\/\//i.test(url) && !/localhost|127\.0\.0\.1/i.test(url);
  if(!livePublic){ qr.innerHTML='<div class="qr-placeholder"><span>▦</span><small>DEPLOY TO<br>ENABLE QR</small></div>'; return; }
  if(window.QRCode){ new window.QRCode(qr,{text:url,width:210,height:210,colorDark:'#111522',colorLight:'#f7f8f3',correctLevel:window.QRCode.CorrectLevel.H}); }
  else qr.innerHTML='<div class="qr-placeholder"><span>▦</span><small>QR LIBRARY<br>UNAVAILABLE</small></div>';
}
function effectiveLeaderboard(data){
  const rows=data?.leaderboard||[];
  return rows.map((row,index)=>({rank:row.rank||index+1,nickname:row.nickname||'PLAYER',score:Number(row.score)||0,completed:Boolean(row.completed),created_at:row.created_at||row.createdAt}));
}
function renderTop(data){
  const rows=effectiveLeaderboard(data).slice(0,5); const node=$('#top-list');
  if(!rows.length){node.innerHTML='<div class="empty-state">First score takes the throne.</div>';return;}
  node.innerHTML=rows.map((r,i)=>`<div class="top-row"><span class="rank-badge">${i+1}</span><span><span class="top-name">${escapeHtml(r.nickname)}</span><small class="top-caption">${r.completed?'LEVEL CLEARED':'RUN RECORDED'}</small></span><b class="top-score">${r.score.toLocaleString()}</b></div>`).join('');
}
function renderQueue(data){
  const queue=data?.queue||[]; const active=data?.activeSession;
  $('#queue-count').textContent=String(queue.filter(p=>p.status==='waiting'||p.status==='called').length);
  $('#current-player').textContent=active?.nickname||queue.find(p=>p.status==='active')?.nickname||'—';
  renderTop(data);
  const rules=(data?.rewards||[]).filter(r=>r.enabled!==false).map(r=>r.reward_type==='score'?`${r.label}: ${Number(r.threshold||0).toLocaleString()}+ pts`:r.reward_type==='complete'?`${r.label}: clear the level`:`${r.label}: final top 3`);
  if(rules.length) $('.voucher-note small').textContent=rules.slice(0,2).join(' · ');
}
function updateHud(s){
  $('#hud-time').textContent=`${Math.max(0,s.timeRemaining).toFixed(1)}s`;
  $('#hud-score').textContent=String(s.score).padStart(4,'0');
  $('#hud-deaths').textContent=String(s.deaths);
  const now=performance.now();
  if(backendConfigured && game.started && lastPhoneInputAt && now-lastPhoneInputAt>520 && (phoneControls.left||phoneControls.right||phoneControls.jump)){phoneControls={left:false,right:false,jump:false};applyCombinedControls();}
  if(controlChannel && backendConfigured && activeId && now-lastBroadcastAt>140){
    const current=normalizeActive(hostState,snapshot);
    if(current) controlChannel.sendState({entryId:current.entryId,sessionId:activeId,channelKey:activeTokenHash,score:s.score,timeRemaining:s.timeRemaining,deaths:s.deaths,completed:s.completed}).catch?.(()=>{});
    lastBroadcastAt=now;
  }
}
async function refresh(){
  if(refreshPending) return; refreshPending=true;
  try{
    snapshot=await getPublicSnapshot(); renderQueue(snapshot);
    if(backendConfigured){
      try{hostState=await getHostState();}
      catch(err){hostState=null; $('#stage-hint').textContent='Organizer must sign in on this browser to operate live turns.';}
    } else hostState=await getHostState();
    const active=backendConfigured && !hostState ? null : normalizeActive(hostState,snapshot);
    await syncActiveGame(active);
    if(backendConfigured && hostState?.event?.require_ready){
      const staleCalled=(hostState.queue||[]).find(q=>q.status==='called' && q.ready_deadline && new Date(q.ready_deadline).getTime()<Date.now());
      if(staleCalled) adminAction('advance-stale').then(()=>refresh()).catch(()=>{});
    }
    const event=snapshot.event||{};
    if(event.maintenance_message){$('#stage-status').textContent='MAINTENANCE';$('#stage-hint').textContent=event.maintenance_message;}
    else if(event.event_ended){$('#stage-status').textContent='EVENT ENDED';$('#stage-hint').textContent='Thanks for playing GDGoC NDU Arcade!';if(!active)showEventEnded();}
    else if(event.queue_paused){$('#stage-status').textContent='QUEUE PAUSED';$('#stage-hint').textContent='Queue paused by organizer';}
    else if(!active){$('#stage-status').textContent=backendConfigured?'READY FOR PLAYER':'LOCAL PREVIEW MODE';$('#stage-hint').textContent=backendConfigured?'Scan the QR to take your turn':'Preview only · press Enter for a local game test';}
    $('#connection-label').textContent=backendConfigured?(hostState?'SUPABASE LIVE':'HOST AUTH REQUIRED'):'LOCAL PREVIEW';
  }catch(err){console.error(err);$('#connection-label').textContent='CONNECTION ISSUE';$('#stage-hint').textContent='Unable to load live state. Check backend connection.';}
  finally{refreshPending=false;}
}
function normalizeActive(host,snap){
  const candidate=host?.activeSession||host?.active_session||snap?.activeSession||null;
  if(!candidate)return null;
  if(['finished','expired','cancelled','skipped'].includes(candidate.status))return null;
  const start = candidate.startedAt || candidate.started_at || candidate.startAt;
  const exp = candidate.expiresAt || candidate.expires_at;
  return { ...candidate, id:candidate.id||candidate.session_id, entryId:candidate.entryId||candidate.queue_entry_id, nickname:candidate.nickname||candidate.player_name||'PLAYER', startedAt:start?new Date(start).getTime():Date.now(), expiresAt:exp?new Date(exp).getTime():Date.now()+60000, status:candidate.status||'active', tokenHash:candidate.controller_token_hash||candidate.tokenHash||null, duration:Number(candidate.duration||candidate.turn_duration_seconds)||60, score:Number(candidate.current_score||candidate.score)||0, deaths:Number(candidate.deaths)||0 };
}
function closeControlChannel(){
  if(controlChannel){const old=controlChannel;controlChannel=null;try{old.close();}catch{}}
}
async function attachControlChannelForTurn(active){
  if(!backendConfigured||!active?.tokenHash)return;
  const channelKey=active.tokenHash;
  try{
    const nextChannel=await createControlChannel(channelKey,async payload=>{
      const current=normalizeActive(hostState,snapshot);
      if(!current||!activeTokenHash||payload?.entryId!==current.entryId||payload?.sessionId!==current.id||payload?.channelKey!==activeTokenHash)return;
      if(Date.now()>=current.expiresAt)return;
      if(performance.now()-lastInputReceivedAt<16)return;
      // The controller token never travels over Realtime. The high-entropy channel topic and
      // matching channelKey bind messages to this one queue entry and game session.
      lastInputReceivedAt=performance.now();lastPhoneInputAt=lastInputReceivedAt;
      phoneControls={left:payload.controls?.left===true,right:payload.controls?.right===true,jump:payload.controls?.jump===true};applyCombinedControls();
    });
    if(activeId!==active.id||activeTokenHash!==channelKey){nextChannel.close();return;}
    closeControlChannel();controlChannel=nextChannel;
  }catch(err){console.error(err);if(activeId===active.id)$('#stage-hint').textContent='Realtime controls disconnected. Refresh after checking internet.';}
}
async function syncActiveGame(active){
  if(!active){
    if(activeId){game.stop();activeId=null; activeTokenHash=null;clearTimeout(countdownTimer);$('#stage-overlay').hidden=false;$('#stage-hud').hidden=true;$('#hud-player').textContent='—';}
    closeControlChannel();return;
  }
  if(active.id===activeId){
    activeTokenHash=active.tokenHash||activeTokenHash;
    if(backendConfigured&&activeTokenHash&&!controlChannel)void attachControlChannelForTurn(active);
    return;
  }
  closeControlChannel();activeId=active.id;activeTokenHash=active.tokenHash;clearTimeout(countdownTimer);
  if(backendConfigured&&activeTokenHash)void attachControlChannelForTurn(active);
  $('#stage-overlay').hidden=true;$('#stage-hud').hidden=false;$('#hud-player').textContent=active.nickname;$('#stage-status').textContent='PLAYER ACTIVE';$('#stage-hint').textContent=`${active.nickname} is in the arena. Cheer them on!`;
  const wait=Math.max(0,active.startedAt-Date.now());
  if(wait>0){
    $('#stage-status').textContent='GET READY';$('#stage-hint').textContent=`${active.nickname} starts in 3…`;
    countdownTimer=setTimeout(()=>beginGame(active),wait);
  }else beginGame(active);
}
function beginGame(active){
  if(active.id!==activeId)return;
  if(!backendConfigured){
    game.start({nickname:active.nickname,duration:Math.max(1,(active.expiresAt-Date.now())/1000)});return;
  }
  const remaining=Math.max(1,(active.expiresAt-Date.now())/1000);
  game.start({nickname:active.nickname,duration:remaining});
}
function showTurnResult(result){
  const active=normalizeActive(hostState,snapshot);
  const oldRows=(snapshot?.leaderboard||[]).map((r,i)=>({participant_id:r.participant_id||r.participantId,nickname:r.nickname||'PLAYER',score:Number(r.score)||0,completed:Boolean(r.completed),created_at:r.created_at||r.createdAt,rank:r.rank||i+1}));
  const currentQueueEntry=(hostState?.queue||snapshot?.queue||[]).find(q=>q.id===active?.entryId);
  const pid=currentQueueEntry?.participant_id||currentQueueEntry?.participantId||currentQueueEntry?.browserId||active?.entryId;
  const previous=oldRows.find(r=>r.participant_id&&r.participant_id===pid);
  const personalBest=Math.max(result.score,Number(previous?.score)||0);
  let ranked=oldRows.filter(r=>!pid||r.participant_id!==pid);ranked.push({participant_id:pid,nickname:result.nickname,score:personalBest,completed:result.completed,created_at:new Date().toISOString()});
  ranked.sort((a,b)=>b.score-a.score||new Date(a.created_at)-new Date(b.created_at));
  const rank=ranked.findIndex(r=>r.participant_id===pid&&r.nickname===result.nickname)+1;
  const next=(snapshot?.queue||[]).find(q=>q.status==='waiting'||q.status==='called');
  const eligible=(snapshot?.rewards||[]).filter(r=>r.reward_type==='score'?result.score>=Number(r.threshold||0):r.reward_type==='complete'?result.completed:false).map(r=>r.label);
  $('#stage-overlay').innerHTML=`<div class="overlay-chip">${result.completed?'LEVEL CLEARED':'TURN COMPLETE'}</div><h1>${result.completed?'NICE RUN.':"TIME'S UP."}<br><em>${result.score.toLocaleString()} PTS</em></h1><p>${escapeHtml(result.nickname)} · ${result.deaths} deaths · personal best ${personalBest.toLocaleString()} · rank #${rank||'—'}</p>${eligible.length?`<p class="result-reward">✦ Reward eligible: ${escapeHtml(eligible.join(', '))}<br><small>Organizer verification required.</small></p>`:''}<div class="key-hints"><span>NEXT UP: <b>${escapeHtml(next?.nickname||'SCAN TO JOIN')}</b></span><span>${next?'NEXT TURN STARTS SOON':'KEEP THE CHALLENGE GOING'}</span></div>`;
  $('#stage-overlay').hidden=false;$('#stage-hud').hidden=true;
  if(!next && !snapshot?.event?.event_ended){setTimeout(()=>{if(!activeId){$('#stage-overlay').innerHTML=initialOverlayMarkup;}},8500);}
}
function showEventEnded(){
  $('#stage-overlay').innerHTML='<div class="overlay-chip">EVENT COMPLETE</div><h1>GG, <em>EVERYONE.</em></h1><p>Final standings are in. Check the leaderboard and visit the booth to verify voucher winners.</p><div class="key-hints"><span>FINAL LEADERBOARD</span><span>THANK YOU FOR PLAYING</span></div>';$('#stage-overlay').hidden=false;$('#stage-hud').hidden=true;
}
async function handleTurnEnd(result){
  $('#stage-status').textContent=result.completed?'LEVEL CLEARED':'TIME UP';
  $('#stage-hint').textContent=`${result.nickname}: ${result.score.toLocaleString()} points · ${result.deaths} deaths`;
  showTurnResult(result);
  if(!activeId || endingSessionIds.has(activeId))return;
  const sessionId=activeId;endingSessionIds.add(sessionId);
  // Revoke input immediately, before awaiting persistence or the next queue transition.
  activeId=null;activeTokenHash=null;closeControlChannel();phoneControls={left:false,right:false,jump:false};applyCombinedControls();
  let saved=false;
  try{
    if(backendConfigured) await adminAction('finish-turn',{sessionId,result:{score:result.score,completed:result.completed,deaths:result.deaths,furthestX:result.furthestX,checkpoints:result.checkpoints,timeRemaining:Math.floor(result.timeRemaining)}});
    else demoStore.finishTurn(result);
    saved=true;
  }catch(err){console.error(err);toast(`Turn ended, but score could not be saved: ${err.message}`,'error',6000);}
  setTimeout(refresh,450);
  if(backendConfigured && saved) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer=setTimeout(()=>adminAction('start-next').then(()=>refresh()).catch(err=>{if(!/no participants are waiting/i.test(err.message||''))console.warn('Auto-advance:',err.message);}),3500); }
  setTimeout(()=>endingSessionIds.delete(sessionId),12000);
}
function applyCombinedControls(){
  game.setControls({
    left: keyboardControls.left || phoneControls.left,
    right: keyboardControls.right || phoneControls.right,
    jump: keyboardControls.jump || phoneControls.jump,
  });
}
function keyboardControlForKey(key){
  const normalized=String(key).toLowerCase();
  if(normalized==='arrowleft'||normalized==='a')return 'left';
  if(normalized==='arrowright'||normalized==='d')return 'right';
  if(normalized===' '||normalized==='arrowup'||normalized==='w')return 'jump';
  return null;
}
function keyboardDown(event){
  if(!allowKeyboard||!game.started)return;
  const control=keyboardControlForKey(event.key);
  if(!control)return;
  event.preventDefault();
  keyboardControls[control]=true;
  applyCombinedControls();
}
function keyboardUp(event){
  const control=keyboardControlForKey(event.key);
  if(!control)return;
  event.preventDefault();
  keyboardControls[control]=false;
  applyCombinedControls();
}
window.addEventListener('keydown',e=>{if(e.key==='Enter'&&!backendConfigured&&!game.started){try{demoStore.startPractice('LOCAL TESTER');refresh();}catch(err){toast(err.message,'error');}return;}keyboardDown(e);});
window.addEventListener('keyup',keyboardUp);
window.addEventListener('blur',()=>{keyboardControls={left:false,right:false,jump:false};phoneControls={left:false,right:false,jump:false};applyCombinedControls();});
window.addEventListener('resize',()=>game.resizeCanvas());
setupJoinQr();
refresh();
subscribePublicChanges(()=>{refresh();});
setInterval(refresh,4000);
