import { PLATFORMS, SPIKES, MOVING_HAZARDS, CHECKPOINTS, FINISH_X, WORLD_WIDTH, SPAWN } from './levels.js';
import { calculateScore } from './scoring.js';
const W = 960, H = 540;
const PLAYER_W = 26, PLAYER_H = 34;
const GRAVITY = 0.62, MAX_FALL = 14, MOVE_SPEED = 4.25, JUMP_SPEED = 12.8;
const overlap = (a,b) => a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;

export class ArcadeGame {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.callbacks = callbacks;
    this.controls = { left:false, right:false, jump:false };
    this.started = false; this.ended = true; this.nickname = 'PLAYER'; this.duration = 60; this.timeRemaining = 60;
    this.loopId = 0; this.lastFrame = 0; this.elapsed = 0; this.cameraX = 0; this.resetLevel();
    this.resizeCanvas();
  }
  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (rect.width && rect.height) {
      this.canvas.width = Math.round(rect.width*dpr); this.canvas.height = Math.round(rect.height*dpr);
      this.ctx.setTransform(this.canvas.width/W,0,0,this.canvas.height/H,0,0);
    } else { this.canvas.width = W; this.canvas.height = H; }
    this.draw();
  }
  resetLevel() {
    this.player = { x: SPAWN.x, y: SPAWN.y, w: PLAYER_W, h: PLAYER_H, vx:0, vy:0, grounded:false, jumpWasDown:false, invulnerable:0 };
    this.cameraX = 0; this.furthestX = SPAWN.x; this.checkpoints = new Set(); this.activeCheckpoint = { x: SPAWN.x, y: SPAWN.y }; this.deaths = 0; this.completed = false; this.elapsed = 0;
    this.hazardTime = 0; this.lastSafeProgress = 0;
  }
  start({ nickname = 'PLAYER', duration = 60 } = {}) {
    this.stopLoop(); this.resetLevel(); this.nickname = nickname; this.duration = Math.max(15, Math.min(180, Number(duration)||60)); this.timeRemaining = this.duration;
    this.started = true; this.ended = false; this.controls = { left:false, right:false, jump:false }; this.lastFrame = performance.now();
    this.loopId = requestAnimationFrame(this.frame.bind(this));
  }
  stop() { this.started = false; this.ended = true; this.controls = {left:false,right:false,jump:false}; this.stopLoop(); this.draw(); }
  stopLoop() { if (this.loopId) cancelAnimationFrame(this.loopId); this.loopId = 0; }
  setControls(controls) { this.controls = { left:!!controls.left, right:!!controls.right, jump:!!controls.jump }; }
  frame(now) {
    if (!this.started || this.ended) return;
    const dt = Math.min(2.2, Math.max(.15, (now - (this.lastFrame || now))/16.667)); this.lastFrame = now;
    this.elapsed += (dt*16.667)/1000; this.timeRemaining = Math.max(0, this.duration - this.elapsed); this.hazardTime += dt*0.045;
    this.update(dt); this.draw();
    const score = this.score();
    this.callbacks.onUpdate?.({ score, timeRemaining:this.timeRemaining, deaths:this.deaths, x:this.player.x, furthestX:this.furthestX, completed:this.completed, progress:this.furthestX/FINISH_X });
    if (this.completed || this.timeRemaining <= 0) { this.endTurn(); return; }
    this.loopId = requestAnimationFrame(this.frame.bind(this));
  }
  update(dt) {
    const p = this.player; const controls = this.controls;
    if (p.invulnerable > 0) p.invulnerable = Math.max(0,p.invulnerable-dt);
    if (controls.left === controls.right) p.vx *= Math.pow(.72,dt);
    else p.vx = (controls.left ? -MOVE_SPEED : MOVE_SPEED);
    p.vx = Math.max(-MOVE_SPEED,Math.min(MOVE_SPEED,p.vx));
    if (controls.jump && !p.jumpWasDown && p.grounded) { p.vy = -JUMP_SPEED; p.grounded = false; }
    p.jumpWasDown = controls.jump;
    const oldY = p.y;
    p.x += p.vx*dt; p.x = Math.max(0,Math.min(WORLD_WIDTH-p.w,p.x));
    p.vy = Math.min(MAX_FALL,p.vy+GRAVITY*dt); p.y += p.vy*dt; p.grounded = false;
    // Land only when moving down and the feet cross a platform top.
    if (p.vy >= 0) {
      for (const platform of PLATFORMS) {
        const horizontal = p.x+p.w > platform.x && p.x < platform.x+platform.w;
        const crossedTop = oldY+p.h <= platform.y+3 && p.y+p.h >= platform.y;
        if (horizontal && crossedTop) { p.y = platform.y-p.h; p.vy=0; p.grounded=true; break; }
      }
    }
    this.furthestX = Math.max(this.furthestX,p.x);
    for (const point of CHECKPOINTS) {
      if (p.x >= point && !this.checkpoints.has(point)) {
        this.checkpoints.add(point); this.activeCheckpoint = { x:point+10, y:this.platformYAt(point)-PLAYER_H-1 };
        this.callbacks.onCheckpoint?.({ x:point, count:this.checkpoints.size });
      }
    }
    const hazardObjects = MOVING_HAZARDS.map((h,i)=>({x:h.x+Math.sin(this.hazardTime*h.speed+h.phase)*h.range,y:h.y+Math.cos(this.hazardTime*h.speed*.7+h.phase)*8,w:h.w,h:h.h,id:i}));
    const hitSpike = SPIKES.some(s => overlap(p,{x:s.x+5,y:s.y+9,w:s.w-10,h:s.h-8}));
    const hitHazard = hazardObjects.some(h => overlap(p,{x:h.x+3,y:h.y+3,w:h.w-6,h:h.h-6}));
    if (p.invulnerable <= 0 && (hitSpike || hitHazard || p.y > H+90)) this.die();
    if (p.x+p.w >= FINISH_X) { this.completed=true; p.x=FINISH_X-p.w; }
    const targetCamera = Math.max(0,Math.min(WORLD_WIDTH-W,p.x - W*.32));
    this.cameraX += (targetCamera-this.cameraX)*Math.min(1,.12*dt);
  }
  platformYAt(x) {
    const p = PLATFORMS.filter(item => x>=item.x && x<=item.x+item.w).sort((a,b)=>a.y-b.y)[0];
    return p?.y ?? 450;
  }
  die() {
    this.deaths++; const cp=this.activeCheckpoint;
    this.player.x=cp.x; this.player.y=cp.y; this.player.vx=0; this.player.vy=0; this.player.grounded=false; this.player.invulnerable=75; this.controls={left:false,right:false,jump:false};
    this.callbacks.onDeath?.({ deaths:this.deaths, score:this.score() });
  }
  score() { return calculateScore({furthestX:this.furthestX,checkpoints:[...this.checkpoints],completed:this.completed,timeRemaining:this.timeRemaining}); }
  endTurn() {
    if (this.ended) return;
    const result = { score:this.score(), timeRemaining:this.timeRemaining, deaths:this.deaths, completed:this.completed, furthestX:this.furthestX, checkpoints:[...this.checkpoints], nickname:this.nickname, duration:this.duration };
    this.started=false; this.ended=true; this.controls={left:false,right:false,jump:false}; this.stopLoop(); this.draw(); this.callbacks.onEnd?.(result);
  }
  draw() {
    const c=this.ctx; if(!c) return; c.save(); c.setTransform(this.canvas.width/W,0,0,this.canvas.height/H,0,0);
    c.clearRect(0,0,W,H); this.drawBackground(c);
    c.save(); c.translate(-this.cameraX,0);
    // distant skyline
    for(let i=0;i<45;i++){const x=i*115;const h=45+(i*37%90); c.fillStyle=i%2?'#171e2d':'#1a2233'; c.fillRect(x,450-h,65,h);c.fillStyle='#354052';for(let j=0;j<3;j++)c.fillRect(x+12+j*15,450-h+14,4,7);}
    // world grid marks
    c.strokeStyle='#ffffff08';c.lineWidth=1;for(let x=0;x<WORLD_WIDTH;x+=80){c.beginPath();c.moveTo(x,0);c.lineTo(x,H);c.stroke();}
    // finish gate
    this.drawFinish(c);
    for(const platform of PLATFORMS) this.drawPlatform(c,platform);
    for(const spike of SPIKES) this.drawSpike(c,spike);
    for(const hazard of MOVING_HAZARDS){const hx=hazard.x+Math.sin(this.hazardTime*hazard.speed+hazard.phase)*hazard.range;const hy=hazard.y+Math.cos(this.hazardTime*hazard.speed*.7+hazard.phase)*8;this.drawHazard(c,hx,hy,hazard.w,hazard.h);}
    this.drawCheckpoints(c);
    if(this.started) this.drawPlayer(c);
    c.restore();
    if(this.started) this.drawProgress(c);
    c.restore();
  }
  drawBackground(c) {
    const g=c.createLinearGradient(0,0,0,H);g.addColorStop(0,'#111a2c');g.addColorStop(.65,'#151a29');g.addColorStop(1,'#10131e');c.fillStyle=g;c.fillRect(0,0,W,H);
    for(let i=0;i<68;i++){const x=(i*157+23)%W;const y=(i*79+17)%345;const size=i%5===0?2:1;c.fillStyle=i%4===0?'#c4f56a55':'#d7e5ff3c';c.fillRect(x,y,size,size);}
    c.strokeStyle='#65e5e10a';c.lineWidth=1;for(let y=360;y<H;y+=20){c.beginPath();c.moveTo(0,y);c.lineTo(W,y);c.stroke();}
    c.fillStyle='#c4f56a08';c.fillRect(0,420,W,120);
  }
  drawPlatform(c,p) {
    c.fillStyle=p.type==='floating'?'#242d45':'#242a3b';c.fillRect(p.x,p.y,p.w,p.h);
    c.fillStyle=p.type==='floating'?'#a895ff':'#c4f56a';c.fillRect(p.x,p.y,p.w,4);
    c.fillStyle='#ffffff0b';for(let x=p.x+11;x<p.x+p.w-5;x+=26)c.fillRect(x,p.y+14,12,2);
    c.fillStyle='#080a12aa';c.fillRect(p.x,p.y+p.h-4,p.w,4);
  }
  drawSpike(c,s) {const count=Math.max(2,Math.round(s.w/15));const sw=s.w/count;c.fillStyle='#ff6b91';c.beginPath();for(let i=0;i<count;i++){c.moveTo(s.x+i*sw,s.y+s.h);c.lineTo(s.x+(i+.5)*sw,s.y);c.lineTo(s.x+(i+1)*sw,s.y+s.h);}c.fill();c.fillStyle='#ffb0c4';for(let i=0;i<count;i++){c.beginPath();c.moveTo(s.x+i*sw+sw*.37,s.y+s.h*.5);c.lineTo(s.x+(i+.5)*sw,s.y+4);c.lineTo(s.x+(i+.62)*sw,s.y+s.h*.65);c.fill();}}
  drawHazard(c,x,y,w,h) {c.save();c.translate(x+w/2,y+h/2);c.rotate(this.hazardTime*2.2);c.fillStyle='#ff6b91';c.beginPath();for(let i=0;i<8;i++){const r=i%2?w*.33:w*.54;const a=i*Math.PI/4;c.lineTo(Math.cos(a)*r,Math.sin(a)*r);}c.closePath();c.fill();c.fillStyle='#221425';c.beginPath();c.arc(0,0,w*.17,0,Math.PI*2);c.fill();c.restore();}
  drawFinish(c) {c.fillStyle='#c4f56a';c.fillRect(4280,305,8,135);c.fillStyle='#c4f56a';c.beginPath();c.moveTo(4288,306);c.lineTo(4365,326);c.lineTo(4288,348);c.closePath();c.fill();c.font='bold 11px "DM Mono",monospace';c.fillStyle='#10121c';c.fillText('FINISH',4295,331);}
  drawCheckpoints(c) {for(const x of CHECKPOINTS){const active=this.checkpoints.has(x);c.fillStyle=active?'#c4f56a':'#65e5e1';c.fillRect(x,362,4,68);c.fillStyle=active?'#c4f56a':'#65e5e1';c.beginPath();c.moveTo(x+4,363);c.lineTo(x+45,374);c.lineTo(x+4,386);c.closePath();c.fill();}}
  drawPlayer(c) {const p=this.player;if(p.invulnerable>0 && Math.floor(p.invulnerable/6)%2===0)return;c.save();c.translate(p.x,p.y);c.shadowColor='#c4f56a66';c.shadowBlur=16;c.fillStyle='#c4f56a';c.fillRect(0,0,p.w,p.h);c.shadowBlur=0;c.fillStyle='#28301c';c.fillRect(5,9,5,5);c.fillRect(17,9,5,5);c.fillStyle='#10121c';c.fillRect(6,22,14,3);c.fillStyle='#f7f8ef';c.fillRect(4,3,18,3);c.fillStyle='#a895ff';c.fillRect(-3,p.h-5,p.w+6,5);c.restore();}
  drawProgress(c) {const p=Math.max(0,Math.min(1,this.furthestX/FINISH_X));c.fillStyle='#ffffff13';c.fillRect(16,16,W-32,4);c.fillStyle='#c4f56a';c.fillRect(16,16,(W-32)*p,4);c.fillStyle='#9ca6bd';c.font='9px "DM Mono",monospace';c.fillText(`${Math.round(p*100)}% TO FINISH`,18,34);}
}
