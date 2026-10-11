import { supabase, backendConfigured } from '../services/client.js';
import { adminAction } from '../services/api.js';
import { $, escapeHtml, toast, safeDate, downloadCsv } from '../services/utils.js';
let current=null,busy=false;
function feedback(message){$('#queue-action-feedback').textContent=message;}
function setLoggedIn(value){$('#admin-login-card').hidden=value;$('#admin-dashboard').hidden=!value;}
function bestScores(scores=[]){
  const byParticipant=new Map();
  for(const s of scores.filter(s=>!s.invalidated_at&&!s.invalidatedAt)){
    const id=s.participant_id||s.participantId||s.queue_entry_id||s.entryId||s.id;
    const old=byParticipant.get(id);if(!old||Number(s.score)>Number(old.score)||(Number(s.score)===Number(old.score)&&new Date(s.created_at||s.createdAt)<new Date(old.created_at||old.createdAt)))byParticipant.set(id,s);
  }
  return [...byParticipant.values()].sort((a,b)=>Number(b.score)-Number(a.score)||new Date(a.created_at||a.createdAt)-new Date(b.created_at||b.createdAt));
}
function render(data){
  current=data||current;if(!current)return;
  const event=current.event||{};const queue=current.queue||[];const scores=current.scores||[];const rewards=current.rewards||[];const awards=current.awards||[];
  $('#admin-queue-count').textContent=String(queue.filter(q=>['waiting','called'].includes(q.status)).length);
  $('#admin-active-name').textContent=queue.find(q=>q.status==='active')?.nickname||current.activeSession?.nickname||current.active_session?.nickname||'—';
  $('#admin-score-count').textContent=String(scores.filter(s=>!s.invalidated_at&&!s.invalidatedAt).length);
  $('#admin-registration-state').textContent=event.registration_open?'Open':event.event_ended?'Ended':'Closed';
  $('#turn-duration').value=event.turn_duration_seconds||event.turnDuration||60;
  $('#require-ready').checked=Boolean(event.require_ready||event.requireReady);
  $('#repeat-attempts').checked=event.repeat_attempts_enabled!==false;
  $('#maintenance-message').value=event.maintenance_message||event.maintenanceMessage||'';
  const queueRows=queue.filter(q=>!['played','removed','skipped'].includes(q.status));
  $('#admin-queue-table').innerHTML=queueRows.length?queueRows.map((q,i)=>`<tr><td>${q.status==='active'?'▶':q.status==='called'?'NEXT':i+1}</td><td>${escapeHtml(q.nickname)}</td><td><span class="pill">${escapeHtml(q.status.toUpperCase())}</span></td><td>${safeDate(q.created_at||q.createdAt)}</td><td>${q.status==='active'?'<button class="danger-btn" data-end="1">End turn</button>':`<button class="secondary-btn" data-skip="${escapeHtml(q.id)}">Skip</button> <button class="danger-btn" data-remove="${escapeHtml(q.id)}">Remove</button>`}</td></tr>`).join(''):'<tr><td colspan="5">No participants in the queue.</td></tr>';
  const ranked=bestScores(scores);
  $('#admin-score-table').innerHTML=ranked.length?ranked.map((s,i)=>`<tr><td>#${i+1}</td><td>${escapeHtml(s.nickname||'PLAYER')}</td><td><b style="color:var(--lime)">${Number(s.score||0).toLocaleString()}</b></td><td>${s.completed?'Yes':'No'}</td><td><button class="danger-btn" data-invalid="${escapeHtml(s.id)}">Invalidate</button></td></tr>`).join(''):'<tr><td colspan="5">No valid scores recorded yet.</td></tr>';
  $('#reward-list').innerHTML=rewards.length?rewards.map(r=>`<div class="reward-item"><span><b>${escapeHtml(r.label)}</b><small>${escapeHtml(ruleDescription(r))} · ${Number(r.quantity||1)} available · ${r.enabled===false?'Disabled':'Enabled'}</small></span><button class="danger-btn" data-reward-delete="${escapeHtml(r.id)}">Remove</button></div>`).join(''):'<div class="empty-state">No reward rules configured.</div>';
  if(awards.some(a=>a.status==='eligible'))$('#export-winners').textContent=`Export winners (${awards.filter(a=>['eligible','awarded','claimed'].includes(a.status)).length}) CSV`;
  $('#admin-award-table').innerHTML=awards.length?awards.map(a=>`<tr><td>${escapeHtml(a.nickname)}</td><td>${escapeHtml(a.reward_label||a.rewardLabel||'Reward')}</td><td>${Number(a.score||0).toLocaleString()}</td><td><span class="pill">${escapeHtml(String(a.status).toUpperCase())}</span></td><td>${escapeHtml(a.voucher_code||'—')}</td><td>${a.status==='eligible'?`<button class="primary-btn" data-award="${escapeHtml(a.id)}">Award</button>`:a.status==='awarded'?`<button class="secondary-btn" data-claim="${escapeHtml(a.id)}">Mark claimed</button>`:'—'}</td></tr>`).join(''):'<tr><td colspan="6">No eligible winners yet.</td></tr>';
}
function ruleDescription(r){if(r.type==='complete'||r.reward_type==='complete')return 'Level completion';if(r.type==='top3'||r.reward_type==='top3')return 'Top 3 finish';return `Score ≥ ${Number(r.threshold)||0}`;}
async function refresh(){if(!backendConfigured||busy)return;busy=true;try{const data=await adminAction('get-dashboard');render(data);}catch(err){console.error(err);if(/admin|permission|unauthori|forbidden|not configured/i.test(err.message||'')){toast(`Dashboard access: ${err.message}`,'error',6000);if(/unauthori|forbidden|not an event admin/i.test(err.message||''))setLoggedIn(false);}else toast(`Refresh failed: ${err.message}`,'error');}finally{busy=false;}}
async function act(action,payload={},success='Updated.'){
  try{await adminAction(action,payload);feedback(success);toast(success,'success');await refresh();return true;}
  catch(err){feedback(err.message||'Action failed.');toast(err.message||'Action failed.','error',5000);return false;}
}
async function login(e){e.preventDefault();$('#admin-login-error').textContent='';if(!backendConfigured){$('#admin-login-error').textContent='Backend not configured. Fill in config.js and complete the Supabase setup first.';return;}
  const email=$('#admin-email').value.trim(),password=$('#admin-password').value;const button=e.submitter;button.disabled=true;button.textContent='SIGNING IN…';
  try{const {error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;await adminAction('get-dashboard');setLoggedIn(true);await refresh();toast('Organizer session verified.','success');}
  catch(err){await supabase.auth.signOut();$('#admin-login-error').textContent=err.message||'Sign-in failed.';}
  finally{button.disabled=false;button.textContent='SIGN IN ↗';}
}
$('#admin-login-form').addEventListener('submit',login);
$('#admin-signout').addEventListener('click',async()=>{await supabase?.auth.signOut();setLoggedIn(false);toast('Signed out.','success');});
$('#open-registration').addEventListener('click',()=>act('open-registration',{},'Registration opened.'));
$('#close-registration').addEventListener('click',()=>act('close-registration',{},'Registration closed.'));
$('#pause-queue').addEventListener('click',()=>act('pause-queue',{},'Queue paused.'));
$('#resume-queue').addEventListener('click',()=>act('resume-queue',{},'Queue resumed.'));
$('#start-next').addEventListener('click',()=>act('start-next',{},'Advanced queue.'));
$('#skip-active').addEventListener('click',()=>{if(confirm('End the current turn without saving a score?'))act('end-active-turn',{},'Active turn ended.');});
$('#save-settings').addEventListener('click',()=>act('save-settings',{turnDuration:Number($('#turn-duration').value),requireReady:$('#require-ready').checked,repeatAttempts:$('#repeat-attempts').checked},'Game settings saved.'));
$('#clear-queue').addEventListener('click',()=>{if(confirm('Clear all waiting and called participants? This cannot be undone.'))act('clear-queue',{},'Waiting queue cleared.');});
$('#save-maintenance').addEventListener('click',()=>act('save-maintenance',{message:$('#maintenance-message').value.trim()},'Maintenance notice updated.'));
$('#reward-form').addEventListener('submit',async e=>{e.preventDefault();const payload={label:$('#reward-label').value.trim(),type:$('#reward-type').value,threshold:Math.max(0,Number($('#reward-threshold').value)||0),quantity:Math.max(1,Math.min(500,Number($('#reward-quantity').value)||1))};if(!payload.label)return;const ok=await act('add-reward',payload,'Reward rule added.');if(ok)e.target.reset();});
$('#refresh-admin').addEventListener('click',refresh);
$('#export-scores').addEventListener('click',()=>{const rows=[['Rank','Nickname','Score','Completed','Deaths','Created at','Invalidated at']];bestScores(current?.scores||[]).forEach((s,i)=>rows.push([i+1,s.nickname,s.score,s.completed,s.deaths,s.created_at,s.invalidated_at]));downloadCsv('gdgoc-arcade-scores.csv',rows);});
$('#export-winners').addEventListener('click',()=>{const rows=[['Nickname','Reward','Score','Status','Awarded at','Voucher code']];(current?.awards||[]).forEach(a=>rows.push([a.nickname,a.reward_label||a.rewardLabel,a.score,a.status,a.awarded_at||a.created_at,a.voucher_code||'']));downloadCsv('gdgoc-arcade-voucher-winners.csv',rows);});
$('#reset-leaderboard').addEventListener('click',()=>{if(confirm('Reset the leaderboard? Existing score records will be marked invalid, not deleted.')){const reason=prompt('Reason for reset (required):','Event leaderboard reset');if(reason?.trim())act('reset-leaderboard',{reason:reason.trim()},'Leaderboard reset.');}});
$('#end-event').addEventListener('click',()=>{if(confirm('End registration and the event? The active turn, if any, will end without a score, and top-three voucher eligibility will be finalized.'))act('end-event',{},'Event ended. Top-three eligibility finalized.');});
$('#admin-award-table').addEventListener('click',e=>{const award=e.target.closest('[data-award]');const claim=e.target.closest('[data-claim]');if(award){const voucherCode=prompt('Enter the actual unique voucher serial/code assigned to this winner:');if(voucherCode?.trim())act('set-award-status',{awardId:award.dataset.award,status:'awarded',voucherCode:voucherCode.trim()},'Voucher award recorded.');}if(claim&&confirm('Confirm that this voucher has been handed to the winner?'))act('set-award-status',{awardId:claim.dataset.claim,status:'claimed'},'Voucher claim recorded.');});
$('#admin-queue-table').addEventListener('click',e=>{const skip=e.target.closest('[data-skip]');const remove=e.target.closest('[data-remove]');const end=e.target.closest('[data-end]');if(skip&&confirm('Skip this participant?'))act('skip-entry',{entryId:skip.dataset.skip},'Participant skipped.');if(remove&&confirm('Remove this participant from the queue?'))act('remove-entry',{entryId:remove.dataset.remove},'Participant removed.');if(end&&confirm('End active turn without saving a score?'))act('end-active-turn',{},'Active turn ended.');});
$('#admin-score-table').addEventListener('click',e=>{const btn=e.target.closest('[data-invalid]');if(!btn)return;const reason=prompt('Why should this score be invalidated?');if(reason?.trim())act('invalidate-score',{scoreId:btn.dataset.invalid,reason:reason.trim()},'Score invalidated.');});
$('#reward-list').addEventListener('click',e=>{const btn=e.target.closest('[data-reward-delete]');if(btn&&confirm('Remove this reward rule? Existing awards will remain in the audit log.'))act('delete-reward',{rewardId:btn.dataset.rewardDelete},'Reward rule removed.');});

async function initialize(){
  if(!backendConfigured){$('#admin-setup-note').textContent='Backend not configured. Fill in config.js, create the Supabase project, run backend/schema.sql, deploy Edge Functions, and add an organizer account.';$('#admin-login-error').textContent='This project is currently in local preview mode. Live organizer controls require Supabase.';$('#admin-email').disabled=true;$('#admin-password').disabled=true;$('#admin-login-form button').disabled=true;return;}
  try{const {data:{session}}=await supabase.auth.getSession();if(session){try{await adminAction('get-dashboard');setLoggedIn(true);await refresh();}catch(err){console.warn(err);setLoggedIn(false);}}else setLoggedIn(false);}catch(err){console.warn(err);setLoggedIn(false);}
  supabase.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||!session)setLoggedIn(false);});
}
initialize();
// Keep the organizer view synchronized with queue arrivals, turns, and new scores.
setInterval(()=>{if(!$('#admin-dashboard').hidden)void refresh();},4500);
