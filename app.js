/* MM GUESSR（仮） — みなとみらい版ジオゲッサー
 * 写真モード（キー不要）と Google ストリートビューモード（APIキーを入れたとき）の2本立て。
 * 答え＝写真を撮った場所（Wikimedia Commons の撮影位置）。答え合わせでスポット解説を出す。
 */
(() => {
'use strict';

// ===================== 定数・データ =====================
const SPOTS = Object.fromEntries(window.MM_SPOTS.map(s => [s.id, s]));
const PHOTOS = window.MM_PHOTOS;
const ROUNDS = 5;
const MAXP = 5000;
const CENTER = [35.4568, 139.6345];
const BOUNDS = [[35.4470, 139.6200], [35.4685, 139.6460]];
// ランダム出題の範囲：みなとみらい21（中央・新港・桜木町〜汽車道・高島の北側）をざっくり囲む多角形
const MM_POLY = [
  [35.4650, 139.6243], [35.4668, 139.6300], [35.4628, 139.6395], [35.4592, 139.6412], [35.4578, 139.6442],
  [35.4528, 139.6452], [35.4513, 139.6402], [35.4500, 139.6322], [35.4506, 139.6294], [35.4560, 139.6268], [35.4612, 139.6236],
];
const MOVE_LABEL = { move: '歩いて探せる', nomove: '見回すだけ', nmpz: '固定（見回しもズームもなし）' };
// ---- 点数のしくみ ----
// 1問：20m以内は満点5000点。そこから160m離れるごとに約0.37倍（みなとみらい約2km四方に合わせた曲線）。
// 想定（5問合計の中央値・シミュレーション）：適当に置く 約1,100／地区だけ分かる 約10,000／だいたい分かる 約18,000／よく知ってる 約23,700
const PERFECT_M = 20, SCALE_M = 160;
// 1問ごとの判定（距離で決まる。点数の目安つき）
const GRADES = [
  { max: 20,       name: 'ピタリ！',     short: 'ピタリ',   cls: 'g-s' },
  { max: 60,       name: 'すぐそば！',   short: '〜60m',   cls: 'g-a' },
  { max: 150,      name: '近い！',       short: '〜150m',  cls: 'g-b' },
  { max: 300,      name: '同じブロック', short: '〜300m',  cls: 'g-c' },
  { max: 600,      name: '同じ地区',     short: '〜600m',  cls: 'g-d' },
  { max: Infinity, name: 'はずれ…',     short: '600m〜',  cls: 'g-e' },
];
// 5問合計のランク。B以上でクリア
const RANKS = [
  { min: 22000, letter: 'S', lv: 5, title: 'みなとみらいの主（ぬし）', tag: '地図なしで街を案内できる', msg: '地図を見なくても歩けるレベル。今度は友だちの案内役をお願いします。' },
  { min: 17000, letter: 'A', lv: 4, title: 'ベイエリアの達人', tag: '路地の先まで知っている', msg: 'かなり詳しい！ ピタリを増やしてSランクを狙おう。' },
  { min: 11000, letter: 'B', lv: 3, title: 'みなとみらい一人前', tag: '主要スポットはおまかせ', msg: 'クリア！ 主要スポットはばっちり。少し奥の公園や橋にも行ってみよう。' },
  { min: 5000,  letter: 'C', lv: 2, title: 'みなとみらい見習い', tag: '方向感覚はつかめてきた', msg: '方向はつかめています。図鑑と「まちガイド」で地区の位置を覚えよう。' },
  { min: 0,     letter: 'D', lv: 1, title: 'みなとみらい迷子', tag: 'ここから街デビュー', msg: 'ここから覚えればOK。まずは「名所めぐり」で街の地図をつかもう。' },
];
const CLEAR_SCORE = 11000;
const rankOf = total => RANKS.find(r => total >= r.min);
const gradeOf = d => GRADES.find(g => d <= g.max);

const $ = id => document.getElementById(id);
const body = document.body;
const isMobile = () => matchMedia('(max-width:760px)').matches;
const reduced = matchMedia('(prefers-reduced-motion:reduce)').matches;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const store = {
  get(k, d) { try { const v = localStorage.getItem('mmg.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mmg.' + k, JSON.stringify(v)); } catch { /* 容量オーバー等は無視 */ } },
};
const CONFIG = Object.assign({ appName: 'MM GUESSR', googleMapsKey: '' }, window.MM_CONFIG || {});
const settings = {
  time: store.get('time', 0),
  sound: store.get('sound', true),
  key: store.get('key', ''),
  move: store.get('move', 'move'),    // move / nomove / nmpz（ストリートビュー時のみ）
};

// 遊ぶ人が設定画面で入れたキー → なければ公開設定（config.js）のキー
const apiKey = () => settings.key || CONFIG.googleMapsKey;

// ===================== 便利関数 =====================
function haversine(a, b) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function scoreOf(d) { return d <= PERFECT_M ? MAXP : Math.round(MAXP * Math.exp(-(d - PERFECT_M) / SCALE_M)); }
function rating(r) { return r.guess ? gradeOf(r.dist).name : '時間切れ…'; }
function inPoly(p, poly = MM_POLY) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > p.lat) !== (yj > p.lat) && p.lng < (xj - xi) * (p.lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function randomInPoly() {
  const lats = MM_POLY.map(p => p[0]), lngs = MM_POLY.map(p => p[1]);
  for (let t = 0; t < 200; t++) {
    const p = { lat: Math.min(...lats) + Math.random() * (Math.max(...lats) - Math.min(...lats)), lng: Math.min(...lngs) + Math.random() * (Math.max(...lngs) - Math.min(...lngs)) };
    if (inPoly(p)) return p;
  }
  return { lat: CENTER[0], lng: CENTER[1] };
}
function nearestSpot(p) {
  let best = null;
  for (const s of window.MM_SPOTS) { const d = haversine(p, s); if (!best || d < best.d) best = { spot: s, d }; }
  return best;
}
function closestPhotoOf(spotId, p) {
  return PHOTOS.filter(x => x.spot === spotId).sort((a, b) => haversine(a, p) - haversine(b, p))[0];
}
// ---- まちガイド：最寄り駅（直線距離×1.25を道のりの目安、分速80m）と近くのスポット ----
function accessOf(p) {
  let best = null;
  for (const st of window.MM_AREAS.stations) { const d = haversine(p, st); if (!best || d < best.d) best = { st, d }; }
  const m = Math.max(50, Math.round(best.d * 1.25 / 50) * 50), walk = Math.max(1, Math.round(best.d * 1.25 / 80));
  return `${best.st.name}から約${m}m・歩いて約${walk}分（目安）`;
}
function nearOf(s, n = 3) {
  return window.MM_SPOTS.filter(x => x.id !== s.id).map(x => ({ x, d: haversine(s, x) })).sort((a, b) => a.d - b.d).slice(0, n);
}
function fillGuide(prefix, s) {
  $(prefix + 'Access').textContent = accessOf(s);
  const near = $(prefix + 'Near'); near.textContent = '';
  nearOf(s).forEach(({ x, d }) => {
    const b = document.createElement('button');
    b.textContent = `${x.name}（${fmtDist(d).join('')}）`;
    b.addEventListener('click', () => { Snd.click(); openSpot(x.id); });
    near.append(b);
  });
  $(prefix + 'AreaQ').textContent = `「${s.area}」ってどんなところ？`;
  $(prefix + 'AreaText').textContent = window.MM_AREAS.areas[s.area];
  $(prefix + 'Guide').querySelector('details').open = false;
}
function fmtDist(d) { return d >= 1000 ? [(d / 1000).toFixed(2), 'km'] : [String(Math.round(d)), 'm']; }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
function countUp(el, to, ms, fmt = v => Math.round(v).toLocaleString(), onTick) {
  return new Promise(res => {
    if (reduced) { el.textContent = fmt(to); return res(); }
    const t0 = performance.now(); let lastTick = 0;
    const step = now => {
      const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * e);
      if (onTick && now - lastTick > 70 && p < 1) { lastTick = now; onTick(); }
      p < 1 ? requestAnimationFrame(step) : res();
    };
    requestAnimationFrame(step);
  });
}
function loadImg(src) {
  return new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = src; });
}
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function creditNode(photo) {
  const frag = document.createDocumentFragment();
  frag.append('写真：' + photo.author + '（' + photo.license + '）／ ');
  const a = document.createElement('a');
  a.href = photo.page; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Wikimedia Commons';
  frag.append(a);
  return frag;
}

// ===================== 効果音（WebAudioで合成。音声ファイル不要） =====================
const Snd = {
  ctx: null,
  init() {
    if (!this.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (C) this.ctx = new C(); }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(f, dur, { type = 'sine', vol = .14, when = 0, slide = 0 } = {}) {
    if (!settings.sound || !this.ctx) return;
    const t = this.ctx.currentTime + when, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + .03);
  },
  noise(dur, { vol = .12, when = 0, from = 400, to = 3000 } = {}) {
    if (!settings.sound || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + when, n = c.sampleRate * dur | 0;
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * .4); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    src.connect(bp).connect(g).connect(c.destination); src.start(t);
  },
  click() { this.tone(720, .06, { type: 'triangle', vol: .07 }); },
  pin() { this.tone(1100, .09, { type: 'triangle', vol: .12, slide: .55 }); this.tone(520, .12, { vol: .1, when: .05 }); },
  whoosh() { this.noise(.7, { vol: .16, from: 300, to: 2600 }); },
  land() { this.tone(180, .25, { vol: .22, slide: .5 }); this.noise(.18, { vol: .1, from: 1500, to: 300 }); },
  tick() { this.tone(1500, .03, { type: 'square', vol: .025 }); },
  warn() { this.tone(880, .08, { type: 'square', vol: .05 }); },
  round() { this.noise(.9, { vol: .1, from: 200, to: 1800 }); [523, 784].forEach((f, i) => this.tone(f, .5, { vol: .07, when: .25 + i * .08 })); },
  good() { [659, 784, 1047].forEach((f, i) => this.tone(f, .35, { type: 'triangle', vol: .12, when: i * .09 })); },
  great() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, .5, { type: 'triangle', vol: .12, when: i * .07 }));
    [1047, 1319, 1568].forEach(f => this.tone(f, 1.1, { vol: .06, when: .4 }));
  },
  meh() { this.tone(392, .25, { type: 'triangle', vol: .1 }); this.tone(330, .4, { type: 'triangle', vol: .1, when: .18 }); },
  stamp() { this.tone(1568, .12, { type: 'triangle', vol: .1 }); this.tone(2093, .25, { type: 'triangle', vol: .08, when: .08 }); },
};

