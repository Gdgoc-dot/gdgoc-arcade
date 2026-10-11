import { backendConfigured } from '../services/client.js';
import { $, cleanNickname, toast, escapeHtml } from '../services/utils.js';
import { getPublicSnapshot, joinQueue, getParticipantState, subscribePublicChanges } from '../services/api.js';

const SESSION_KEY='gdgoc-arcade-participant';
const BROWSER_KEY='gdgoc-arcade-browser-id';
let participant=null, lastState=null, busy=false;
function browserId(){let id=localStorage.getItem(BROWSER_KEY);if(!id){id=crypto.randomUUID();localStorage.setItem(BROWSER_KEY,id);}return id;}
function setFormVisible(visible){$('#join-card').hidden=!visible;$('#queue-card').hidden=visible;}
function setError(message=''){$('#join-error').textContent=message;}
function updateCharCount(){const val=$('#nickname').value;$('#char-count').textContent=`${val.length} / 18`;}
async function refreshEvent(){
  try{const data=await getPublicSnapshot();const event=data.event||{};const closed=!event.registration_open||event.event_ended||Boolean(event.maintenance_message);
    $('#join-btn').disabled=closed;
    if(closed){$('#join-btn').textContent=event.event_ended?'EVENT HAS ENDED':'REGISTRATION CLOSED';setError(event.maintenance_message||'Registration is closed right now. Please ask the booth organizer.');}
    else if(event.maintenance_message){setError(event.maintenance_message);}else if(!participant)setError('');
  }catch(err){console.warn(err);}
}
function showState(state){
  lastState=state;
  if(!state?.found){localStorage.removeItem(SESSION_KEY);participant=null;setFormVisible(true);return;}
  setFormVisible(false);
  const entry=state.entry||{};const status=entry.status;
  const queuePosition=state.position;
  $('#queue-position').textContent=queuePosition?`#${String(queuePosition).padStart(2,'0')}`:(status==='active'?'GO!':'—');
  $('#players-ahead').textContent=String(Math.max(0,Number(state.playersAhead)||0));
  const waitSeconds=Math.max(0,Number(state.playersAhead)||0)*(Number(state.event?.turn_duration_seconds||state.event?.turnDuration)||60);
  $('#wait-estimate').textContent=status==='active'?'NOW':status==='played'?'DONE':`~${Math.ceil(waitSeconds/60)} min`;
  const heading=$('#queue-heading'), sub=$('#queue-subheading'), ready=$('#ready-panel'), leave=$('#leave-queue');
  ready.hidden=true;leave.hidden=false;
  if(status==='active'){
    heading.textContent="You're up, runner!";sub.textContent='Your controller is ready. Keep this tab open during your turn.';
    $('#queue-position').textContent='GO!';ready.hidden=false;ready.innerHTML='<span class="ready-pulse"></span><div><b>IT’S YOUR TURN!</b><small>Tap below to open your controller.</small></div><a class="primary-btn" style="margin-left:auto;padding:10px" href="controller.html">PLAY ↗</a>';
    leave.hidden=true;
  }else if(status==='called'){
    heading.textContent='You are next!';sub.textContent='Your turn is coming up. Be ready and confirm when you see the prompt.';
    ready.hidden=false;ready.innerHTML='<span class="ready-pulse"></span><div><b>GET READY</b><small>Tap when you are ready to play.</small></div><button id="confirm-ready" class="primary-btn" style="margin-left:auto;padding:10px">I’M READY</button>';
    $('#confirm-ready')?.addEventListener('click',confirmReady,{once:true});
  }else if(status==='played'){
    heading.textContent='Run complete!';sub.textContent='Nice run. Your score has been recorded.';$('#queue-position').textContent='GG';leave.hidden=true;
    const res=state.recentResult;$('#my-result').hidden=false;const canRepeat=state.event?.repeat_attempts_enabled!==false;$('#my-result').innerHTML=`<div class="eyebrow">YOUR RESULT</div><h2 style="margin:9px 0">${Number(res?.score||entry.score||0).toLocaleString()} <span style="color:var(--lime);font-size:12px">PTS</span></h2><p class="muted">${res?.completed?'Level cleared!':'Every run is practice.'}</p>${canRepeat?'<button id="rejoin-btn" class="primary-btn wide">JOIN THE QUEUE AGAIN ↗</button>':'<p class="muted">Repeat attempts are disabled for this event.</p>'}`;
    $('#rejoin-btn')?.addEventListener('click',()=>rejoin(),{once:true});
  }else if(['skipped','removed'].includes(status)){
    heading.textContent='Queue spot released';sub.textContent='Your spot was skipped or removed. You can join again.';leave.hidden=true;
    $('#my-result').hidden=false;$('#my-result').innerHTML='<button id="rejoin-btn" class="primary-btn wide">REJOIN THE QUEUE ↗</button>';
    $('#rejoin-btn')?.addEventListener('click',()=>rejoin(),{once:true});
  }else{
    heading.textContent='You’re in the queue!';sub.textContent='Keep this page open. We’ll let you know when it’s your turn.';$('#my-result').hidden=true;
  }
}
async function confirmReady(){
  if(!participant)return;
  try{
    if(backendConfigured){const {supabase}=await import('../services/client.js');const {data,error}=await supabase.functions.invoke('get-participant-state',{body:{entryId:participant.entryId,token:participant.token,ready:true}});if(error)throw error;if(data?.error)throw new Error(data.error);showState(data);toast('Ready confirmation sent.','success');}
    else {toast('Readiness confirmation is available after backend setup.','error');}
  }catch(err){toast(err.message||'Could not confirm readiness.','error');}
}
async function loadParticipant(){
  if(!participant||busy)return;busy=true;
  try{const state=await getParticipantState(participant.entryId,participant.token);showState(state);}
  catch(err){console.warn(err);if(/invalid|not found|unauthorized/i.test(err.message||'')){localStorage.removeItem(SESSION_KEY);participant=null;setFormVisible(true);setError('Your saved queue session expired. Please join again.');}}
  finally{busy=false;}
}
async function onJoin(event){
  event.preventDefault();setError('');const nickname=cleanNickname($('#nickname').value);
  if(nickname.length<2){setError('Choose a nickname with at least 2 characters.');return;}
  if(!$('#agree-rules').checked){setError('Please agree to the participation rules to continue.');return;}
  const button=$('#join-btn');button.disabled=true;button.textContent='JOINING…';
  try{
    const data=await joinQueue(nickname,browserId());const entry=data.entry||data;
    const token=data.token||entry.token;
    if(!entry.id||!token)throw new Error('The queue service did not return a valid session.');
    participant={entryId:entry.id,token,nickname:entry.nickname||nickname,mode:data.mode||'live'};localStorage.setItem(SESSION_KEY,JSON.stringify(participant));
    $('#my-result').hidden=true;await loadParticipant();toast('You’re in! Keep this page open.','success');
  }catch(err){setError(err.message||'Could not join the queue. Please try again.');}
  finally{button.disabled=false;button.textContent='JOIN THE QUEUE ↗';await refreshEvent();}
}
async function rejoin(){
  const nickname=participant?.nickname||$('#nickname').value||'PLAYER';localStorage.removeItem(SESSION_KEY);participant=null;setFormVisible(true);$('#nickname').value=nickname;updateCharCount();$('#my-result').hidden=true;$('#agree-rules').checked=true;$('#join-form').requestSubmit();
}
async function leaveQueue(){if(!participant)return;try{
  if(!backendConfigured){const {demoStore}=await import('../services/demo-store.js');demoStore.leave(participant.entryId,participant.token);}
  else {const {supabase}=await import('../services/client.js');const {error}=await supabase.functions.invoke('get-participant-state',{body:{entryId:participant.entryId,token:participant.token,leave:true}});if(error)throw error;}
  localStorage.removeItem(SESSION_KEY);participant=null;setFormVisible(true);$('#my-result').hidden=true;toast('You left the queue.','success');refreshEvent();
}catch(err){toast(err.message||'Could not leave the queue.','error');}}
$('#join-form').addEventListener('submit',onJoin);$('#nickname').addEventListener('input',updateCharCount);$('#leave-queue').addEventListener('click',leaveQueue);
try{participant=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');}catch{participant=null;}
if(participant){setFormVisible(false);loadParticipant();}else setFormVisible(true);
refreshEvent();subscribePublicChanges(()=>{refreshEvent();loadParticipant();});setInterval(()=>{refreshEvent();loadParticipant();},2200);
