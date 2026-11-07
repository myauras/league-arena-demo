import { BattleImpact } from './battle-impact.js?v=4007e9b54c82';
const STRIDE = 11;
const COLUMNS = ['headX', 'headY', 'footX', 'footY', 'health', 'shield', 'status', 'q', 'w', 'e', 'r'];
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

export function validateTimeline(data, playback) {
  if (data.schemaVersion !== 1 || data.clipId !== playback.clipId || data.contentVersion !== playback.contentVersion
      || data.width !== playback.width || data.height !== playback.height || data.fps !== playback.fps
      || data.frameCount !== playback.frames || ![30, 60].includes(data.fps)
      || JSON.stringify(data.columns) !== JSON.stringify(COLUMNS)
      || !Array.isArray(data.heroes) || data.heroes.length !== 5 || new Set(data.heroes.map(h => h.id)).size !== 5
      || data.heroes.some(h => !Number.isFinite(h.maxHealth) || h.maxHealth <= 0)
      || !Array.isArray(data.samples) || data.samples.length !== data.frameCount || !data.frameCount
      || data.countdownFrames !== undefined && (!Number.isInteger(data.countdownFrames) || data.countdownFrames < 0 || data.countdownFrames >= data.frameCount)
      || data.victoryFrame !== undefined && (!Number.isInteger(data.victoryFrame) || data.victoryFrame < -1 || data.victoryFrame >= data.frameCount)
      || data.finalKillVoiceOnly !== undefined && typeof data.finalKillVoiceOnly !== 'boolean'
      || data.finalKillHero !== undefined && (!Number.isInteger(data.finalKillHero) || data.finalKillHero < -1 || data.finalKillHero >= data.heroes.length)
      || data.samples.some(s => !Array.isArray(s.values) || s.values.length !== data.heroes.length * STRIDE || s.values.some(v => !Number.isFinite(v)))
      || !Array.isArray(data.events) || data.events.some(e => e.kind !== 'kill' || !Number.isInteger(e.frame) || e.frame < 0 || e.frame >= data.frameCount
        || !Number.isInteger(e.killer) || e.killer < -1 || e.killer >= data.heroes.length || !Number.isInteger(e.victim) || e.victim < 0 || e.victim >= data.heroes.length)) {
    throw new Error('戰鬥資料與影片不一致，請重試播放。');
  }
  return data;
}

export function frameAt(data, time) {
  // Do not interpolate through a blink, death or health change. This sample is
  // the exact Unity state/projection used to encode this video frame.
  return clamp(Math.floor(Math.max(0, time) * data.fps + 0.0001), 0, data.frameCount - 1);
}