// ===================== 背景の光（タイトル） =====================
const Bokeh = (() => {
  const cv = $('bokeh'), cx = cv.getContext('2d');
  let W, H, parts = [], running = false;
  const cols = ['255,77,126', '63,216,255', '255,210,94', '255,255,255'];
  function resize() { W = cv.width = innerWidth * devicePixelRatio; H = cv.height = innerHeight * devicePixelRatio; }
  function make() {
    return { x: Math.random() * W, y: H + Math.random() * H * .5, r: (6 + Math.random() * 38) * devicePixelRatio,
      vy: (.15 + Math.random() * .5) * devicePixelRatio, vx: (Math.random() - .5) * .25 * devicePixelRatio,
      c: cols[Math.random() * cols.length | 0], a: .05 + Math.random() * .22, ph: Math.random() * 6.28 };
  }
  function frame(t) {
    if (!running) return;
    cx.clearRect(0, 0, W, H); cx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      p.y -= p.vy; p.x += p.vx + Math.sin(t / 2000 + p.ph) * .2;
      if (p.y < -p.r * 2) Object.assign(p, make(), { y: H + p.r });
      const g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      const tw = p.a * (.75 + .25 * Math.sin(t / 700 + p.ph));
      g.addColorStop(0, `rgba(${p.c},${tw})`); g.addColorStop(.55, `rgba(${p.c},${tw * .5})`); g.addColorStop(1, `rgba(${p.c},0)`);
      cx.fillStyle = g; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 6.29); cx.fill();
    }
    requestAnimationFrame(frame);
  }
  addEventListener('resize', resize);
  resize();
  parts = Array.from({ length: 46 }, () => Object.assign(make(), { y: Math.random() * H }));
  return {
    start() { if (running || reduced) return; running = true; requestAnimationFrame(frame); },
    stop() { running = false; },
  };
})();

// ===================== 紙吹雪 =====================
const Confetti = (() => {
  const cv = $('confetti'), cx = cv.getContext('2d');
  let parts = [], running = false;
  const cols = ['#ff4d7e', '#ffd25e', '#3fd8ff', '#4fe3a3', '#ffffff', '#ff8a5b'];
  function burst(n = 160) {
    if (reduced) return;
    cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
    const d = devicePixelRatio;
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      parts.push({ x: (side > 0 ? innerWidth * .08 : innerWidth * .92) * d, y: innerHeight * .75 * d,
        vx: (-side * (4 + Math.random() * 9)) * d, vy: (-12 - Math.random() * 10) * d, g: .32 * d,
        w: (6 + Math.random() * 7) * d, h: (8 + Math.random() * 10) * d, r: Math.random() * 6, vr: (Math.random() - .5) * .35,
        c: cols[Math.random() * cols.length | 0], life: 0 });
    }
    if (!running) { running = true; requestAnimationFrame(frame); }
  }
  function frame() {
    cx.clearRect(0, 0, cv.width, cv.height);
    parts = parts.filter(p => p.life < 260 && p.y < cv.height + 40);
    for (const p of parts) {
      p.life++; p.vy += p.g; p.vx *= .985; p.vy *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.scale(1, Math.cos(p.life / 6));
      cx.fillStyle = p.c; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); cx.restore();
    }
    if (parts.length) requestAnimationFrame(frame); else { running = false; cx.clearRect(0, 0, cv.width, cv.height); }
  }
  return { burst };
})();

