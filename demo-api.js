// Public static showcase adapter. Credits and tickets belong to this browser only.
// The original Python/SQLite API remains the authoritative backend demo.
const base = new URL('./', import.meta.url);
const scope = base.pathname === '/' ? '' : `:${base.pathname}`;
const DB = `league-arena-public-demo-v1${scope}`;
export const storageKey = key => scope ? `league-arena${scope}:${key}` : key;
const assetUrl = path => {
  const url = new URL(path.replace(/^\/(?!\/)/, ''), base);
  return url.origin === base.origin ? url.pathname + url.search + url.hash : url.href;
};
let catalogPromise, databasePromise;
let movieUrl, moviePath, movieTask;
const checkedClips = new Map();
const rangeSupport = new Map();
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const clone = value => JSON.parse(JSON.stringify(value));

// Use the browser's progressive player on Range-capable hosts (including GitHub).
// Retain the verified Blob fallback for hosts that cannot serve seekable media.
export async function movieSource(path) {
  const c = await catalog(), clip = [...c.clips, ...(c.legacyClips || [])].find(x => x.url === path || x.legacyUrl === path);
  if (!clip) throw new Error('找不到此回合的影片。');
  path = clip.url; // Old pending tickets keep their result and use the smaller equivalent movie.
  if (!rangeSupport.has(path)) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, { method: 'HEAD', signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('影片暫時無法播放，請重試同一回合。');
      rangeSupport.set(path, response.headers.get('accept-ranges')?.toLowerCase() === 'bytes');
    } finally { clearTimeout(timer); }
  }
  if (rangeSupport.get(path)) return path;
  if (movieUrl && moviePath === path) return movieUrl;
  if (movieTask?.path === path) return movieTask.promise;
  const task = { path };
  task.promise = (async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
    try {
      // An interrupted request must not reuse an incomplete cached response.
      const response = await fetch(path, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('影片下載中斷，請重試播放同一回合。');
      const bytes = await response.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (bytes.byteLength !== clip.bytes || hash !== clip.sha256) throw new Error('影片資料不完整，請重試播放。');
      if (movieUrl) URL.revokeObjectURL(movieUrl);
      moviePath = path; movieUrl = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
      return movieUrl;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('影片下載逾時，請重試播放同一回合。');
      throw e;
    } finally { clearTimeout(timer); if (movieTask === task) movieTask = null; }
  })();
  movieTask = task;
  return task.promise;
}