export function containRect(width, height, movieWidth, movieHeight) {
  const scale = Math.min(width / movieWidth, height / movieHeight);
  const w = movieWidth * scale, h = movieHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

function placeLabel(anchorX, anchorY, width, height, bounds, occupied) {
  const minX = bounds.x + width / 2 + 4, maxX = bounds.x + bounds.width - width / 2 - 4;
  const minY = Math.max(bounds.y + 4, 26) + height, maxY = bounds.y + bounds.height - 31;
  let best;
  // Try lateral positions as well as stacked labels. A leader line retains the
  // real head anchor when a crowded phone viewport needs to move a label aside.
  for (const dy of [0, -.65, -1.3, .65, 1.3, -2, 2]) for (const dx of [0, -.65, .65, -1.3, 1.3]) {
    const x = clamp(anchorX + dx * (width + 6), minX, maxX);
    const y = clamp(anchorY - 4 + dy * (height + 5), minY, maxY);
    let score = Math.abs(x - anchorX) + Math.abs(y - anchorY + 4) * 1.2 + (dy > 0 ? 8 : 0);
    for (const r of occupied) {
      const overlapX = Math.max(0, Math.min(x + width / 2 + 3, r.right) - Math.max(x - width / 2 - 3, r.left));
      const overlapY = Math.max(0, Math.min(y + 3, r.bottom) - Math.max(y - height - 3, r.top));
      score += overlapX * overlapY * 100;
    }
    if (!best || score < best.score) best = { x, y, score };
  }
  return best;
}

function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class BattleOverlay {
  constructor(video, layer, scene) {
    this.video = video; this.layer = layer; this.scene = scene;
    this.flash = document.getElementById('battle-flash'); this.feedback = document.getElementById('battle-feedback');
    this.motion = matchMedia('(prefers-reduced-motion: reduce)'); this.generation = 0; this.data = null;
    this.impact = new BattleImpact(video, scene, this.flash, this.motion);
    this.observer = new ResizeObserver(() => { this.measure(); this.draw(this.mediaTime ?? this.video.currentTime); });
    this.observer.observe(layer);
    this.video.addEventListener('seeking', () => {
      this.suppressUntil = this.video.currentTime + .7; this.lastAudioFrame = Math.floor(this.video.currentTime * (this.data?.fps || 60));
      this.impact.clear(); this.draw(this.video.currentTime);
    });
    this.video.addEventListener('seeked', () => this.draw(this.video.currentTime));
    this.video.addEventListener('emptied', () => { this.layer.hidden = true; });
    this.video.addEventListener('loadeddata', () => this.draw(this.video.currentTime));
    this.video.addEventListener('ended', () => this.draw(this.video.currentTime));
    this.tick = (_now, metadata) => {
      if (!this.data) return;
      this.draw(metadata ? metadata.mediaTime : this.video.currentTime);
      this.schedule();
    };
  }
  unlockAudio() { this.impact.unlockAudio(); }
  measure() {
    if (!this.data) return;
    this.bounds = containRect(this.layer.clientWidth, this.layer.clientHeight, this.data.width, this.data.height);
  }
  schedule() {
    if (!this.data) return;
    this.callback = this.video.requestVideoFrameCallback ? this.video.requestVideoFrameCallback(this.tick) : requestAnimationFrame(this.tick);
  }
  clear() {
    this.impact.clear();
    this.countingDown = false;
    this.generation++; this.abort?.abort(); this.data = null; this.mediaTime = 0; this.lastAudioFrame = -1; this.suppressUntil = 0;
    if (this.callback !== undefined) {
      if (this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.callback); else cancelAnimationFrame(this.callback);
      this.callback = undefined;
    }
    this.layer.replaceChildren(); this.layer.hidden = true;
    this.scene.style.transform = ''; this.video.classList.remove('wager-eliminated');
    this.flash.style.opacity = '0'; this.feedback.hidden = true;
    document.getElementById('wager-label').textContent = 'THE ARENA';
    for (const card of document.querySelectorAll('#heroes [data-hero]')) {
      delete card.dataset.eliminated; delete card.dataset.health; card.querySelector('.card-vitals')?.remove();
    }
  }
  async load(playback, picks, betType) {
    this.clear(); const generation = this.generation;
    if (!playback.timelineUrl) return false;
    const controller = new AbortController(); this.abort = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(playback.timelineUrl, { signal: controller.signal });
      if (!response.ok) throw new Error('戰鬥血量資料暫時無法載入，請重試播放。');
      const raw = await response.arrayBuffer();
      if (playback.timelineSha256 && crypto.subtle) {
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map(x => x.toString(16).padStart(2, '0')).join('');
        if (hash !== playback.timelineSha256) throw new Error('戰鬥資料驗證失敗，請重試播放。');
      }
      const data = validateTimeline(JSON.parse(new TextDecoder().decode(raw)), playback);
      if (generation !== this.generation) return false;
      if (picks.some(id => !data.heroes.some(h => h.id === id))) throw new Error('英雄標記資料不一致。');
      this.data = data; this.picks = [...picks]; this.betType = betType;
      this.links = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); this.links.classList.add('health-links'); this.layer.append(this.links);
      this.nodes = data.heroes.map((hero, index) => {
        const order = picks.indexOf(hero.id), selected = order >= 0;
        const node = element('div', `hero-health${selected ? ' wagered' : ''}`); node.dataset.entity = hero.id;
        node.style.setProperty('--hero-color', /^#[\da-f]{6}$/i.test(hero.color) ? hero.color : '#72b7b4');
        const title = selected ? `${betType === 'exacta' ? ['①', '②'][order] : '◆'} ${hero.name}` : hero.name;
        const name = element('span', 'health-name', title);
        const track = element('div', 'health-track'), fill = element('i', 'health-fill'), shield = element('i', 'shield-fill');
        track.append(fill, shield);
        const status = element('span', 'health-status');
        node.append(name, track, status); this.layer.append(node);
        const marker = selected ? element('span', 'wager-arrow') : null;
        if (marker) { marker.dataset.marker = hero.id; this.layer.append(marker); }
        const link = document.createElementNS('http://www.w3.org/2000/svg', 'line'); link.classList.add(selected ? 'wager-link' : 'hero-link'); this.links.append(link);
        const card = document.querySelector(`#heroes [data-hero="${hero.id}"]`);
        const vitals = element('span', 'card-vitals'), cardTrack = element('span', 'card-health-track'), cardFill = element('i', 'card-health-fill');
        const cardValue = element('span', 'card-health-value'); cardTrack.append(cardFill); vitals.append(cardTrack, cardValue); card?.append(vitals);
        return { hero, index, selected, node, marker, fill, shield, status, link, card, cardValue, cardFill };
      });
      document.getElementById('wager-label').textContent = (picks.length === 1 ? '你的英雄 · ' : '')
        + picks.map((id, i) => `${betType === 'exacta' ? ['①', '②'][i] : ''}${data.heroes.find(h => h.id === id).name}`).join(betType === 'exacta' ? ' → ' : ' ＋ ');
      this.personalKills = data.events.filter(e => e.killer !== e.victim && picks.includes(data.heroes[e.killer]?.id));
      this.countdown = element('div', 'battle-countdown'); this.countdown.hidden = true; this.layer.append(this.countdown);
      this.measure(); this.schedule(); return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      throw new Error(error.name === 'AbortError' ? '戰鬥血量資料載入逾時，請重試播放。' : error.message);
    } finally { clearTimeout(timeout); }
  }
  draw(time) {
    if (!this.data || !this.bounds) return;
    this.mediaTime = time;
    const frame = frameAt(this.data, time), values = this.data.samples[frame].values, bounds = this.bounds;
    this.layer.hidden = this.video.readyState < 2;
    this.layer.dataset.frame = String(frame);
    this.countingDown = frame < (this.data.countdownFrames || 0);
    this.countdown.hidden = !this.countingDown;
    if (this.countingDown) this.countdown.textContent = String(Math.ceil((this.data.countdownFrames - frame) / this.data.fps));
    const mobile = this.layer.clientWidth < 500, occupied = [];
    const entries = [...this.nodes].sort((a, b) => Number(b.selected) - Number(a.selected));
    for (const item of entries) {
      const { index, node, selected, hero, card } = item, at = index * STRIDE;
      const hp = values[at + 4], shield = values[at + 5], status = values[at + 6], alive = hp > 0;
      node.dataset.health = String(hp); node.hidden = this.countingDown || !alive || !!(status & 16); item.link.style.display = 'none';
      if (item.marker) item.marker.hidden = node.hidden;
      if (card) {
        card.dataset.health = String(hp); card.dataset.eliminated = String(!alive);
        item.cardFill.style.width = `${clamp(hp / hero.maxHealth, 0, 1) * 100}%`;
        item.cardValue.textContent = alive ? `${Math.ceil(hp)} / ${hero.maxHealth}` : '已淘汰';
      }
      if (node.hidden) continue;
      item.fill.style.width = `${clamp(hp / hero.maxHealth, 0, 1) * 100}%`;
      item.shield.style.width = `${clamp(shield / hero.maxHealth, 0, 1) * 100}%`;
      item.shield.hidden = shield <= 0;
      item.status.textContent = status & 8 ? '擊飛' : status & 1 ? '暈眩' : status & 2 ? '定身' : status & 4 ? '緩速' : '';
      const width = selected ? (mobile ? 66 : 78) : (mobile ? 49 : 66);
      node.style.width = `${width}px`;
      const height = node.offsetHeight;
      const anchorX = bounds.x + values[at] * bounds.width, anchorY = bounds.y + values[at + 1] * bounds.height;
      if (item.marker) { item.marker.style.left = `${anchorX}px`; item.marker.style.top = `${anchorY}px`; }
      const { x, y } = placeLabel(anchorX, anchorY - (selected ? 6 : 0), width, height, bounds, occupied);
      occupied.push({ left: x - width / 2, right: x + width / 2, top: y - height, bottom: y });
      node.style.width = `${width}px`; node.style.left = `${x}px`; node.style.top = `${y}px`;
      if (Math.abs(y - (anchorY - 4)) > 9 || Math.abs(x - anchorX) > 9) {
        item.link.style.display = '';
        for (const [key, value] of Object.entries({ x1: x, y1: y, x2: anchorX, y2: anchorY })) item.link.setAttribute(key, String(value));
      }
    }
    const allPicksDead = this.nodes.filter(n => n.selected).every(n => values[n.index * STRIDE + 4] <= 0);
    this.video.classList.toggle('wager-eliminated', allPicksDead);
    const event = [...this.personalKills].reverse().find(e => e.frame <= frame);
    const age = event ? time - event.frame / this.data.fps : Infinity;
    if (event && event.frame > this.lastAudioFrame && age < .35 && time >= this.suppressUntil && !this.video.paused) {
      const killed = this.data.samples[event.frame].values, at = event.victim * STRIDE;
      this.impact.trigger(event.frame, { x: killed[at + 2], y: (killed[at + 1] + killed[at + 3]) * .5 });
    }
    const impact = this.impact.present(event, age, bounds, time >= this.suppressUntil);
    this.layer.dataset.killFrame = impact ? String(event.frame) : '';
    this.feedback.hidden = !(age >= 0 && age < 1.65 && time >= this.suppressUntil);
    if (!this.feedback.hidden) this.feedback.textContent = `${this.data.heroes[event.killer].name} 擊殺 ${this.data.heroes[event.victim].name}`;
    // Kill-triggered hero dialogue is recorded once for the final winner only.
    // Browser effects add an original impact sound, never another hero voice.
    this.lastAudioFrame = frame;
  }
}