// ===================== 写真ビューア（ドラッグ・ズーム） =====================
const Viewer = (() => {
  const box = $('viewer'), img = $('photo');
  const v = { s: 1, x: 0, y: 0 };
  const pts = new Map();
  let pinch = null, moved = 0, hinted = false;
  function clamp() {
    const W = box.clientWidth, H = box.clientHeight;
    v.s = Math.min(4, Math.max(1, v.s));
    v.x = Math.min(0, Math.max(W - W * v.s, v.x));
    v.y = Math.min(0, Math.max(H - H * v.s, v.y));
  }
  function apply(anim) {
    clamp();
    img.style.transition = anim ? 'transform .35s cubic-bezier(.2,.8,.2,1)' : 'none';
    img.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.s})`;
  }
  function zoomAt(px, py, ns, anim) {
    ns = Math.min(4, Math.max(1, ns));
    v.x = px - (px - v.x) * (ns / v.s); v.y = py - (py - v.y) * (ns / v.s); v.s = ns; apply(anim);
  }
  function rel(e) { const r = box.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function used() { if (!hinted) { hinted = true; $('viewHelp').classList.add('hide'); } }
  box.addEventListener('wheel', e => { e.preventDefault(); const p = rel(e); zoomAt(p.x, p.y, v.s * Math.exp(-e.deltaY * .0016)); used(); }, { passive: false });
  box.addEventListener('pointerdown', e => {
    box.setPointerCapture(e.pointerId); pts.set(e.pointerId, rel(e)); moved = 0; box.classList.add('drag');
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: v.s };
    }
  });
  box.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId), cur = rel(e); pts.set(e.pointerId, cur);
    if (pts.size === 1) { v.x += cur.x - prev.x; v.y += cur.y - prev.y; moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y); apply(); }
    else if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d); moved += 10;
    }
    if (moved > 6) used();
  });
  const end = e => {
    pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) box.classList.remove('drag');
    // スマホ：写真をタップしたら地図を閉じる
    if (e.type === 'pointerup' && moved < 6 && isMobile()) closeMobileMap();
  };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
  box.addEventListener('dblclick', e => { const p = rel(e); zoomAt(p.x, p.y, v.s > 1.6 ? 1 : 2.4, true); used(); });
  addEventListener('resize', () => apply());
  return {
    reset() { v.s = 1; v.x = 0; v.y = 0; apply(); },
    showHelp() { hinted = false; $('viewHelp').classList.remove('hide'); setTimeout(() => $('viewHelp').classList.add('hide'), 5000); },
  };
})();

// ===================== Google ストリートビュー（任意） =====================
const SV = (() => {
  let ready = null, broken = false, panorama = null, lookPano = null, svc = null, lib = null, startPano = null;
  window.gm_authFailure = () => {
    broken = true;
    toast('APIキーが使えなかったため、写真モードで続けます', 4200);
    if (body.classList.contains('sv') && G && !G.locked) { const r = G.rounds[G.i]; resetToPhoto(r); ensurePhoto(r).then(() => showPhotoFor(r)); }
    body.classList.remove('sv', 'sv-move', 'nmpz');
    MMMap.fallback(); // 地図も国土地理院に戻す
    if (G && !G.locked && G.rounds[G.i].guess) { guessMarker = null; placeGuess(G.rounds[G.i].guess, true); }
  };
  const load = key => MMMap.loadGoogle(key).then(() => { lib = google.maps; });
  const C = name => lib[name] || google.maps[name];
  // 地点の近くのパノラマを探す。
  // level='road'：Google の車で撮った道路の画像だけ（説明が「横浜市, 神奈川県」のような住所になる。屋内や施設内の撮影は空欄か施設名）
  // level='official'：Google 撮影のもの（個人投稿の360°写真を除く） / level='any'：なんでも
  function find(pos, radius = 70, level = 'road') {
    return new Promise(res => {
      try {
        svc = svc || new (C('StreetViewService'))();
        svc.getPanorama({ location: pos, radius, source: C('StreetViewSource').OUTDOOR }, (data, status) => {
          if (status !== 'OK' || !data || !data.location) return res(null);
          if (level !== 'any' && !/Google/i.test(data.copyright || '')) return res(null);
          if (level === 'road' && !/神奈川県/.test(data.location.description || '')) return res(null);
          res({ pano: data.location.pano, lat: data.location.latLng.lat(), lng: data.location.latLng.lng() });
        });
      } catch { res(null); }
    });
  }
  function baseOpts(pano) {
    return { pano, pov: { heading: Math.random() * 360, pitch: 0 }, zoom: 0, addressControl: false, showRoadLabels: false,
      fullscreenControl: false, motionTracking: false, motionTrackingControl: false, enableCloseButton: false, panControl: false };
  }
  return {
    get usable() { return !!apiKey() && !broken; },
    async prepare() {
      if (!this.usable) return false;
      try { await load(apiKey()); return !broken; }
      catch { toast('Googleマップを読み込めませんでした。写真モードで遊びます', 4000); return false; }
    },
    // 個人投稿の360°写真は使わない（人が大きく写ることがあるため）。見つからなければ写真で出題する
    // スポットの真上だけでなく、周りを円状に調べて条件に合う一番近い画像を選ぶ
    // （真上の一番近い画像が屋内や個人投稿だと、近くに道路の画像があっても見つからないため）
    async find(pos) {
      const ring = (r, n) => Array.from({ length: n }, (_, i) => {
        const t = i / n * Math.PI * 2;
        return { lat: pos.lat + r * Math.sin(t) / 111320, lng: pos.lng + r * Math.cos(t) / (111320 * Math.cos(pos.lat * Math.PI / 180)) };
      });
      // 近い距離を優先：真上 → 60m の輪 → 130m の輪。それぞれ道路の画像、なければ Google 撮影の歩道・広場
      for (const pts of [[pos], ring(60, 6), ring(130, 10)]) {
        for (const level of ['road', 'official']) {
          const hits = (await Promise.all(pts.map(p => find(p, 60, level)))).filter(Boolean);
          if (hits.length) return hits.sort((x, y) => haversine(x, pos) - haversine(y, pos))[0];
        }
      }
      return null;
    },
    // ランダム地点：範囲内からランダムに点を取り、近くのGoogle撮影パノラマに吸着。範囲外・既出の近くは捨てて引き直す
    async random(avoid = []) {
      for (let t = 0; t < 30; t++) {
        const hit = await find(randomInPoly(), 80, 'road');
        if (!hit || !inPoly(hit)) continue;
        if (avoid.some(a => haversine(a, hit) < 220)) continue;
        return hit;
      }
      return null;
    },
    show(pano, move) {
      const opts = Object.assign(baseOpts(pano), {
        linksControl: move === 'move', clickToGo: move === 'move',
        zoomControl: move !== 'nmpz' && !isMobile(), scrollwheel: move !== 'nmpz', keyboardShortcuts: move !== 'nmpz',
      });
      startPano = { pano, pov: opts.pov };
      if (!panorama) panorama = new (C('StreetViewPanorama'))($('pano'), opts);
      else { panorama.setOptions(opts); panorama.setPano(pano); panorama.setPov(opts.pov); panorama.setZoom(0); }
      panorama.setVisible(true);
    },
    backToStart() {
      if (!panorama || !startPano) return;
      panorama.setPano(startPano.pano); panorama.setPov(startPano.pov); panorama.setZoom(0);
    },
    async look(pos) {
      const hit = await this.find(pos);
      if (!hit) return false;
      const opts = Object.assign(baseOpts(hit.pano), { linksControl: true, clickToGo: true, zoomControl: true, fullscreenControl: false });
      if (!lookPano) lookPano = new (C('StreetViewPanorama'))($('lookPano'), opts);
      else { lookPano.setOptions(opts); lookPano.setPano(hit.pano); lookPano.setPov(opts.pov); }
      lookPano.setVisible(true);
      return true;
    },
  };
})();

// ===================== 地図 =====================
const map = MMMap.create($('map'), { zoomCtrl: true, maxZoom: 19, bounds: BOUNDS });
let guessMarker = null;

function placeGuess(p, silent) {
  if (!G || G.locked || !body.classList.contains('phase-game')) return;
  G.rounds[G.i].guess = { lat: p.lat, lng: p.lng };
  if (guessMarker) guessMarker.setPos(p); else guessMarker = map.pin(p, { kind: 'guess' });
  View3D.sync(p);
  if (!silent) { Snd.init(); Snd.pin(); }
  const b = $('guessBtn'); b.disabled = false; b.classList.add('ready'); b.textContent = 'ここだ！（Space）';
}
map.onClick(p => placeGuess(p));
function refreshMap(delay = 0) { setTimeout(() => map.resize(), delay); }

const dock = $('mapDock');
function openMobileMap() { dock.classList.add('open'); body.classList.add('map-open'); refreshMap(460); Snd.click(); }
function closeMobileMap() { if (!dock.classList.contains('open')) return; dock.classList.remove('open'); body.classList.remove('map-open'); }
$('mapFab').addEventListener('click', openMobileMap);
$('dockSize').addEventListener('click', () => {
  if (isMobile()) return closeMobileMap();
  dock.classList.toggle('big'); refreshMap(380); Snd.click();
});
dock.addEventListener('transitionend', e => { if (e.target === dock && (e.propertyName === 'width' || e.propertyName === 'height')) map.resize(); });

// ===================== 3D地図で見くらべる（Google マップのときだけ） =====================
const View3D = (() => {
  let el = null, marker = null, lib = null, isOpen = false;
  async function ensure() {
    if (el) return true;
    try { lib = await google.maps.importLibrary('maps3d'); } catch { return false; }
    el = new lib.Map3DElement({
      center: { lat: 35.4562, lng: 139.6345, altitude: 0 }, range: 1900, tilt: 62, heading: -25,
      mode: (lib.MapMode && lib.MapMode.HYBRID) || 'HYBRID',
    });
    el.addEventListener('gmp-click', e => {
      const p = e.position;
      if (!p || !G || G.locked) return;
      placeGuess({ lat: p.lat, lng: p.lng });
    });
    $('map3dHost').append(el);
    return true;
  }
  function sync(p) {
    const b = $('guess3d');
    b.disabled = !p; b.classList.toggle('ready', !!p);
    b.textContent = p ? 'ここだ！（Space）' : '地面をクリックしてピンを立てる';
    if (!el) return;
    if (!p) { if (marker) { marker.remove(); marker = null; } return; }
    const pos = { lat: p.lat, lng: p.lng };
    if (!marker) {
      marker = new lib.Marker3DElement({ position: pos, altitudeMode: (lib.AltitudeMode && lib.AltitudeMode.CLAMP_TO_GROUND) || 'CLAMP_TO_GROUND' });
      el.append(marker);
    } else marker.position = pos;
  }
  return {
    get isOpen() { return isOpen; },
    async open() {
      if (!G || G.locked || MMMap.engine !== 'google') return;
      $('view3d').hidden = false; isOpen = true; Snd.whoosh();
      if (!(await ensure())) { this.close(); return toast('3D地図を読み込めませんでした'); }
      const r = G.rounds[G.i];
      const pip = $('v3Pip');
      pip.hidden = !!r.sv || !r.photo; // 写真で出題しているときは、見くらべ用に小さく出す
      if (!pip.hidden) pip.src = r.photo.src;
      sync(r.guess);
    },
    close() { $('view3d').hidden = true; isOpen = false; },
    sync,
  };
})();
$('open3d').addEventListener('click', () => { Snd.click(); View3D.open(); });
$('close3d').addEventListener('click', () => { Snd.click(); View3D.close(); });
$('guess3d').addEventListener('click', () => submitGuess());
$('v3Pip').addEventListener('click', e => e.currentTarget.classList.toggle('big'));

// ===================== ゲーム進行 =====================
let G = null;
let timerId = null;

const THEMES = {
  sights: { name: '名所めぐり' },
  biz: { name: 'みなとみらいの企業' },
  date: { name: 'デートスポット' },
  random: { name: 'ランダム' },
};
const inTheme = (spot, theme) => theme === 'random' || spot.themes.includes(theme);
const spotDiff = id => { const d = PHOTOS.filter(p => p.spot === id).map(p => p.diff); return d.length ? Math.min(...d) : 2; };

// ---- 出題の履歴：最近出たスポット・写真ほど後回しにする（全部ひと通り出るまで同じものは出にくい） ----
const Seen = {
  get() { return store.get('seen', {}); },
  mark(ids) {
    const s = this.get(), t = Date.now();
    ids.filter(Boolean).forEach(id => { s[id] = t; });
    const keys = Object.keys(s);
    if (keys.length > 400) keys.sort((x, y) => s[x] - s[y]).slice(0, keys.length - 400).forEach(k => delete s[k]); // 古い記録は捨てる
    store.set('seen', s);
  },
  // 出ていないもの → 古いもの の順。同じ順位どうしはランダム
  order(list, key) { const s = this.get(); return shuffle(list).sort((a, b) => (s[key(a)] || 0) - (s[key(b)] || 0)); },
};

// 出題を5つ選ぶ。同じスポットは1ゲーム1回まで。最近出ていないものを優先し、やさしい問題から順に並べる
function pickRounds(theme, useSV) {
  if (useSV && theme !== 'random') {
    // ストリートビュー：テーマのスポットから選び、その周りのランダムな地点の景色で出題（写真がない企業も出せる）
    return Seen.order(window.MM_SPOTS.filter(s => inTheme(s, theme)), s => s.id).slice(0, ROUNDS)
      .sort((a, b) => spotDiff(a.id) - spotDiff(b.id))
      .map(s => { const ph = closestPhotoOf(s.id, s) || null; return { spot: s, photo: ph, base: ph, answer: { lat: s.lat, lng: s.lng }, spotMode: true }; });
  }
  const spots = Seen.order(window.MM_SPOTS.filter(s => inTheme(s, theme) && PHOTOS.some(p => p.spot === s.id)), s => s.id).slice(0, ROUNDS);
  return spots.map(s => Seen.order(PHOTOS.filter(p => p.spot === s.id), p => p.id)[0])
    .sort((a, b) => a.diff - b.diff)
    .map(p => ({ spot: SPOTS[p.spot], photo: p, base: p, answer: { lat: p.lat, lng: p.lng }, wantRandom: useSV && theme === 'random' }));
}
function replacementFor(rounds) {
  const used = new Set(rounds.map(r => r.spot.id));
  const pool = shuffle(PHOTOS.filter(p => !used.has(p.spot)));
  return pool.find(p => inTheme(SPOTS[p.spot], G.theme)) || pool[0];
}

let lastTheme = 'sights';
async function startGame(theme = lastTheme) {
  Snd.init(); Snd.click();
  lastTheme = theme;
  const game = G = { theme, i: 0, total: 0, locked: true, rounds: [] };
  closeModal($('lookModal'));
  setPhase('game');
  Bokeh.stop();
  $('scoreNow').textContent = '0';
  $('loader').classList.add('on');
  const useSV = await SV.prepare();
  if (G !== game) return;
  G.useSV = useSV;
  G.move = useSV ? settings.move : 'move';
  G.rounds = pickRounds(theme, useSV).map(it => Object.assign(it, {
    guess: null, score: 0, dist: null, hint: false, sv: null, random: false,
    ready: it.photo ? loadImg(it.photo.src) : Promise.resolve(false),
  }));
  await startRound();
}

async function ensurePhoto(r) {
  let ok = await r.ready;
  let tries = 0;
  while (!ok && tries++ < 3) { // 読み込めなかったら別の写真に差し替える
    const alt = replacementFor(G.rounds.filter(x => x !== r));
    if (!alt) break;
    Object.assign(r, { photo: alt, base: alt, spot: SPOTS[alt.spot], answer: { lat: alt.lat, lng: alt.lng } });
    r.ready = loadImg(alt.src); ok = await r.ready;
  }
  return ok;
}
function resetToPhoto(r) {
  if (!r.base) r.base = replacementFor(G.rounds.filter(x => x !== r)); // 写真のない企業スポットは別の写真に差し替える
  Object.assign(r, { photo: r.base, spot: SPOTS[r.base.spot], answer: { lat: r.base.lat, lng: r.base.lng }, sv: null, random: false, spotDist: null });
  r.ready = loadImg(r.base.src);
}
function showPhotoFor(r) {
  const img = $('photo');
  img.classList.remove('in'); img.src = r.photo.src; void img.offsetWidth; img.classList.add('in');
  Viewer.reset();
}

async function startRound() {
  const game = G, r = G.rounds[G.i];
  $('scoreNow').textContent = G.total.toLocaleString();
  G.locked = true;
  // 画面リセット
  body.classList.remove('revealing', 'card-in', 'map-open');
  dock.classList.remove('big', 'open');
  map.clear(); guessMarker = null;
  map.setView({ lat: CENTER[0], lng: CENTER[1] }, 15); refreshMap(560);
  $('roundNo').textContent = G.i + 1;
  $('hintBtn').disabled = false;
  const gb = $('guessBtn'); gb.disabled = true; gb.classList.remove('ready'); gb.textContent = '地図にピンを立てる';
  $('timer').hidden = !settings.time;
  View3D.close(); View3D.sync(null);
  $('open3d').hidden = MMMap.engine !== 'google';

  $('loader').classList.add('on');
  let sv = null;
  if (G.useSV && SV.usable) {
    if (r.wantRandom) {
      sv = await SV.random(G.rounds.slice(0, G.i).map(x => x.answer));
      if (sv) { // 答えに一番近い名所を「近くのスポット」として解説する
        const near = nearestSpot(sv);
        Object.assign(r, { random: true, spot: near.spot, spotDist: near.d, photo: closestPhotoOf(near.spot.id, sv) });
      }
    } else {
      // 毎回ちがう景色にするため、スポットから40〜110mずらした地点の近くを探す（遠くなりすぎたらスポットの近くで探し直す）
      const ang = Math.random() * Math.PI * 2, off = 40 + Math.random() * 70;
      const start = { lat: r.answer.lat + off * Math.sin(ang) / 111320, lng: r.answer.lng + off * Math.cos(ang) / (111320 * Math.cos(r.answer.lat * Math.PI / 180)) };
      sv = await SV.find(start);
      if (!sv || haversine(sv, r.spot) > 170) sv = await SV.find(r.answer);
    }
  }
  if (G !== game) return;
  body.classList.toggle('nmpz', !!sv && G.move === 'nmpz');
  body.classList.toggle('sv-move', !!sv && G.move === 'move');
  if (sv) { r.sv = sv; r.answer = { lat: sv.lat, lng: sv.lng }; body.classList.add('sv'); SV.show(sv.pano, G.move); }
  else { body.classList.remove('sv'); if (r.random || r.spotMode) resetToPhoto(r); await ensurePhoto(r); }
  if (G !== game) return;
  Seen.mark([r.spot.id, r.photo && !r.sv ? r.photo.id : null, r.sv && r.sv.pano]);
  $('loader').classList.remove('on');

  // ラウンド開始の演出
  const ri = $('roundIntro'); $('riNo').textContent = G.i + 1;
  ri.classList.remove('play'); void ri.offsetWidth; ri.classList.add('play');
  Snd.round();
  await sleep(reduced ? 50 : 480);
  if (G !== game) return;
  if (!sv) { showPhotoFor(r); if (G.i === 0) Viewer.showHelp(); }
  await sleep(reduced ? 50 : 700);
  if (G !== game) return;
  G.locked = false;
  startTimer();
}

function startTimer() {
  clearInterval(timerId);
  if (!settings.time) return;
  let left = settings.time;
  const bar = $('timerBar'), txt = $('timerText'), box = $('timer'), C = 119.4;
  const draw = () => { txt.textContent = left; bar.style.strokeDashoffset = C * (1 - left / settings.time); box.classList.toggle('warn', left <= 10); };
  bar.style.transition = 'none'; draw(); void bar.getBoundingClientRect(); bar.style.transition = '';
  timerId = setInterval(() => {
    left--; draw();
    if (left <= 10 && left > 0) Snd.warn();
    if (left <= 0) { clearInterval(timerId); submitGuess(true); }
  }, 1000);
}

function useHint() {
  if (!G || G.locked) return;
  const r = G.rounds[G.i];
  if (r.hint) return;
  r.hint = true; $('hintBtn').disabled = true; Snd.click();
  // 正解をずらした中心に円を出す（円の真ん中＝正解、にはしない）
  const ang = Math.random() * Math.PI * 2, off = 60 + Math.random() * 140;
  const c = { lat: r.answer.lat + (off * Math.sin(ang)) / 111320, lng: r.answer.lng + (off * Math.cos(ang)) / (111320 * Math.cos(r.answer.lat * Math.PI / 180)) };
  const ht = $('hintToast');
  ht.textContent = `ヒント：「${r.spot.area}」の青い円のどこか（このラウンドは7割の点数）`;
  ht.classList.add('show'); setTimeout(() => ht.classList.remove('show'), 4200);
  if (isMobile()) openMobileMap(); else { dock.classList.add('big'); }
  setTimeout(() => map.circle(c, 330), isMobile() ? 470 : 380);
}

async function submitGuess(timeout = false) {
  if (!G || G.locked) return;
  const r = G.rounds[G.i];
  if (!r.guess && !timeout) return;
  G.locked = true; clearInterval(timerId);
  View3D.close();
  r.dist = r.guess ? haversine(r.guess, r.answer) : null;
  r.score = r.guess ? Math.round(scoreOf(r.dist) * (r.hint ? .7 : 1)) : 0;
  G.total += r.score;
  const isNew = registerDex(r); // 演出を飛ばされても図鑑には必ず登録する
  const game = G, idx = G.i;
  const alive = () => G === game && game.i === idx && body.classList.contains('phase-game');

  // 地図を全画面へ広げる
  body.classList.remove('map-open'); dock.classList.remove('big', 'open');
  body.classList.add('revealing');
  Snd.whoosh();
  await sleep(560); if (!alive()) return;
  map.resize();

  const A = r.answer;
  const pad = isMobile() ? { padTL: [40, 70], padBR: [40, 40] } : { padTL: [460, 110], padBR: [80, 80] };
  if (r.guess) {
    map.fit([r.guess, A], { ...pad, maxZoom: 17 });
    await sleep(reduced ? 50 : 1150); if (!alive()) return;
    // 線を引くアニメーション
    const line = map.line(r.guess, A, 'reveal');
    await line.draw(); if (!alive()) return;
    line.label(fmtDist(r.dist).join(''));
  } else {
    map.flyTo(A, 16);
    await sleep(reduced ? 50 : 1150); if (!alive()) return;
  }
  r.spotDist = haversine(A, r.spot);
  if (r.spotDist > 60) { // 答え（撮影地点）とスポット本体が離れているときは、スポットを★で別に出す
    map.line(A, r.spot, 'link');
    map.star(r.spot, r.spot.name);
    map.pin(A, { kind: 'answer', ripple: true, label: r.sv ? '正解' : '正解（撮影地点）', z: 5 });
  } else map.pin(A, { kind: 'answer', ripple: true, label: r.spot.name, labelCls: 'spot-label', z: 5 });
  Snd.land();

  // 答え合わせカード
  fillReveal(r);
  await sleep(120); if (!alive()) return;
  body.classList.add('card-in');
  await sleep(reduced ? 0 : 420); if (!alive()) return;
  const rt = $('rvRating'); rt.textContent = rating(r) + (r.hint ? '（ヒント使用）' : '');
  paintGradeMeter(r); rt.classList.remove('pop'); void rt.offsetWidth; rt.classList.add('pop');
  const [dv, du] = r.guess ? fmtDist(r.dist) : ['—', ''];
  $('rvDistUnit').textContent = du;
  const bar = $('rvBar');
  bar.style.transition = 'none'; bar.style.width = '0'; void bar.offsetWidth;
  bar.style.transition = 'width 1.3s cubic-bezier(.2,.8,.2,1)'; bar.style.width = (r.score / MAXP * 100) + '%';
  if (r.guess) countUp($('rvDist'), parseFloat(dv), 900, v => du === 'km' ? v.toFixed(2) : String(Math.round(v)));
  else $('rvDist').textContent = '—';
  await countUp($('rvScore'), r.score, 1300, undefined, () => alive() && Snd.tick());
  if (!alive()) return;
  if (r.score >= 4000) { Snd.great(); Confetti.burst(r.score >= 4800 ? 220 : 120); }
  else if (r.score >= 1500) Snd.good(); else Snd.meh();
  const sp = $('scorePill'); $('scoreNow').textContent = G.total.toLocaleString(); sp.classList.remove('bump'); void sp.offsetWidth; sp.classList.add('bump');
  if (isNew) { $('rvNew').classList.add('show'); setTimeout(() => Snd.stamp(), 300); }
  $('nextBtn').focus({ preventScroll: true });
}

function setImg(img, photo, alt) {
  img.hidden = !photo;
  if (photo) { img.src = photo.src; img.alt = alt; } else img.removeAttribute('src');
}
function paintGradeMeter(r) {
  const box = $('rvGrades'), g = r.guess ? gradeOf(r.dist) : null;
  box.textContent = '';
  GRADES.forEach(x => { const s = document.createElement('span'); s.textContent = x.short; if (x === g) s.className = 'on'; box.append(s); });
}
function renderRules() {
  const fmt = n => n.toLocaleString();
  const gRows = GRADES.map(g => {
    const pt = g.max === Infinity ? '133点未満' : g.max <= PERFECT_M ? '5,000点' : `${fmt(scoreOf(g.max))}点以上`;
    return `<tr><td>${g.name}</td><td>${g.max === Infinity ? '600mより遠い' : g.max + 'm以内'}</td><td>${pt}</td></tr>`;
  }).join('');
  const rRows = RANKS.map(r => `<tr><td><b>${r.letter}</b></td><td>Lv.${r.lv} ${r.title}</td><td>${fmt(r.min)}点以上</td></tr>`).join('');
  $('rulesBody').innerHTML = `
    <p>1ゲーム5問。ピンと正解の<b>距離</b>だけで点数が決まります（1問最大5,000点）。</p>
    <h3>1問ごとの判定</h3>
    <table><tr><th>判定</th><th>正解からの距離</th><th>点数</th></tr>${gRows}</table>
    <p class="note">20mを過ぎると、160m離れるごとに点数が約0.37倍になります。ヒントを使った問題は7割の点数です。</p>
    <h3>5問合計のランク</h3>
    <table><tr><th>ランク</th><th>称号</th><th>合計</th></tr>${rRows}</table>
    <p class="note"><b>Bランク（${fmt(CLEAR_SCORE)}点）以上でクリア。</b>目安：適当に置くと約1,000点、地区だけ分かると約10,000点、だいたい分かると約18,000点、よく知っていると約23,000点。</p>`;
}
function openRules() { renderRules(); openModal('rulesModal'); Snd.init(); Snd.click(); }
function fillReveal(r) {
  const s = r.spot;
  setImg($('rvImg'), r.photo, s.name);
  $('rvArea').textContent = r.random ? `近くのスポット・${s.area}（正解地点から${fmtDist(haversine(r.answer, s)).join('')}）` : s.area;
  $('lookBtn').hidden = !SV.usable || !G.useSV;
  $('rvName').textContent = s.name;
  $('rvDesc').textContent = s.desc;
  $('rvTrivia').textContent = s.trivia;
  fillGuide('rv', s);
  $('rvDateBox').hidden = !(G.theme === 'date' && s.date);
  $('rvDate').textContent = s.date || '';
  const c = $('rvCredit'); c.textContent = '';
  if (r.photo) { c.append(creditNode(r.photo)); if (r.sv) c.prepend('（写真はスポットの参考）'); }
  if (r.sv) c.append((r.photo ? '　' : '') + 'ストリートビュー：© Google');
  $('rvDist').textContent = '0'; $('rvScore').textContent = '0';
  $('rvNew').classList.remove('show');
  $('nextBtn').querySelector('span').textContent = G.i === ROUNDS - 1 ? '結果を見る' : 'つぎへ';
  document.querySelector('.rv-card').scrollTop = 0;
}

function nextRound() {
  if (!G || !body.classList.contains('card-in')) return;
  Snd.click();
  if (G.i >= ROUNDS - 1) return showFinal();
  G.i++;
  startRound();
}

// ===================== 図鑑 =====================
function getDex() { return store.get('dex', {}); }
function registerDex(r) {
  const dex = getDex(), id = r.spot.id, isNew = !dex[id];
  dex[id] = { seen: (dex[id]?.seen || 0) + 1, best: Math.max(dex[id]?.best || 0, r.score), photo: dex[id]?.photo || r.photo?.id };
  store.set('dex', dex); updateDexCount();
  return isNew;
}
function updateDexCount() {
  const n = Object.keys(getDex()).filter(k => SPOTS[k]).length;
  $('dexCount').textContent = `${n}/${window.MM_SPOTS.length}`;
}
function photoForSpot(id) {
  const d = getDex()[id];
  return PHOTOS.find(p => d && p.id === d.photo) || PHOTOS.find(p => p.spot === id);
}
let dexFilter = 'all';
function openDex() {
  const dex = getDex(), grid = $('dexGrid'); grid.textContent = '';
  const n = Object.keys(dex).filter(k => SPOTS[k]).length;
  $('dexSub').textContent = `${n} / ${window.MM_SPOTS.length} スポット発見。ゲームで出会ったスポットが登録されます。`;
  document.querySelectorAll('#dexFilter button').forEach(b => b.classList.toggle('on', b.dataset.f === dexFilter));
  window.MM_SPOTS.forEach((s, i) => {
    if (dexFilter !== 'all' && !s.themes.includes(dexFilter)) return;
    const got = !!dex[s.id], p = photoForSpot(s.id);
    const b = document.createElement('button'); b.className = 'dex-item' + (got ? '' : ' locked');
    if (p) { const img = document.createElement('img'); img.loading = 'lazy'; img.src = p.src; img.alt = ''; b.append(img); }
    else { const ph = document.createElement('i'); ph.className = 'dex-ph'; ph.textContent = s.themes.includes('biz') ? '社' : '★'; b.append(ph); }
    const no = document.createElement('em'); no.textContent = 'No.' + String(i + 1).padStart(2, '0');
    const nm = document.createElement('span'); nm.textContent = got ? s.name : '？？？（' + s.area + '）';
    b.append(no, nm);
    b.addEventListener('click', () => { Snd.click(); got ? openSpot(s.id) : toast('まだ見つけていません。ゲームで出会うと登録されます'); });
    grid.append(b);
  });
  openModal('dexModal');
}
document.querySelectorAll('#dexFilter button').forEach(b => b.addEventListener('click', () => { dexFilter = b.dataset.f; Snd.click(); openDex(); }));
let spotMap = null;
function openSpot(id) {
  const s = SPOTS[id], p = photoForSpot(id);
  setImg($('smImg'), p, s.name);
  $('smArea').textContent = s.area; $('smName').textContent = s.name;
  $('smDesc').textContent = s.desc; $('smTrivia').textContent = s.trivia;
  fillGuide('sm', s); document.querySelector('#spotModal .modal-box').scrollTop = 0;
  $('smDateBox').hidden = !s.date; $('smDate').textContent = s.date || '';
  const c = $('smCredit'); c.textContent = ''; if (p) c.append(creditNode(p));
  openModal('spotModal');
  if (!spotMap) spotMap = MMMap.create($('smMap'), { center: [s.lat, s.lng], zoom: 16, wheel: false });
  setTimeout(() => { spotMap.resize(); spotMap.clear(); spotMap.setView(s, 16); spotMap.pin(s, { kind: 'answer', ripple: true }); }, 60);
}

// ===================== 結果 =====================
let finalMap = null;
async function showFinal() {
  setPhase('final');
  const total = G.total, bk = 'best2.' + G.theme, best = store.get(bk, 0), isBest = total > best;
  if (isBest) store.set(bk, total);
  const rk = rankOf(total), clear = total >= CLEAR_SCORE;
  $('finalRank').innerHTML = ''; $('finalRank').append(rk.title);
  const sm = document.createElement('small'); sm.textContent = rk.msg; $('finalRank').append(sm);
  const L = $('finalLetter'); L.textContent = rk.letter; L.className = 'final-letter r-' + rk.letter;
  const fc = $('finalClear'); fc.className = 'final-clear ' + (clear ? 'ok' : 'ng');
  fc.textContent = clear ? 'クリア！' : `クリアまであと ${(CLEAR_SCORE - total).toLocaleString()} 点`;
  const up = RANKS.slice().reverse().find(r => r.min > total);
  const pitari = G.rounds.filter(r => r.guess && r.dist <= PERFECT_M).length;
  $('finalNext').textContent = (up ? `${up.letter}ランクまであと ${(up.min - total).toLocaleString()} 点` : '最高ランク達成！') + `　ピタリ ${pitari}/5`;
  const rb = store.get('rank.' + G.theme, ''); if (!rb || 'SABCD'.indexOf(rk.letter) < 'SABCD'.indexOf(rb)) store.set('rank.' + G.theme, rk.letter);
  const tn = THEMES[G.theme].name;
  $('finalBest').textContent = isBest ? (best ? `「${tn}」自己ベスト更新！（前回 ${best.toLocaleString()}）` : `「${tn}」はじめての記録！`) : `「${tn}」自己ベスト ${best.toLocaleString()}`;
  updateBest();
  { const R = rarityOf(rk); $('shareBtn').dataset.r = R.code; $('shareBtn').querySelector('small').textContent = `${R.code} ${'★'.repeat(R.stars)} のカードをゲット`; }

  if (!finalMap) finalMap = MMMap.create($('finalMap'), { zoomCtrl: true, bounds: BOUNDS });
  finalMap.clear();
  const pts = [];
  G.rounds.forEach((r, i) => {
    pts.push(r.answer);
    if (r.guess) {
      pts.push(r.guess);
      finalMap.line(r.guess, r.answer, 'final');
      finalMap.pin(r.guess, { kind: 'guess', num: String(i + 1) });
    }
    finalMap.pin(r.answer, { kind: 'answer', num: String(i + 1) });
  });
  setTimeout(() => { finalMap.resize(); finalMap.fit(pts, { padTL: [50, 50], padBR: [50, 50], maxZoom: 17, animate: false }); }, 80);

  const list = $('finalList'); list.textContent = '';
  G.rounds.forEach((r, i) => {
    const li = document.createElement('li');
    const no = document.createElement('span'); no.className = 'no'; no.textContent = i + 1;
    const img = document.createElement('img'); img.alt = ''; if (r.photo) img.src = r.photo.src; else img.className = 'noimg';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.spot.name;
    const sub = document.createElement('small'); sub.textContent = r.guess ? fmtDist(r.dist).join('') + (r.hint ? '・ヒント' : '') : '時間切れ'; nm.append(sub);
    const pt = document.createElement('span'); pt.className = 'pt'; pt.textContent = r.score.toLocaleString();
    li.append(no, img, nm, pt);
    li.addEventListener('click', () => { Snd.click(); finalMap.flyTo(r.answer, 17); openSpot(r.spot.id); });
    list.append(li);
    setTimeout(() => li.classList.add('in'), 500 + i * 120);
  });
  $('finalScore').textContent = '0';
  await sleep(300);
  await countUp($('finalScore'), total, 1800, undefined, () => Snd.tick());
  $('finalLetter').classList.add('show'); Snd.stamp();
  if (total >= 17000) { Snd.great(); Confetti.burst(260); } else Snd.good();
}

function shareText() {
  const sq = r => !r.guess ? '⬛' : r.dist <= 60 ? '🟩' : r.dist <= 150 ? '🟨' : r.dist <= 300 ? '🟧' : '🟥';
  const rkObj = rankOf(G.total), rk = `${rkObj.letter}ランク Lv.${rkObj.lv}・${rkObj.title}${G.total >= CLEAR_SCORE ? '・クリア' : ''}`;
  const mode = THEMES[G.theme].name + (G.useSV ? `・ストリートビュー（${MOVE_LABEL[G.move]}）` : '・写真');
  return `${CONFIG.appName} みなとみらいジオゲッサー（${mode}）\n${G.total.toLocaleString()} / 25,000点「${rk}」\n${G.rounds.map(r => sq(r)).join('')}`;
}
async function copyShare() {
  const t = shareText();
  try { await navigator.clipboard.writeText(t); }
  catch {
    const ta = document.createElement('textarea'); ta.value = t; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* 無視 */ } ta.remove();
  }
  toast('結果をコピーしました');
}

// ===================== 認定証カード（トレカ風・SNSに貼れる画像） =====================
// カード本体は 900×1260（トレカと同じ 5:7）。保存する画像は、カードを 1080×1350（SNS向け 4:5）の台紙に載せたもの。
const TCG_W = 900, TCG_H = 1260, STAGE_W = 1080, STAGE_H = 1350;
const GRADE_COLOR = { 'g-s': '#ffd25e', 'g-a': '#4fe3a3', 'g-b': '#3fd8ff', 'g-c': '#ff9a5b', 'g-d': '#ff5d8a', 'g-e': '#6c7c99' };
// ランクごとのレア度。frame＝枠の金属色、sky＝イラストの空、holo＝ホロの強さ
const RARITY = {
  D: { code: 'N',   stars: 1, name: 'ノーマル',       frame: ['#e6ebf2', '#8b97ab', '#f4f6fa', '#6f7b90', '#d5dbe5'], accent: '#c3cede', ink: '#141b29',
       panel: ['#1d2638', '#121927'], sky: ['#16223b', '#2f4466', '#56688a'], holo: 0 },
  C: { code: 'R',   stars: 2, name: 'レア',           frame: ['#c9f0ff', '#2f7fe0', '#e6f8ff', '#1f55b5', '#8fd8ff'], accent: '#6fd0ff', ink: '#06183a',
       panel: ['#0f2650', '#0a1631'], sky: ['#071a44', '#174a95', '#3d86c9'], holo: .22 },
  B: { code: 'SR',  stars: 3, name: 'スーパーレア',   frame: ['#fff6c8', '#d99a26', '#ffe592', '#9c6410', '#ffd25e'], accent: '#ffd25e', ink: '#2b1700',
       panel: ['#2a1d10', '#160f08'], sky: ['#1a1242', '#7a3b6a', '#f08a4b'], holo: .4 },
  A: { code: 'SSR', stars: 4, name: 'ダブルスーパーレア', frame: ['#ffe0ef', '#ff4d7e', '#ffd25e', '#ff8a5b', '#ffb3d1'], accent: '#ff7fae', ink: '#2e0716',
       panel: ['#2c0f2a', '#160818'], sky: ['#1b0838', '#6d1f6b', '#e2507a'], holo: .6 },
  S: { code: 'UR',  stars: 5, name: 'アルティメットレア', frame: ['#ff6fa8', '#ffd25e', '#5cffb4', '#3fd8ff', '#a77bff', '#ff6fa8'], accent: '#ffe27a', ink: '#1a0b00',
       panel: ['#1b1036', '#0b0820'], sky: ['#070420', '#2c1268', '#7a2fa0'], holo: .85, legend: true },
};
const rarityOf = rk => RARITY[rk.letter];
const PUBLIC_URL = 'kazuma5313.github.io/minatomirai-geoguessr';
function shareUrl() {
  return location.protocol.startsWith('http') && !/^(localhost|127\.|\[::1\])/.test(location.hostname)
    ? (location.host + location.pathname).replace(/\/(index\.html)?$/, '') : PUBLIC_URL;
}
const JP = '"Zen Kaku Gothic New", sans-serif', EN = 'Outfit, sans-serif';
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function lin(c, x0, y0, x1, y1, stops) { const g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s)); return g; }
function fitFont(c, text, weight, family, size, maxW, min = 18) {
  for (; size > min; size -= 2) { c.font = `${weight} ${size}px ${family}`; if (c.measureText(text).width <= maxW) break; }
  return size;
}
function clip(c, text, maxW) {
  if (c.measureText(text).width <= maxW) return text;
  while (text.length > 1 && c.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text + '…';
}
function wrapLines(c, text, maxW, maxLines) {
  const lines = []; let cur = '';
  for (const ch of text) { if (c.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; } else cur += ch; }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = clip(c, lines[maxLines - 1] + '…', maxW); }
  return lines;
}
// 同じ結果なら同じ絵になる乱数
function seeded(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function sparkle(c, x, y, r, col) {
  c.save(); c.translate(x, y); c.fillStyle = col; c.beginPath();
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, l = i % 2 ? r * .22 : r; c.lineTo(Math.cos(a) * l, Math.sin(a) * l); }
  c.closePath(); c.fill(); c.restore();
}
// 金属っぽい縞（枠用）
function metal(c, x, y, w, h, cols) {
  const g = c.createLinearGradient(x, y, x + w, y + h), n = cols.length * 3;
  for (let i = 0; i <= n; i++) g.addColorStop(i / n, cols[i % cols.length]);
  return g;
}

// イラスト：みなとみらいの夜景。レア度が上がるほど空と光が豪華になる
function drawArt(c, x, y, w, h, R, rnd) {
  c.save(); rr(c, x, y, w, h, 18); c.clip();
  c.fillStyle = lin(c, 0, y, 0, y + h * .8, R.sky); c.fillRect(x, y, w, h);
  // オーロラ（UR）
  if (R.legend) {
    c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      c.beginPath(); c.moveTo(x, y + h * (.18 + k * .08));
      for (let i = 0; i <= 12; i++) c.lineTo(x + w * i / 12, y + h * (.18 + k * .08) + Math.sin(i * .9 + k) * 26);
      c.lineTo(x + w, y); c.lineTo(x, y); c.closePath();
      c.fillStyle = ['rgba(92,255,180,.12)', 'rgba(63,216,255,.10)', 'rgba(167,123,255,.12)'][k]; c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }
  // 星
  const nStars = 30 + R.stars * 22;
  for (let i = 0; i < nStars; i++) {
    const sx = x + rnd() * w, sy = y + rnd() * h * .55, a = .3 + rnd() * .7;
    c.fillStyle = `rgba(255,255,255,${a})`; c.fillRect(sx, sy, 2, 2);
  }
  for (let i = 0; i < R.stars; i++) sparkle(c, x + 40 + rnd() * (w - 80), y + 30 + rnd() * h * .35, 7 + rnd() * 6, 'rgba(255,255,255,.9)');
  // 月
  const mx = x + w * .12, my = y + h * .2;
  const mg = c.createRadialGradient(mx, my, 0, mx, my, 90); mg.addColorStop(0, 'rgba(255,240,200,.45)'); mg.addColorStop(1, 'rgba(255,240,200,0)');
  c.fillStyle = mg; c.fillRect(mx - 90, my - 90, 180, 180);
  c.fillStyle = '#fff4d6'; c.beginPath(); c.arc(mx, my, 26, 0, Math.PI * 2); c.fill();
  c.fillStyle = R.sky[0]; c.globalAlpha = .55; c.beginPath(); c.arc(mx + 11, my - 7, 23, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
  // 花火（SSR 以上）
  if (R.stars >= 4) {
    const cols = R.legend ? ['#ffd25e', '#5cffb4', '#3fd8ff', '#ff6fa8'] : ['#ffd25e', '#ff7fae'];
    const n = R.legend ? 4 : 2;
    c.globalCompositeOperation = 'lighter';
    for (let f = 0; f < n; f++) {
      const fx = x + w * (.38 + f * .17 + rnd() * .05), fy = y + h * (.14 + rnd() * .14), fr = 46 + rnd() * 34, col = cols[f % cols.length];
      c.strokeStyle = col; c.lineWidth = 2.5;
      for (let i = 0; i < 28; i++) {
        const a = i / 28 * Math.PI * 2;
        c.globalAlpha = .75; c.beginPath(); c.moveTo(fx + Math.cos(a) * fr * .3, fy + Math.sin(a) * fr * .3); c.lineTo(fx + Math.cos(a) * fr, fy + Math.sin(a) * fr); c.stroke();
        c.fillStyle = col; c.beginPath(); c.arc(fx + Math.cos(a) * fr * 1.08, fy + Math.sin(a) * fr * 1.08, 2.4, 0, Math.PI * 2); c.fill();
      }
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  const base = y + h * .74;
  // 街並み
  const dark = '#070b16', win = R.stars >= 3 ? '#ffd98a' : '#bcd6ff';
  const tower = (tx, tw, th) => {
    c.fillStyle = dark; c.fillRect(tx, base - th, tw, th);
    for (let wy = base - th + 10; wy < base - 6; wy += 11) for (let wx = tx + 5; wx < tx + tw - 5; wx += 9)
      if (rnd() < .34) { c.fillStyle = win; c.globalAlpha = .35 + rnd() * .55; c.fillRect(wx, wy, 4, 5); }
    c.globalAlpha = 1;
  };
  // 遠景のビル
  c.fillStyle = 'rgba(10,16,32,.55)';
  for (let i = 0; i < 16; i++) { const bw = 30 + rnd() * 40, bh = 40 + rnd() * 90; c.fillRect(x + rnd() * w, base - bh, bw, bh); }
  // ランドマークタワー（段々に細く、上に灯り）
  const lx = x + w * .14;
  tower(lx, 92, h * .42); tower(lx + 8, 76, h * .52); tower(lx + 16, 60, h * .58);
  c.fillStyle = dark; c.fillRect(lx + 34, base - h * .62, 24, h * .05);
  c.fillStyle = '#ff4d5e'; c.beginPath(); c.arc(lx + 46, base - h * .625, 3.5, 0, Math.PI * 2); c.fill();
  // クイーンズスクエア
  tower(x + w * .3, 54, h * .36); tower(x + w * .3 + 58, 50, h * .31); tower(x + w * .3 + 112, 46, h * .26);
  // コスモクロック（観覧車）
  const cx = x + w * .62, cy = base - h * .25, cr = h * .21;
  c.strokeStyle = dark; c.lineWidth = 7; c.beginPath(); c.moveTo(cx - cr * .45, base); c.lineTo(cx, cy); c.lineTo(cx + cr * .45, base); c.stroke();
  c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,.25)';
  for (let i = 0; i < 30; i++) { const a = i / 30 * Math.PI * 2; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * cr, cy + Math.sin(a) * cr); c.stroke(); }
  c.lineWidth = 4; c.strokeStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.arc(cx, cy, cr, 0, Math.PI * 2); c.stroke();
  for (let i = 0; i < 60; i++) {
    const a = i / 60 * Math.PI * 2;
    c.fillStyle = R.stars >= 3 ? `hsl(${i * 6} 95% 68%)` : (i % 2 ? '#7fd3ff' : '#ffffff');
    c.beginPath(); c.arc(cx + Math.cos(a) * cr, cy + Math.sin(a) * cr, 2.6, 0, Math.PI * 2); c.fill();
  }
  c.font = `800 ${Math.round(cr * .3)}px ${EN}`; c.fillStyle = R.stars >= 3 ? '#ffe27a' : '#cfe6ff'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('21:00', cx, cy);
  // インターコンチネンタル（帆の形）
  const hx = x + w * .8;
  c.fillStyle = dark; c.beginPath(); c.moveTo(hx, base); c.quadraticCurveTo(hx + 10, base - h * .36, hx + 70, base - h * .4);
  c.quadraticCurveTo(hx + 96, base - h * .2, hx + 120, base); c.closePath(); c.fill();
  for (let i = 0; i < 9; i++) { c.fillStyle = win; c.globalAlpha = .55; c.fillRect(hx + 30 + i * 8, base - h * .3 + i * 12, 30, 2); }
  c.globalAlpha = 1;
  // 海と映り込み
  c.fillStyle = lin(c, 0, base, 0, y + h, ['#0a1430', '#03060f']); c.fillRect(x, base, w, y + h - base);
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i++) {
    const rx = x + rnd() * w, ry = base + 6 + rnd() * (y + h - base - 10), rw = 10 + rnd() * 40;
    c.fillStyle = rnd() < .5 ? `rgba(255,217,138,${.12 + rnd() * .2})` : `rgba(127,211,255,${.1 + rnd() * .2})`;
    c.fillRect(rx, ry, rw, 2);
  }
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(x, base, w, 1.5);
  c.restore();
}

// ホロ加工（虹色の斜めの帯＋きらめき）。枠とイラストは強く、文字の欄はうっすら
function holoFill(c, x, y, w, h, R) {
  const g = c.createLinearGradient(x, y, x + w, y + h);
  const hues = R.code === 'R' ? [200, 220, 190, 230] : R.code === 'SR' ? [40, 55, 30, 50] : [330, 45, 150, 200, 270, 330];
  for (let i = 0; i <= 24; i++) g.addColorStop(i / 24, `hsl(${hues[i % hues.length]} 100% ${i % 2 ? 75 : 45}%)`);
  return g;
}
function drawHolo(c, W, H, P, art, R, rnd) {
  if (!R.holo) return;
  const g = holoFill(c, 0, 0, W, H, R);
  c.save(); c.globalCompositeOperation = 'soft-light'; c.fillStyle = g;
  // 枠
  c.beginPath(); c.roundRect(0, 0, W, H, 46); c.roundRect(P, P, W - P * 2, H - P * 2, 28);
  c.globalAlpha = R.holo; c.fill('evenodd');
  // イラスト
  c.globalAlpha = R.holo * .55; rr(c, art.x, art.y, art.w, art.h, 18); c.fill();
  // 文字の欄
  c.globalAlpha = R.holo * .08; rr(c, P, P, W - P * 2, H - P * 2, 28); c.fill();
  c.globalCompositeOperation = 'lighter'; c.globalAlpha = 1;
  for (let i = 0; i < 6 + R.stars * 6; i++) {
    const onFrame = rnd() < .6, sx = rnd() * W, sy = rnd() * H;
    if (onFrame) sparkle(c, sx < W / 2 ? P / 2 + rnd() * 4 : W - P / 2 - rnd() * 4, sy, 4 + rnd() * 6, `rgba(255,255,255,${.4 + rnd() * .5})`);
    else sparkle(c, art.x + rnd() * art.w, art.y + rnd() * art.h * .6, 3 + rnd() * 6, `rgba(255,255,255,${.3 + rnd() * .5})`);
  }
  c.restore();
}

function tcgDate() { const d = new Date(); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; }
async function loadCardFonts() {
  await Promise.all(['900 40px Outfit', '800 40px Outfit', '600 40px Outfit', '900 40px "Zen Kaku Gothic New"', '700 40px "Zen Kaku Gothic New"', '500 40px "Zen Kaku Gothic New"']
    .map(f => document.fonts.load(f, 'MMみなとみらい認定証0123★').catch(() => null)));
}

// カードのおもて面
function drawCardFront() {
  const cv = document.createElement('canvas'); cv.width = TCG_W; cv.height = TCG_H;
  const c = cv.getContext('2d');
  const total = G.total, rk = rankOf(total), R = rarityOf(rk), clear = total >= CLEAR_SCORE;
  const rnd = seeded(total * 7 + rk.letter.charCodeAt(0));
  const W = TCG_W, H = TCG_H, P = 30;
  // 外枠（金属）
  rr(c, 0, 0, W, H, 46); c.fillStyle = metal(c, 0, 0, W, H, R.frame); c.fill();
  c.save(); rr(c, 0, 0, W, H, 46); c.clip(); c.globalCompositeOperation = 'overlay';
  for (let i = -H; i < W; i += 26) { c.strokeStyle = i % 52 ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.15)'; c.lineWidth = 9; c.beginPath(); c.moveTo(i, 0); c.lineTo(i + H, H); c.stroke(); }
  c.restore();
  // 内側のパネル
  rr(c, P, P, W - P * 2, H - P * 2, 28); c.fillStyle = lin(c, 0, P, 0, H - P, R.panel); c.fill();
  c.save(); rr(c, P, P, W - P * 2, H - P * 2, 28); c.clip(); c.strokeStyle = 'rgba(255,255,255,.025)'; c.lineWidth = 2;
  for (let i = -H; i < W; i += 14) { c.beginPath(); c.moveTo(i, P); c.lineTo(i + H, H); c.stroke(); }
  c.restore();
  c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 3; rr(c, P, P, W - P * 2, H - P * 2, 28); c.stroke();
  const L = P + 26, Rt = W - P - 26, IW = Rt - L;
  // 見出し：レベル・称号・スコア
  rr(c, L, 52, 112, 54, 27); c.fillStyle = lin(c, L, 52, L + 112, 106, [R.frame[0], R.frame[2]]); c.fill();
  c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2; c.stroke();
  c.fillStyle = R.ink; c.font = `900 30px ${EN}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(`Lv.${rk.lv}`, L + 56, 80);
  c.textAlign = 'right'; c.textBaseline = 'alphabetic';
  c.font = `700 15px ${EN}`; c.fillStyle = 'rgba(255,255,255,.6)'; c.fillText('SCORE', Rt, 66);
  c.font = `900 44px ${EN}`; c.fillStyle = R.accent; c.fillText(total.toLocaleString(), Rt, 108);
  const scoreW = c.measureText(total.toLocaleString()).width;
  const tx = L + 128, tw = Rt - scoreW - 24 - tx;
  const ts = fitFont(c, rk.title, 900, JP, 46, tw, 24);
  c.textAlign = 'left'; c.fillStyle = '#ffffff'; c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 6; c.fillText(rk.title, tx, 80 + ts * .36); c.shadowBlur = 0;
  // イラスト
  const ay = 124, ah = 486;
  c.fillStyle = metal(c, L - 8, ay - 8, IW + 16, ah + 16, R.frame); rr(c, L - 8, ay - 8, IW + 16, ah + 16, 24); c.fill();
  drawArt(c, L, ay, IW, ah, R, rnd);
  // ランクの紋章（イラスト右下）
  const ex = Rt - 84, ey = ay + ah - 84;
  c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 24;
  c.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; c.lineTo(ex + Math.cos(a) * 74, ey + Math.sin(a) * 74); } c.closePath();
  c.fillStyle = metal(c, ex - 74, ey - 74, 148, 148, R.frame); c.fill(); c.restore();
  c.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; c.lineTo(ex + Math.cos(a) * 60, ey + Math.sin(a) * 60); } c.closePath();
  c.fillStyle = lin(c, 0, ey - 60, 0, ey + 60, R.panel); c.fill();
  c.fillStyle = R.accent; c.font = `900 84px ${EN}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(rk.letter, ex, ey + 6);
  c.font = `800 13px ${EN}`; c.fillStyle = 'rgba(255,255,255,.75)'; c.fillText('RANK', ex, ey - 40);
  // レア度の帯（イラスト左上）
  c.textAlign = 'left';
  const tag = `${R.code}  ${'★'.repeat(R.stars)}`;
  c.font = `900 22px ${EN}`; const tgw = c.measureText(tag).width + 30;
  rr(c, L + 14, ay + 14, tgw, 40, 20); c.fillStyle = 'rgba(5,8,18,.6)'; c.fill();
  c.strokeStyle = R.accent; c.lineWidth = 2; c.stroke();
  c.fillStyle = R.accent; c.textBaseline = 'middle'; c.fillText(tag, L + 29, ay + 35);
  // 情報の帯
  const by = ay + ah + 18;
  rr(c, L, by, IW, 38, 19); c.fillStyle = 'rgba(0,0,0,.38)'; c.fill();
  c.strokeStyle = metal(c, L, by, IW, 38, R.frame); c.lineWidth = 2; c.stroke();
  const pitari = G.rounds.filter(r => r.guess && r.dist <= PERFECT_M).length;
  c.font = `700 18px ${JP}`; c.fillStyle = 'rgba(255,255,255,.85)'; c.textAlign = 'center';
  c.fillText(`${THEMES[G.theme].name}・${G.useSV ? 'ストリートビュー' : '写真'}　｜　${tcgDate()}`, W / 2, by + 20);
  // 5問（わざの欄のように並べる）
  let y = by + 54; const rh = 60;
  G.rounds.forEach((r, i) => {
    const cls = r.guess ? gradeOf(r.dist).cls : 'g-e', cyy = y + rh / 2;
    c.fillStyle = GRADE_COLOR[cls]; c.beginPath(); c.arc(L + 24, cyy, 22, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 2.5; c.stroke();
    c.fillStyle = '#10182a'; c.font = `900 24px ${EN}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), L + 24, cyy + 1);
    c.textAlign = 'right'; c.textBaseline = 'alphabetic';
    c.font = `600 16px ${EN}`; c.fillStyle = 'rgba(255,255,255,.5)'; c.fillText('pt', Rt, cyy + 13);
    c.font = `900 36px ${EN}`; c.fillStyle = '#ffffff'; c.fillText(r.score.toLocaleString(), Rt - 22, cyy + 13);
    c.textAlign = 'left';
    c.font = `900 27px ${JP}`; c.fillStyle = '#ffffff'; c.fillText(clip(c, r.spot.name, IW - 64 - 150), L + 60, cyy - 2);
    c.font = `500 17px ${JP}`; c.fillStyle = 'rgba(255,255,255,.6)';
    c.fillText(r.guess ? `${gradeOf(r.dist).name}　${fmtDist(r.dist).join('')}` : '時間切れ', L + 60, cyy + 22);
    if (i < 4) { c.fillStyle = 'rgba(255,255,255,.1)'; c.fillRect(L, y + rh, IW, 1.5); }
    y += rh;
  });
  // ステータス3つ
  y += 10;
  const dexN = Object.keys(getDex()).filter(k => SPOTS[k]).length, bw = (IW - 24) / 3;
  [['クリア', clear ? 'CLEAR' : `あと${(CLEAR_SCORE - total).toLocaleString()}`, clear ? '#4fe3a3' : '#ffffff'],
   ['ピタリ', `${pitari} / 5`, '#ffd25e'],
   ['図鑑', `${dexN} / ${window.MM_SPOTS.length}`, '#6fd0ff']].forEach(([k, v, col], i) => {
    const bx = L + i * (bw + 12);
    rr(c, bx, y, bw, 48, 12); c.fillStyle = 'rgba(0,0,0,.32)'; c.fill();
    c.textBaseline = 'middle'; c.textAlign = 'left'; c.font = `700 16px ${JP}`; c.fillStyle = 'rgba(255,255,255,.55)'; c.fillText(k, bx + 14, y + 25);
    c.textAlign = 'right'; c.font = `900 ${fitFont(c, v, 900, EN, 24, bw - 80, 14)}px ${EN}`; c.fillStyle = col; c.fillText(v, bx + bw - 14, y + 25);
  });
  // ひとこと（フレーバーテキスト）
  y += 62;
  const fh = H - P - 64 - y;
  rr(c, L, y, IW, fh, 14); c.fillStyle = 'rgba(255,255,255,.05)'; c.fill(); c.strokeStyle = R.accent; c.globalAlpha = .45; c.lineWidth = 1.5; c.stroke(); c.globalAlpha = 1;
  c.font = `500 22px ${JP}`; c.fillStyle = 'rgba(255,255,255,.85)'; c.textAlign = 'left'; c.textBaseline = 'middle';
  const lines = wrapLines(c, rk.msg, IW - 40, 2);
  lines.forEach((ln, i) => c.fillText(ln, L + 20, y + fh / 2 + (i - (lines.length - 1) / 2) * 32));
  // フッター
  const fy = H - P - 30;
  c.font = `800 17px ${EN}`; c.fillStyle = R.accent; c.textAlign = 'left'; c.fillText(CONFIG.appName, L, fy);
  const an = c.measureText(CONFIG.appName).width;
  c.font = `500 15px ${JP}`; c.fillStyle = 'rgba(255,255,255,.5)'; c.fillText('みなとみらい認定カード', L + an + 14, fy);
  c.textAlign = 'right'; c.font = `800 17px ${EN}`; c.fillStyle = R.accent; c.fillText(`${R.code} ${'★'.repeat(R.stars)}`, Rt, fy);
  // ホロ（UR は枠ごと、ほかはカード全体にうっすら）
  drawHolo(c, W, H, P, { x: L, y: ay, w: IW, h: ah }, R, rnd);
  if (R.legend) {
    c.save(); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `900 15px ${EN}`; c.fillStyle = R.ink;
    c.fillText('L E G E N D', W / 2, 15); c.restore();
  }
  return cv;
}