async function catalog() {
  if (!catalogPromise) catalogPromise = fetch(new URL('catalog.json', base), { cache: 'no-cache' }).then(async r => {
    if (!r.ok) throw new Error('影片庫讀取失敗，請重新連線。');
    const c = await r.json();
    if (c.schemaVersion !== 1 || !c.clips?.length || c.heroes?.length !== 5 || !c.betTypes?.length) throw new Error('影片庫格式不正確。');
    // Catalog paths are relative to this export, including on GitHub project Pages.
    for (const hero of c.heroes) hero.portrait = assetUrl(hero.portrait);
    for (const clip of [...c.clips, ...(c.legacyClips || [])]) {
      for (const key of ['url', 'posterUrl', 'timelineUrl']) clip[key] = assetUrl(clip[key]);
      if (clip.legacyUrl) clip.legacyUrl = assetUrl(clip.legacyUrl);
    }
    return c;
  }).catch(e => { catalogPromise = null; throw e; });
  return catalogPromise;
}
function database() {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('state');
    open.onerror = () => reject(new Error('請允許此網頁儲存測試回合。'));
    open.onblocked = () => reject(new Error('請關閉其他舊版測試分頁後重試。'));
    open.onsuccess = () => resolve(open.result);
  }).catch(e => { databasePromise = null; throw e; });
  return databasePromise;
}
async function transact(action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state');
    let result, failure;
    tx.oncomplete = () => resolve(clone(result));
    tx.onerror = tx.onabort = () => reject(failure || new Error('回合儲存失敗，重試不會重複扣點。'));
    const request = store.get('wallet');
    request.onsuccess = () => {
      const state = request.result || { balance: 10000, active: null, rounds: {} };
      try { result = action(state); store.put(state, 'wallet'); }
      catch (error) { failure = error; tx.abort(); }
    };
  });
}
function choose(items) {
  const random = new Uint32Array(1), cap = Math.floor(4294967296 / items.length) * items.length;
  do { crypto.getRandomValues(random); } while (random[0] >= cap);
  return items[random[0] % items.length];
}
function win(type, picks, order) {
  if (type === 'win') return picks[0] === order[0];
  if (type === 'place') return order.slice(0, 2).includes(picks[0]);
  if (type === 'topThree') return order.slice(0, 3).includes(picks[0]);
  if (type === 'exacta') return picks.every((p, i) => p === order[i]);
  if (type === 'quinella') return picks.every(p => order.slice(0, 2).includes(p));
  return false;
}
async function checkClip(clip) {
  if (!checkedClips.has(clip.clipId)) checkedClips.set(clip.clipId, (async () => {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const [movie, sidecar] = await Promise.all([
        fetch(clip.url, { method: 'HEAD', signal: controller.signal, cache: 'no-store' }),
        fetch(clip.timelineUrl, { signal: controller.signal })
      ]);
      if (!movie.ok || !sidecar.ok || !movie.headers.get('content-type')?.startsWith('video/')) throw new Error('影片暫時無法播放，尚未扣除點數。');
      rangeSupport.set(clip.url, movie.headers.get('accept-ranges')?.toLowerCase() === 'bytes');
      const raw = await sidecar.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== clip.timelineSha256) throw new Error('戰鬥資料驗證失敗，尚未扣除點數。');
    } finally { clearTimeout(timeout); }
  })().catch(e => { checkedClips.delete(clip.clipId); throw e; }));
  return checkedClips.get(clip.clipId);
}
function validate(body, c) {
  if (!body || !/^[A-Za-z0-9_-]{8,100}$/.test(body.requestId || '')) throw fail(400, 'request_id', '缺少有效的請求編號。');
  const bet = c.betTypes.find(b => b.id === body.betType);
  if (!bet || !Array.isArray(body.picks) || body.picks.length !== bet.picks || new Set(body.picks).size !== bet.picks || body.picks.some(id => !c.heroes.some(h => h.id === id))) throw fail(400, 'invalid_picks', '請選擇正確數量的英雄。');
  if (![100, 200, 500].includes(body.stake)) throw fail(400, 'invalid_stake', '請選擇有效的投注額。');
  return bet;
}
export async function api(path, body) {
  const c = await catalog();
  if (path === '/api/bootstrap' && body === undefined) return transact(s => {
    // Keep the public showcase playable after exhausting free demo points.
    if (!s.active && s.balance < 100) s.balance = 10000;
    return { schemaVersion: 1, balance: s.balance, heroes: c.heroes, betTypes: c.betTypes, stakes: [100, 200, 500],
      library: { clips: c.clips.length, contentVersion: c.contentVersion, posterUrl: c.clips[0].posterUrl },
      activeRound: s.active ? s.rounds[s.active].ticket : null };
  });
  if (path === '/api/rounds' && body !== undefined) {
    const bet = validate(body, c), signature = JSON.stringify([body.betType, body.picks, body.stake]);
    const old = await transact(s => s.rounds[body.requestId] || null);
    if (old) {
      if (old.signature !== signature) throw fail(409, 'idempotency_conflict', '同一請求編號不可更換投注內容。');
      return old.ticket;
    }
    // Decide among available complete outcomes independently of the selected heroes.
    const orders = [...new Set(c.clips.map(clip => JSON.stringify(clip.finishOrder)))];
    const order = choose(orders), clip = choose(c.clips.filter(x => JSON.stringify(x.finishOrder) === order));
    await checkClip(clip);
    return transact(s => {
      const existing = s.rounds[body.requestId];
      if (existing) {
        if (existing.signature !== signature) throw fail(409, 'idempotency_conflict', '同一請求編號不可更換投注內容。');
        return existing.ticket;
      }
      if (s.active) throw fail(409, 'round_pending', '請先完成目前回合，或重新整理以續播。');
      if (s.balance < body.stake) throw fail(409, 'insufficient_balance', '示範點數不足。');
      const before = s.balance, won = win(body.betType, body.picks, clip.finishOrder);
      const payout = won ? Math.floor((body.stake * bet.numerator + Math.floor(bet.denominator / 2)) / bet.denominator) : 0;
      const after = before - body.stake + payout;
      const ticket = { schemaVersion: 1, roundId: crypto.randomUUID().replaceAll('-', ''), requestId: body.requestId, status: 'settled',
        bet: { type: body.betType, picks: [...body.picks], stake: body.stake },
        outcome: { winnerId: clip.winnerId, finishOrder: clip.finishOrder, won, payout }, balanceBefore: before, balanceAfterStake: before - body.stake, balanceAfter: after,
        playback: Object.fromEntries(['clipId','contentVersion','url','posterUrl','duration','width','height','timelineUrl','timelineSha256','fps','frames'].map(k => [k,clip[k]])) };
      s.balance = after; s.active = body.requestId; s.rounds[body.requestId] = { signature, ticket };
      return ticket;
    });
  }
  const match = /^\/api\/rounds\/([a-f0-9]{32})(\/ack)?$/.exec(path);
  if (match) return transact(s => {
    const entry = Object.values(s.rounds).find(r => r.ticket.roundId === match[1]);
    if (!entry) throw fail(404, 'round_missing', '找不到這個回合。');
    if (match[2] && body !== undefined) {
      if (s.active === entry.ticket.requestId) s.active = null;
      return { roundId: match[1], viewed: true, balance: s.balance };
    }
    if (!match[2] && body === undefined) return entry.ticket;
    throw fail(405, 'method', '不支援此操作。');
  });
  throw fail(404, 'not_found', '找不到此服務。');
}
