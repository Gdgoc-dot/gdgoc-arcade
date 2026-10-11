import { backendConfigured } from '../services/client.js';
import { $, toast, sha256 } from '../services/utils.js';
import { getParticipantState, createControlChannel } from '../services/api.js';
const SESSION_KEY='gdgoc-arcade-participant';
let participant=null,state=null,channel=null,participantTokenHash=null,connectingChannel=false,timer=0,sequence=0,gameStateTimer=0,controls={left:false,right:false,jump:false},lastStateAt=0;
try{participant=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');}catch{}
function setConnection(text,good=false){$('#controller-connection').innerHTML=`<i style="background:${good?'#6aefa0':'#ffd66b'}"></i> ${text}`;}
function clearControls(){controls={left:false,right:false,jump:false};$$buttons().forEach(button=>{button.dataset.pressed='false';});sendInputs();}
function $$buttons(){return [...document.querySelectorAll('[data-control]')];}
async function ensureRealtimeConnection(){
  if(!backendConfigured||!participant||channel||connectingChannel)return;
  connectingChannel=true;
  try{
    if(!participantTokenHash)participantTokenHash=await sha256(participant.token);
    const connected=await createControlChannel(participantTokenHash,()=>{},onGameState);
    channel=connected;setConnection('REALTIME CONNECTED',true);
  }catch(err){
    console.error(err);setConnection('CONNECTION LOST');$('#controller-wait-copy').textContent='Could not connect to realtime controls. Retrying automatically…';
    setTimeout(()=>{if(!channel)void ensureRealtimeConnection();},3500);
  }finally{connectingChannel=false;}
}
async function connect(){
  if(!participant){$('#controller-wait-title').textContent='Join the queue first';$('#controller-wait-copy').textContent='Your player session was not found on this device.';setConnection('NO PLAYER SESSION');return;}
  if(backendConfigured)await ensureRealtimeConnection();else setConnection('LOCAL PREVIEW ONLY',true);
  await refresh();timer=setInterval(()=>{if(backendConfigured&&!channel)void ensureRealtimeConnection();refresh();},1300);
  gameStateTimer=setInterval(()=>{if(isActive())sendInputs();},90);
}
async function refresh(){
  if(!participant)return;
  try{
    state=await getParticipantState(participant.entryId,participant.token);lastStateAt=Date.now();
    if(!state?.found){showWait('Session not found','Return to the queue page and join again.');return;}
    const entry=state.entry||{};const active=state.active;
    const playing=entry.status==='active'&&active&&(active.entryId===entry.id||active.queue_entry_id===entry.id);
    if(playing){
      $('#controller-wait').hidden=true;$('#controller-result').hidden=true;$('#controller-active').hidden=false;setConnection(backendConfigured?(channel?'CONTROLS CONNECTED':'CONTROL CHANNEL OFFLINE'):'LOCAL PREVIEW',backendConfigured?Boolean(channel):true);
      const expiry=new Date(active.expiresAt||active.expires_at).getTime();const seconds=Math.max(0,(expiry-Date.now())/1000);$('#control-time').textContent=seconds.toFixed(1);$('#control-score').textContent=String(active.score||active.current_score||0).padStart(4,'0');$('#control-deaths').textContent=String(active.deaths||0);
      if(seconds<=0){clearControls();showWait('Time is up!','Your result is being saved on the big screen.');}
    }else if(entry.status==='played'){
      clearControls();$('#controller-active').hidden=true;$('#controller-wait').hidden=true;$('#controller-result').hidden=false;
      $('#result-heading').textContent='GG, runner.';const result=state.recentResult;$('#result-score').textContent=Number(result?.score||entry.score||0).toLocaleString();$('#result-copy').textContent=result?.completed?'You cleared the level. Beautiful run!':'Your best valid score has been added to the leaderboard.';setConnection('TURN COMPLETE',true);
    }else if(entry.status==='called'){
      $('#controller-active').hidden=true;$('#controller-result').hidden=true;showWait('You’re next!','Go back to the queue page and confirm that you’re ready.');
    }else{
      $('#controller-active').hidden=true;$('#controller-result').hidden=true;const position=state.position?`Queue position #${state.position}`:'Waiting in queue';showWait(position,'Your phone controls will activate automatically when your turn begins.');
    }
  }catch(err){console.warn(err);setConnection('RECONNECTING');if(Date.now()-lastStateAt>8000)showWait('Connection interrupted','Trying to reconnect. Keep this page open.');}
}
function showWait(title,copy){$('#controller-wait').hidden=false;$('#controller-wait-title').textContent=title;$('#controller-wait-copy').textContent=copy;}
function isActive(){return state?.entry?.status==='active'&&Date.now()-lastStateAt<5000;}
function sendInputs(){if(!channel||!participant||!participantTokenHash||!isActive())return;const active=state?.active||{};channel.send({entryId:participant.entryId,sessionId:active.id||active.session_id,channelKey:participantTokenHash,controls:{...controls},seq:++sequence,sentAt:Date.now()}).catch?.(()=>{});}
function onGameState(payload){if(!isActive()||payload?.channelKey!==participantTokenHash||payload?.entryId!==participant.entryId)return;if(state?.active?.id&&payload.sessionId!==state.active.id)return;$('#control-score').textContent=String(payload.score||0).padStart(4,'0');$('#control-deaths').textContent=String(payload.deaths||0);if(Number.isFinite(payload.timeRemaining))$('#control-time').textContent=Math.max(0,payload.timeRemaining).toFixed(1);}
function press(button){if(!isActive())return;const key=button.dataset.control;controls[key]=true;button.dataset.pressed='true';sendInputs();}
function release(button){const key=button.dataset.control;controls[key]=false;button.dataset.pressed='false';sendInputs();}
for(const button of $$buttons()){
  button.addEventListener('contextmenu',e=>e.preventDefault());
  button.addEventListener('pointerdown',e=>{e.preventDefault();try{button.setPointerCapture(e.pointerId);}catch{}press(button);});
  for(const ev of ['pointerup','pointercancel','lostpointercapture','pointerleave'])button.addEventListener(ev,e=>{if(ev==='pointerleave'&&e.buttons!==0)return;release(button);});
}
window.addEventListener('blur',clearControls);document.addEventListener('visibilitychange',()=>{if(document.hidden)clearControls();});window.addEventListener('pagehide',clearControls);
document.addEventListener('keydown',e=>{if(!isActive())return;const map={ArrowLeft:'left',a:'left',ArrowRight:'right',d:'right',' ':'jump',ArrowUp:'jump',w:'jump'};const key=map[e.key];if(key){e.preventDefault();controls[key]=true;sendInputs();}});document.addEventListener('keyup',e=>{const map={ArrowLeft:'left',a:'left',ArrowRight:'right',d:'right',' ':'jump',ArrowUp:'jump',w:'jump'};const key=map[e.key];if(key){controls[key]=false;sendInputs();}});
connect();