// カードのうら面（どのランクでも共通）
function drawCardBack() {
  const cv = document.createElement('canvas'); cv.width = TCG_W; cv.height = TCG_H;
  const c = cv.getContext('2d'), W = TCG_W, H = TCG_H;
  rr(c, 0, 0, W, H, 46); c.fillStyle = metal(c, 0, 0, W, H, ['#13284d', '#0a1730', '#1c3a6a', '#0a1730']); c.fill();
  rr(c, 30, 30, W - 60, H - 60, 28); c.fillStyle = lin(c, 0, 30, 0, H - 30, ['#0d2347', '#071228', '#0d2347']); c.fill();
  c.strokeStyle = 'rgba(255,210,94,.7)'; c.lineWidth = 3; c.stroke();
  c.save(); rr(c, 30, 30, W - 60, H - 60, 28); c.clip();
  // 波の模様
  c.strokeStyle = 'rgba(63,216,255,.09)'; c.lineWidth = 2;
  for (let yy = 40; yy < H; yy += 22) { c.beginPath(); for (let xx = 0; xx <= W; xx += 10) c.lineTo(xx, yy + Math.sin(xx / 38 + yy / 50) * 6); c.stroke(); }
  const cx = W / 2, cy = H / 2;
  const glow = c.createRadialGradient(cx, cy, 0, cx, cy, 420); glow.addColorStop(0, 'rgba(255,77,126,.35)'); glow.addColorStop(1, 'rgba(255,77,126,0)');
  c.fillStyle = glow; c.fillRect(0, 0, W, H);
  // 羅針盤
  [300, 262, 200].forEach((r, i) => { c.strokeStyle = i === 1 ? 'rgba(255,210,94,.75)' : 'rgba(255,210,94,.3)'; c.lineWidth = i === 1 ? 3 : 1.5; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke(); });
  for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2, l = i % 9 ? 8 : 20; c.strokeStyle = 'rgba(255,210,94,.55)'; c.lineWidth = 2; c.beginPath(); c.moveTo(cx + Math.cos(a) * 262, cy + Math.sin(a) * 262); c.lineTo(cx + Math.cos(a) * (262 - l), cy + Math.sin(a) * (262 - l)); c.stroke(); }
  [[0, 330], [Math.PI / 2, 250], [Math.PI, 250], [Math.PI * 1.5, 330]].forEach(([a, l]) => {
    c.fillStyle = 'rgba(255,210,94,.16)'; c.beginPath(); c.moveTo(cx + Math.cos(a - Math.PI / 2) * l, cy + Math.sin(a - Math.PI / 2) * l);
    c.lineTo(cx + Math.cos(a - Math.PI / 2 + .12) * 60, cy + Math.sin(a - Math.PI / 2 + .12) * 60); c.lineTo(cx, cy); c.lineTo(cx + Math.cos(a - Math.PI / 2 - .12) * 60, cy + Math.sin(a - Math.PI / 2 - .12) * 60); c.closePath(); c.fill();
  });
  // 円周の文字
  const ring = '★ MINATO MIRAI 21 ★ YOKOHAMA ★ MINATO MIRAI 21 ★ YOKOHAMA ';
  c.font = `800 22px ${EN}`; c.fillStyle = 'rgba(255,210,94,.8)'; c.textAlign = 'center'; c.textBaseline = 'middle';
  [...ring].forEach((ch, i) => { const a = i / ring.length * Math.PI * 2 - Math.PI / 2; c.save(); c.translate(cx + Math.cos(a) * 282, cy + Math.sin(a) * 282); c.rotate(a + Math.PI / 2); c.fillText(ch, 0, 0); c.restore(); });
  // ロゴ
  const lf = fitFont(c, CONFIG.appName, 900, EN, 110, 520, 40);
  c.fillStyle = lin(c, cx - 260, 0, cx + 260, 0, ['#ff4d7e', '#ff8a5b', '#ffd25e']); c.shadowColor = 'rgba(255,77,126,.6)'; c.shadowBlur = 30;
  c.fillText(CONFIG.appName, cx, cy - 8); c.shadowBlur = 0;
  c.font = `700 24px ${JP}`; c.fillStyle = 'rgba(255,255,255,.8)'; c.fillText('みなとみらい認定カード', cx, cy + lf * .55 + 6);
  c.restore();
  return cv;
}

