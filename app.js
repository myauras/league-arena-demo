import { api, movieSource, storageKey } from './demo-api.js?v=4007e9b54c82';
import { BattleOverlay } from './battle-overlay.js?v=4007e9b54c82';
const $ = id => document.getElementById(id);
const video = $('battle-video');
const overlay = new BattleOverlay(video, $('battle-overlay'), $('battle-scene'));
let data, betType = 'win', picks = [], stake = 100, round = null, phase = 'boot', resumeAt = 0, legacyTimeline = false;
const storage = { get(key) { try { return JSON.parse(localStorage.getItem(storageKey(key))); } catch { return null; } }, set(key, value) { try { value === null ? localStorage.removeItem(storageKey(key)) : localStorage.setItem(storageKey(key), JSON.stringify(value)); } catch {} } };
let pending = storage.get('arena.pending');
const money = value => Number(value).toLocaleString('zh-TW');
const heroName = id => data?.heroes.find(h => h.id === id)?.name ?? id;
const currentBet = () => data?.betTypes.find(b => b.id === betType);
const text = (id, value) => { $(id).textContent = value; };

function button(label, action, className = '') { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.className = className; node.onclick = action; return node; }
function drawControls() {
  $('heroes').replaceChildren(...data.heroes.map(hero => {
    const node = button('', () => { if (phase !== 'ready') return; const i = picks.indexOf(hero.id); if (i >= 0) picks.splice(i, 1); else if (currentBet().picks === 1) picks = [hero.id]; else if (picks.length < 2) picks.push(hero.id); else picks[picks.length - 1] = hero.id; render(); }, 'hero-card');
    node.dataset.hero = hero.id; node.setAttribute('aria-label', `選擇${hero.name}`);
    const img = new Image(); img.src = hero.portrait; img.alt = ''; img.width = img.height = 58;
    const name = document.createElement('strong'); name.textContent = hero.name;
    const role = document.createElement('small'); role.textContent = hero.role;
    const badge = document.createElement('span'); badge.className = 'pick-badge';
    node.append(img, name, role, badge); return node;
  }));
  $('bet-types').replaceChildren(...data.betTypes.map(bet => { const node = button(bet.name, () => { betType = bet.id; picks = []; render(); }); node.dataset.bet = bet.id; node.title = bet.hint; node.setAttribute('aria-label', `${bet.name}：${bet.hint}`); return node; }));
  $('stakes').replaceChildren(...data.stakes.map(value => { const node = button(money(value), () => { stake = value; render(); }); node.dataset.stake = value; return node; }));
}
function render() {
  const ready = phase === 'ready';
  document.body.classList.toggle('in-round', !!round);
  document.body.classList.toggle('round-complete', ['result', 'acknowledging'].includes(phase));
  document.querySelectorAll('[data-hero]').forEach(node => { const i = picks.indexOf(node.dataset.hero); node.classList.toggle('selected', i >= 0); node.disabled = !ready; node.setAttribute('aria-pressed', i >= 0); node.querySelector('.pick-badge').textContent = i < 0 ? '' : currentBet().picks === 2 ? i + 1 : '✓'; });
  document.querySelectorAll('[data-bet]').forEach(node => { node.classList.toggle('active', node.dataset.bet === betType); node.disabled = !ready; node.setAttribute('aria-pressed', node.dataset.bet === betType); });
  document.querySelectorAll('[data-stake]').forEach(node => { node.classList.toggle('active', Number(node.dataset.stake) === stake); node.disabled = !ready; });
  if (data) {
    text('selection-hint', currentBet().hint); text('bet-hint', currentBet().hint);
    text('picked-names', picks.length ? picks.map(heroName).join(betType === 'exacta' ? ' → ' : ' ＋ ') : '尚未選擇英雄');
    text('potential-return', money(Math.floor((stake * currentBet().numerator + Math.floor(currentBet().denominator / 2)) / currentBet().denominator)));
  }
  const state = { boot: '準備中', ready: '準備就緒', requesting: '建立回合', requestFailed: '等待重試', loading: '準備播放', playing: '戰鬥進行中', buffering: '緩衝中', paused: '已暫停', mediaError: '等待續播', result: '回合結算', acknowledging: '準備下一回合', bootError: '稍後重試' };
  text('state-label', state[phase] || phase);
  $('start-button').hidden = !!round; $('next-button').hidden = phase !== 'result' && phase !== 'acknowledging';
  $('next-button').disabled = phase === 'acknowledging';
  $('start-button').disabled = !(ready && picks.length === currentBet()?.picks) && !['requestFailed', 'bootError'].includes(phase);
  $('start-button').querySelector('span').textContent = phase === 'bootError' ? '重新連線' : phase === 'requestFailed' ? '重試原回合' : phase === 'requesting' ? '正在準備回合…' : picks.length === currentBet()?.picks ? '開始對戰' : '選擇英雄以開始';
  $('pause-button').disabled = !round || !['playing', 'paused', 'buffering'].includes(phase);
  $('seek-bar').disabled = !round || !['playing', 'paused', 'buffering'].includes(phase);
  text('pause-button', video.paused ? '繼續' : '暫停');
  $('stage-message').hidden = ['playing', 'result', 'acknowledging'].includes(phase);
  $('stage-message').classList.toggle('playback-paused', phase === 'paused');
  $('stage-message').classList.toggle('selection-prompt', !round);
  $('stage-copy').hidden = !['mediaError', 'buffering'].includes(phase);
  text('sound-button', video.muted ? '開啟音效' : '靜音');
  $('result-panel').hidden = !['result', 'acknowledging'].includes(phase);
  $('media-retry').hidden = !['paused', 'mediaError'].includes(phase);
  if (['loading', 'buffering'].includes(phase)) { text('stage-title', '戰鬥即將開始'); text('stage-copy', '正在準備這一回合的畫面…'); }
  else if (phase === 'paused') { text('stage-title', '回合已暫停'); text('stage-copy', '隨時繼續剛才的交鋒。'); text('media-retry', '繼續播放'); }
  else if (phase === 'mediaError') { text('stage-title', '畫面暫時中斷'); text('stage-copy', '結果已保留，重試會接續同一回合。'); text('media-retry', '重試播放'); }
  else if (!round) { text('stage-title', '選擇你的英雄'); text('stage-copy', '見證交鋒，等待最後的勝者。'); }
}
async function boot() {
  phase = 'boot'; text('feedback', ''); render();
  try {
    data = await api('/api/bootstrap'); text('balance', money(data.balance)); drawControls();
    if (pending && (!data.betTypes.some(b => b.id === pending.betType) || !Array.isArray(pending.picks) || !data.stakes.includes(pending.stake))) { pending = null; storage.set('arena.pending', null); }
    video.poster = data.library.posterUrl;
    if (data.activeRound) { pending = null; storage.set('arena.pending', null); await loadRound(data.activeRound); }
    else if (pending) { betType = pending.betType; picks = pending.picks; stake = pending.stake; phase = 'requestFailed'; text('feedback', '上次請求尚未確認，請重試原回合。'); render(); }
    else { round = null; phase = 'ready'; render(); }
  } catch (error) { phase = 'bootError'; text('feedback', error.message); render(); }
}
async function submit() {
  overlay.unlockAudio();
  if (phase === 'bootError') return boot();
  if (!['ready', 'requestFailed'].includes(phase)) return;
  if (!pending) { pending = { requestId: crypto.randomUUID(), betType, picks: [...picks], stake }; storage.set('arena.pending', pending); }
  phase = 'requesting'; text('feedback', ''); render();
  try { const result = await api('/api/rounds', pending); pending = null; storage.set('arena.pending', null); await loadRound(result); }
  catch (error) {
    if (error.code === 'round_pending') return boot();
    if (error.status === 400 || error.code === 'insufficient_balance') { pending = null; storage.set('arena.pending', null); phase = 'ready'; }
    else phase = 'requestFailed';
    text('feedback', error.message); render();
  }
}
async function loadRound(result) {
  video.muted = storage.get('arena.muted') === true;
  round = result; betType = round.bet.type; picks = [...round.bet.picks]; stake = round.bet.stake;
  text('balance', money(round.balanceAfterStake)); text('round-label', `回合 ${round.roundId.slice(0, 6).toUpperCase()}`);
  text('feedback', ''); phase = 'loading'; render();
  resumeAt = Number(storage.get(`arena.position.${round.roundId}`)) || 0;
  video.pause();
  try {
    const hasTimeline = await overlay.load(round.playback, picks, betType);
    legacyTimeline = !hasTimeline;
    if (!hasTimeline) text('feedback', '這是更新前的回合，尚無同步血條；下一回合會使用新版影片。');
  } catch (error) { phase = 'mediaError'; text('feedback', error.message); render(); return; }
  video.poster = round.playback.posterUrl; try { video.src = await movieSource(round.playback.url); video.load(); }
  catch (error) { phase = 'mediaError'; text('feedback', error.message); render(); return; }
  try { await video.play(); } catch { if (phase !== 'mediaError') { phase = 'paused'; render(); } }
}
function complete() {
  if (!round) return;
  phase = 'result'; text('balance', money(round.balanceAfter)); text('feedback', '');
  text('result-title', `${heroName(round.outcome.winnerId)}，最後的勝者`);
  text('result-copy', round.outcome.won ? `預測命中 · 總返還 ${money(round.outcome.payout)} 點` : '本次未命中 · 下一場，再選你的英雄');
  $('finish-order').replaceChildren(...round.outcome.finishOrder.map((id, index) => {
    const node = document.createElement('div'); const img = new Image(); img.src = data.heroes.find(h => h.id === id).portrait; img.alt = heroName(id);
    const label = document.createElement('span'); label.textContent = `${index + 1}. ${heroName(id)}`; node.append(img, label); return node;
  })); render();
}
$('start-button').onclick = submit;
$('next-button').onclick = async () => {
  if (phase !== 'result') return; phase = 'acknowledging'; render();
  try { await api(`/api/rounds/${round.roundId}/ack`, {}); storage.set(`arena.position.${round.roundId}`, null); video.pause(); overlay.clear(); video.removeAttribute('src'); video.load(); round = null; text('time-label', '00:00'); $('progress-fill').style.width = '0'; text('round-label', '五位英雄 · 自由混戰'); await boot(); }
  catch (error) { phase = 'result'; text('feedback', error.message); render(); }
};
$('media-retry').onclick = async () => { overlay.unlockAudio(); if (!round) return; if (phase === 'mediaError') return loadRound(round); try { await video.play(); } catch { text('feedback', '無法開始播放，請再試一次。'); } };
$('pause-button').onclick = () => { overlay.unlockAudio(); if (!round) return; if (video.paused) video.play().catch(() => { phase = 'paused'; render(); }); else video.pause(); };
$('sound-button').onclick = () => { overlay.unlockAudio(); video.muted = !video.muted; storage.set('arena.muted', video.muted); text('sound-button', video.muted ? '開啟音效' : '靜音'); };
$('seek-bar').oninput = () => { if (round && Number.isFinite(video.duration)) video.currentTime = video.duration * Number($('seek-bar').value) / 1000; };
video.addEventListener('loadedmetadata', () => { if (resumeAt > 0 && Number.isFinite(video.duration)) { video.currentTime = Math.min(resumeAt, Math.max(0, video.duration - .6)); resumeAt = 0; } });
video.addEventListener('playing', () => { if (round) { phase = 'playing'; text('feedback', legacyTimeline ? '這是更新前的回合，尚無同步血條；下一回合會使用新版影片。' : ''); render(); } });
video.addEventListener('pause', () => { if (round && !video.ended && !['result', 'acknowledging', 'mediaError', 'loading'].includes(phase)) { phase = 'paused'; render(); } });
video.addEventListener('waiting', () => { if (round && !['result', 'acknowledging', 'mediaError'].includes(phase)) { phase = 'buffering'; render(); } });
video.addEventListener('error', () => { if (round) { phase = 'mediaError'; render(); } });
video.addEventListener('ended', complete);
video.addEventListener('timeupdate', () => {
  if (phase === 'playing') text('state-label', overlay.countingDown ? '戰鬥倒數' : '戰鬥進行中');
  const seconds = Math.floor(video.currentTime || 0); text('time-label', `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
  $('progress-fill').style.width = `${Number.isFinite(video.duration) && video.duration > 0 ? video.currentTime / video.duration * 100 : 0}%`;
  $('seek-bar').value = Number.isFinite(video.duration) && video.duration > 0 ? String(video.currentTime / video.duration * 1000) : '0';
  if (round) storage.set(`arena.position.${round.roundId}`, video.currentTime);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && round && !video.paused) video.pause(); });
boot();
