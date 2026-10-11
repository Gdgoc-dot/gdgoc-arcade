import { getPublicSnapshot, subscribePublicChanges } from '../services/api.js';
import { $, escapeHtml } from '../services/utils.js';
let busy=false;
function mapRows(data){
  const rows=data?.leaderboard||[];
  return rows.map((r,i)=>({rank:Number(r.rank)||i+1,nickname:r.nickname||'PLAYER',score:Number(r.score)||0,completed:Boolean(r.completed),created_at:r.created_at||r.createdAt}));
}
async function render(){
  if(busy)return;busy=true;
  try{
    const data=await getPublicSnapshot();const rows=mapRows(data);const root=$('#full-leaderboard');
    if(!rows.length)root.innerHTML='<div class="empty-state">No valid scores yet. You could be the first name on the board.</div>';
    else root.innerHTML=rows.slice(0,100).map((r,i)=>`<div class="full-row"><div class="full-rank">#${String(i+1).padStart(2,'0')}</div><div class="full-player"><span class="avatar-square">${escapeHtml((r.nickname||'?').slice(0,1).toUpperCase())}</span><span><strong>${escapeHtml(r.nickname)}</strong><small>${r.completed?'Level cleared':'Run recorded'}</small></span></div><b class="full-score">${r.score.toLocaleString()}</b></div>`).join('');
    $('#leaderboard-updated').textContent=data.mode==='live'?'Connected · live scores':'Local preview · scores stay in this browser';
  }catch(error){console.error(error);$('#leaderboard-updated').textContent='Unable to connect to the scoreboard';}
  finally{busy=false;}
}
render();subscribePublicChanges(render);setInterval(render,6000);