// 保存・シェア用：カードを台紙（1080×1350）に載せる
function drawStage(front) {
  const cv = document.createElement('canvas'); cv.width = STAGE_W; cv.height = STAGE_H;
  const c = cv.getContext('2d'), rk = rankOf(G.total), R = rarityOf(rk), rnd = seeded(G.total + 99);
  c.fillStyle = lin(c, 0, 0, 0, STAGE_H, ['#0b1730', '#04080f']); c.fillRect(0, 0, STAGE_W, STAGE_H);
  const cx = STAGE_W / 2, cy = 600;
  // 後光（SR 以上）
  if (R.stars >= 3) {
    c.save(); c.translate(cx, cy); c.globalCompositeOperation = 'lighter';
    const n = R.legend ? 28 : 20;
    for (let i = 0; i < n; i++) {
      c.rotate(Math.PI * 2 / n); c.fillStyle = i % 2 ? `${R.accent}14` : `${R.accent}08`;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(-90, -1100); c.lineTo(90, -1100); c.closePath(); c.fill();
    }
    c.restore();
  }
  const gl = c.createRadialGradient(cx, cy, 0, cx, cy, 640); gl.addColorStop(0, `${R.accent}55`); gl.addColorStop(1, `${R.accent}00`);
  c.fillStyle = gl; c.fillRect(0, 0, STAGE_W, STAGE_H);
  for (let i = 0; i < 10 + R.stars * 10; i++) sparkle(c, rnd() * STAGE_W, rnd() * STAGE_H, 3 + rnd() * 9, `rgba(255,255,255,${.2 + rnd() * .5})`);
  // カード（少し傾けて影をつける）
  const s = .88, cw = TCG_W * s, ch = TCG_H * s;
  c.save(); c.translate(cx, 52 + ch / 2); c.rotate(-1.5 * Math.PI / 180);
  c.shadowColor = 'rgba(0,0,0,.65)'; c.shadowBlur = 60; c.shadowOffsetY = 28;
  c.drawImage(front, -cw / 2, -ch / 2, cw, ch);
  c.restore();
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.font = `900 34px ${JP}`; c.fillStyle = '#ffffff'; c.fillText('あなたは何ランク？', cx, 1258);
  c.font = `600 24px ${EN}`; c.fillStyle = '#3fd8ff'; c.fillText(shareUrl(), cx, 1300);
  return cv;
}

