const KEY = 'gdgoc-arcade-demo-v1';
const defaults = () => ({
  event: { registrationOpen: true, eventEnded: false, queuePaused: false, turnDuration: 60, requireReady: false, maintenanceMessage: '' },
  queue: [], scores: [], rewards: [], awards: [], activeSession: null,
});
function read() {
  try { return { ...defaults(), ...(JSON.parse(localStorage.getItem(KEY) || '{}')) }; }
  catch { return defaults(); }
}
function write(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent('arcade-demo-change', { detail: state }));
}
export const demoStore = {
  get() { return read(); },
  subscribe(callback) {
    const onChange = () => callback(read());
    window.addEventListener('arcade-demo-change', onChange);
    window.addEventListener('storage', onChange);
    const timer = setInterval(onChange, 1500);
    callback(read());
    return () => { window.removeEventListener('arcade-demo-change', onChange); window.removeEventListener('storage', onChange); clearInterval(timer); };
  },
  join(nickname, browserId) {
    const state = read();
    if (!state.event.registrationOpen || state.event.eventEnded) throw new Error('Registration is closed right now. Ask the organizer for help.');
    const existing = state.queue.find(row => row.browserId === browserId && ['waiting', 'called', 'active'].includes(row.status));
    if (existing) return existing;
    const entry = { id: crypto.randomUUID(), nickname, browserId, token: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'waiting', score: null };
    state.queue.push(entry); write(state); return entry;
  },
  leave(id, token) {
    const state = read();
    const entry = state.queue.find(row => row.id === id && row.token === token);
    if (!entry || !['waiting', 'called'].includes(entry.status)) return false;
    entry.status = 'removed'; write(state); return true;
  },
  setEvent(patch) { const state = read(); state.event = { ...state.event, ...patch }; write(state); },
  startPractice(nickname = 'LOCAL TESTER') {
    const state = read();
    if (state.activeSession) throw new Error('A local test is already running.');
    const now = Date.now();
    const entry = { id: crypto.randomUUID(), nickname, browserId: 'local-practice', token: '', createdAt: new Date(now).toISOString(), status: 'active', score: null, participantId: 'local-practice' };
    state.queue.push(entry);
    state.activeSession = { id: crypto.randomUUID(), entryId: entry.id, nickname, token: '', startedAt: now, expiresAt: now + (Number(state.event.turnDuration) || 60) * 1000, score: 0, deaths: 0 };
    write(state); return state.activeSession;
  },
  startNext() {
    const state = read();
    if (state.activeSession) throw new Error('A player is already active. End that turn first.');
    if (state.event.queuePaused) throw new Error('Queue is paused. Resume it before starting the next player.');
    const next = state.queue.find(row => row.status === 'waiting');
    if (!next) throw new Error('No one is waiting in the queue.');
    const startedAt = Date.now();
    next.status = 'active';
    state.activeSession = { id: crypto.randomUUID(), entryId: next.id, nickname: next.nickname, token: next.token, startedAt, expiresAt: startedAt + (Number(state.event.turnDuration) || 60) * 1000, score: 0, deaths: 0 };
    write(state); return state.activeSession;
  },
  finishTurn({ score = 0, completed = false, deaths = 0 } = {}) {
    const state = read(); const session = state.activeSession;
    if (!session) return null;
    const entry = state.queue.find(row => row.id === session.entryId);
    if (entry) entry.status = 'played';
    const record = { id: crypto.randomUUID(), entryId: session.entryId, participant_id: entry?.participantId || entry?.browserId || session.entryId, nickname: session.nickname, score: Math.max(0, Math.floor(score)), completed: Boolean(completed), deaths: Math.max(0, Math.floor(deaths)), createdAt: new Date().toISOString() };
    state.scores.push(record);
    if (entry) entry.score = Math.max(Number(entry.score) || 0, record.score);
    state.activeSession = null;
    write(state); return record;
  },
  setActiveProgress(patch) { const state = read(); if (!state.activeSession) return; Object.assign(state.activeSession, patch); write(state); },
  removeEntry(id) { const state = read(); const row = state.queue.find(item => item.id === id); if (row && row.status !== 'active') row.status = 'removed'; write(state); },
  skipEntry(id) { const state = read(); const row = state.queue.find(item => item.id === id); if (row && ['waiting', 'called'].includes(row.status)) row.status = 'skipped'; write(state); },
  deleteScore(id) { const state = read(); state.scores = state.scores.filter(row => row.id !== id); write(state); },
  resetScores() { const state = read(); state.scores = []; state.awards = []; write(state); },
  addReward(reward) { const state = read(); state.rewards.push({ id: crypto.randomUUID(), ...reward, enabled: true, createdAt: new Date().toISOString() }); write(state); },
  deleteReward(id) { const state = read(); state.rewards = state.rewards.filter(row => row.id !== id); write(state); },
  markAward(id, status) { const state = read(); const row = state.awards.find(item => item.id === id); if (row) row.status = status; write(state); },
  upsertEligibleAwards() {
    const state = read();
    for (const reward of state.rewards.filter(item => item.enabled)) {
      let matching = [];
      if (reward.type === 'score') matching = state.scores.filter(s => s.score >= reward.threshold);
      else if (reward.type === 'complete') matching = state.scores.filter(s => s.completed);
      else if (reward.type === 'top3') matching = [...state.scores].sort((a,b)=>b.score-a.score).slice(0,3);
      for (const score of matching.slice(0, reward.quantity)) {
        if (!state.awards.some(a => a.rewardId === reward.id && a.entryId === score.entryId)) state.awards.push({ id: crypto.randomUUID(), rewardId: reward.id, rewardLabel: reward.label, entryId: score.entryId, nickname: score.nickname, score: score.score, status: 'eligible', createdAt: new Date().toISOString() });
      }
    }
    write(state); return state.awards;
  },
};
export function leaderboardFrom(scores) {
  const best = new Map();
  for (const score of scores || []) {
    const id = score.participant_id || score.entryId || score.id;
    const current = best.get(id);
    if (!current || Number(score.score) > Number(current.score) || (Number(score.score) === Number(current.score) && String(score.created_at || score.createdAt) < String(current.created_at || current.createdAt))) best.set(id, score);
  }
  return [...best.values()].sort((a,b) => Number(b.score)-Number(a.score) || new Date(a.created_at || a.createdAt).getTime() - new Date(b.created_at || b.createdAt).getTime());
}