let cardBlob = null, cardBusy = false;
const toBlob = cv => new Promise(res => cv.toBlob(res, 'image/png'));
async function openCard() {
  if (!G || cardBusy) return;
  cardBusy = true; cardBlob = null;
  const tcg = $('tcg'), m = $('cardModal'), R = rarityOf(rankOf(G.total));
  tcg.classList.remove('flipped'); tcg.dataset.r = R.code; tcg.style.setProperty('--accent', R.accent);
  m.classList.add('busy'); openModal('cardModal');
  await loadCardFonts();
  const front = drawCardFront(), back = drawCardBack();
  $('cardBack').src = back.toDataURL('image/png');
  const fb = await toBlob(front);
  const img = $('cardImg');
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  img.dataset.url = URL.createObjectURL(fb); img.src = img.dataset.url;
  await img.decode().catch(() => null);
  m.classList.remove('busy');
  $('cardRarity').textContent = `${R.code}（${R.name}）`;
  // うら → おもてにめくる
  setTimeout(() => {
    tcg.classList.add('flipped'); Snd.stamp();
    if (R.stars >= 3) setTimeout(() => Snd.great(), 350);
    if (R.stars >= 4) setTimeout(() => Confetti.burst(R.legend ? 320 : 200), 450);
  }, 500);
  cardBlob = await toBlob(drawStage(front));
  const file = new File([cardBlob], 'mm-guessr.png', { type: 'image/png' });
  $('cardShare').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  cardBusy = false;
}
function cardFileName() {
  const d = new Date(); return `mm-guessr_${rankOf(G.total).letter}_${G.total}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.png`;
}
$('cardSave').addEventListener('click', () => {
  if (!cardBlob) return;
  Snd.click();
  const u = URL.createObjectURL(cardBlob);
  const a = document.createElement('a'); a.href = u; a.download = cardFileName(); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
  toast('画像を保存しました');
});
$('cardShare').addEventListener('click', async () => {
  if (!cardBlob) return;
  Snd.click();
  const file = new File([cardBlob], cardFileName(), { type: 'image/png' });
  try { await navigator.share({ files: [file], text: shareText() + '\nhttps://' + shareUrl() + '/' }); }
  catch (e) { if (e.name !== 'AbortError') toast('共有できませんでした。保存してから送ってください'); }
});
// カードを傾けるとホロが動く
(() => {
  const st = $('tcgStage'), tcg = $('tcg');
  const move = e => {
    const b = tcg.getBoundingClientRect(), px = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), py = Math.min(1, Math.max(0, (e.clientY - b.top) / b.height));
    tcg.style.setProperty('--ry', ((px - .5) * 26).toFixed(1) + 'deg'); tcg.style.setProperty('--rx', ((.5 - py) * 22).toFixed(1) + 'deg');
    tcg.style.setProperty('--mx', (px * 100).toFixed(1) + '%'); tcg.style.setProperty('--my', (py * 100).toFixed(1) + '%');
    tcg.classList.add('active');
  };
  st.addEventListener('pointermove', move);
  st.addEventListener('pointerdown', move);
  st.addEventListener('pointerleave', () => { tcg.classList.remove('active'); ['--rx', '--ry'].forEach(k => tcg.style.setProperty(k, '0deg')); });
})();

// ===================== 画面切り替え・タイトル =====================
function setPhase(p) {
  body.classList.remove('phase-title', 'phase-game', 'phase-final', 'revealing', 'card-in', 'map-open', 'sv', 'sv-move', 'nmpz');
  body.classList.add('phase-' + p);
  if (p === 'title') { Bokeh.start(); TitleBg.start(); updateBest(); updateDexCount(); } else TitleBg.stop();
  if (p !== 'game') { clearInterval(timerId); View3D.close(); }
}
function updateBest() {
  document.querySelectorAll('.theme').forEach(b => {
    const v = store.get('best2.' + b.dataset.theme, 0);
    const rk = store.get('rank.' + b.dataset.theme, '');
    b.querySelector('.t-best').textContent = v ? `ベスト ${v.toLocaleString()}${rk ? '・' + rk + 'ランク' : ''}${v >= CLEAR_SCORE ? '・クリア済み' : ''}` : '';
  });
  $('randomDesc').innerHTML = apiKey() ? 'ストリートビューで<br>街のどこかへ。上級者向け' : 'すべての写真から出題。<br>上級者向け';
}
const TitleBg = (() => {
  const box = $('titleBg'); let t = null, idx = 0;
  const list = shuffle(PHOTOS.filter(p => p.diff === 1));
  const imgs = [document.createElement('img'), document.createElement('img')];
  imgs.forEach(i => { i.alt = ''; box.append(i); });
  function next() {
    const img = imgs[idx % 2], other = imgs[(idx + 1) % 2];
    img.src = list[idx % list.length].src;
    img.onload = () => { img.classList.remove('show'); void img.offsetWidth; img.classList.add('show'); other.classList.remove('show'); };
    idx++;
  }
  return {
    start() { if (t) return; next(); t = setInterval(next, 6500); },
    stop() { clearInterval(t); t = null; },
  };
})();
function splitLogo() {
  const el = $('logo'), txt = el.textContent; el.textContent = '';
  [...txt].forEach((ch, i) => {
    const s = document.createElement('span');
    if (ch === ' ') { s.className = 'sp'; }
    else { s.className = 'ch'; s.textContent = ch; s.style.animationDelay = (.15 + i * .06) + 's'; }
    el.append(s);
  });
  el.classList.add('logo-glow');
}
function bindSeg(id, key, cast = v => v) {
  const seg = $(id);
  seg.querySelectorAll('button').forEach(b => {
    const on = String(settings[key]) === b.dataset.v;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
    b.addEventListener('click', () => {
      Snd.init(); Snd.click();
      settings[key] = cast(b.dataset.v); store.set(key, settings[key]);
      seg.querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    });
  });
}

// ===================== モーダル =====================
function openModal(id) { $(id).hidden = false; }
function closeModal(el) { el.hidden = true; }
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) { closeModal(m); Snd.click(); } });
});
function openSettings() {
  $('setSound').checked = settings.sound;
  $('setKey').value = settings.key;
  $('svStatus').textContent = settings.key ? 'キー設定済み：Google マップとストリートビューで遊びます'
    : CONFIG.googleMapsKey ? '公開用のキーが設定済みです（自分のキーを入れるとそちらを使います）' : 'キー未設定：写真と国土地理院の地図で遊びます';
  $('moveRow').hidden = !apiKey();
  document.querySelector('#settingsModal .sv').hidden = !!CONFIG.googleMapsKey; // 公開版ではキー入力欄を出さない
  openModal('settingsModal');
}
$('saveSettings').addEventListener('click', () => {
  settings.sound = $('setSound').checked; store.set('sound', settings.sound);
  const k = $('setKey').value.trim();
  if (k !== settings.key) { settings.key = k; store.set('key', k); if (k) toast('保存しました。ページを再読み込みすると確実に反映されます', 3600); }
  syncMute(); updateBest(); closeModal($('settingsModal')); Snd.init(); Snd.click();
});
function syncMute() { $('muteBtn').classList.toggle('off', !settings.sound); }

// ===================== 操作の割り当て =====================
document.querySelectorAll('.theme').forEach(b => b.addEventListener('click', () => startGame(b.dataset.theme)));
$('againBtn').addEventListener('click', () => startGame(G ? G.theme : lastTheme));
$('homeBtn').addEventListener('click', () => { Snd.click(); setPhase('title'); });
$('shareBtn').addEventListener('click', () => { Snd.click(); openCard(); });
$('cardCopy').addEventListener('click', copyShare);
$('rulesBtn').addEventListener('click', openRules);
$('rulesBtn2').addEventListener('click', openRules);
$('dexBtn').addEventListener('click', () => { Snd.init(); Snd.click(); openDex(); });
$('settingsBtn').addEventListener('click', () => { Snd.init(); Snd.click(); openSettings(); });
$('guessBtn').addEventListener('click', () => submitGuess());
$('nextBtn').addEventListener('click', nextRound);
$('hintBtn').addEventListener('click', useHint);
$('backBtn').addEventListener('click', () => { Snd.click(); SV.backToStart(); });
$('lookBtn').addEventListener('click', async () => {
  if (!G) return;
  const r = G.rounds[G.i];
  Snd.click(); openModal('lookModal');
  $('lookCap').textContent = r.spot.name + (r.random ? ' の近く（正解地点）' : '（正解地点）');
  const ok = await SV.look(r.answer);
  if (!ok) { closeModal($('lookModal')); toast('この地点のストリートビューはありませんでした'); }
});
$('muteBtn').addEventListener('click', () => { settings.sound = !settings.sound; store.set('sound', settings.sound); syncMute(); Snd.init(); Snd.click(); });
$('quitBtn').addEventListener('click', () => {
  if (confirm('タイトルにもどりますか？（このゲームの点数は残りません）')) { G = null; setPhase('title'); }
});
addEventListener('keydown', e => {
  if (e.target.matches('input,textarea')) return;
  const modal = document.querySelector('.modal:not([hidden])');
  if (e.key === 'Escape' && modal) return closeModal(modal);
  if (e.key === 'Escape' && View3D.isOpen) return View3D.close();
  if (modal) return;
  if (body.classList.contains('phase-game')) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (body.classList.contains('card-in')) nextRound(); else submitGuess();
    } else if (e.key === 'm' || e.key === 'M') { if (!isMobile() && !body.classList.contains('revealing')) { dock.classList.toggle('big'); refreshMap(380); } }
    else if (e.key === 'h' || e.key === 'H') useHint();
    else if ((e.key === 't' || e.key === 'T') && !body.classList.contains('revealing')) View3D.isOpen ? View3D.close() : View3D.open();
    else if ((e.key === 'r' || e.key === 'R') && body.classList.contains('sv-move') && G && !G.locked) SV.backToStart();
  }
});

// ===================== 起動 =====================
// 動作確認用（コンソールから __mmg.G や __mmg.map を見られる）
window.__mmg = { get G() { return G; }, map, SV, Seen, guess: (lat, lng) => placeGuess({ lat, lng }), card: { drawCardFront, drawCardBack, drawStage } };
document.title = `${CONFIG.appName}｜みなとみらいジオゲッサー`;
$('logo').textContent = CONFIG.appName; $('logo').setAttribute('aria-label', CONFIG.appName);
splitLogo();
if (apiKey()) MMMap.loadGoogle(apiKey()).then(() => MMMap.upgradeAll()).catch(() => {});
bindSeg('timeSeg', 'time', Number);
bindSeg('moveSeg', 'move');
syncMute();
setPhase('title');
})();
