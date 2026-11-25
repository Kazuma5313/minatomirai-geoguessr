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
const RANKS = [
  [22000, 'みなとみらいの主（ぬし）', '地図を見なくても歩けるレベル。今度は友だちの案内役をお願いします。'],
  [17000, 'ベイエリア通', 'かなり詳しい！ 次は全問5000点を狙ってみてください。'],
  [12000, 'MM散歩 上級者', '主要スポットはばっちり。少し奥の公園や橋にも行ってみよう。'],
  [7000,  '週末みなとみらい民', 'だいたいの方向はつかめています。図鑑を埋めながら覚えていこう。'],
  [0,     'はじめてのみなとみらい', 'ここから覚えればOK。図鑑のスポットを実際に歩いてみてください。'],
];

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
// 15m以内は満点。そこから250mごとに約1/e。みなとみらい（約2km四方）の広さに合わせた曲線。
function scoreOf(d) { return d <= 15 ? MAXP : Math.round(MAXP * Math.exp(-(d - 15) / 250)); }
function rating(score, guessed) {
  if (!guessed) return '時間切れ…';
  if (score >= 4800) return 'PERFECT!!';
  if (score >= 4000) return 'すばらしい！';
  if (score >= 2800) return 'いい線いってる';
  if (score >= 1500) return 'おしい！';
  if (score >= 500) return 'まだまだ';
  return '迷子かも…';
}
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

// 出題を5つ選ぶ。同じスポットは1ゲーム1回まで。やさしい問題から順に並べる
function pickRounds(theme, useSV) {
  if (useSV && theme !== 'random') {
    // ストリートビュー：テーマのスポットから選び、その近くの景色で出題（写真がない企業も出せる）
    return shuffle(window.MM_SPOTS.filter(s => inTheme(s, theme))).slice(0, ROUNDS)
      .sort((a, b) => spotDiff(a.id) - spotDiff(b.id))
      .map(s => { const ph = closestPhotoOf(s.id, s) || null; return { spot: s, photo: ph, base: ph, answer: { lat: s.lat, lng: s.lng }, spotMode: true }; });
  }
  const pick = [], used = new Set();
  for (const p of shuffle(PHOTOS.filter(p => inTheme(SPOTS[p.spot], theme)))) {
    if (pick.length >= ROUNDS) break;
    if (!used.has(p.spot)) { used.add(p.spot); pick.push(p); }
  }
  return pick.sort((a, b) => a.diff - b.diff)
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
    } else sv = await SV.find(r.answer);
  }
  if (G !== game) return;
  body.classList.toggle('nmpz', !!sv && G.move === 'nmpz');
  body.classList.toggle('sv-move', !!sv && G.move === 'move');
  if (sv) { r.sv = sv; r.answer = { lat: sv.lat, lng: sv.lng }; body.classList.add('sv'); SV.show(sv.pano, G.move); }
  else { body.classList.remove('sv'); if (r.random || r.spotMode) resetToPhoto(r); await ensurePhoto(r); }
  if (G !== game) return;
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
  const rt = $('rvRating'); rt.textContent = rating(r.score, !!r.guess); rt.classList.remove('pop'); void rt.offsetWidth; rt.classList.add('pop');
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
  const total = G.total, bk = 'best.' + G.theme, best = store.get(bk, 0), isBest = total > best;
  if (isBest) store.set(bk, total);
  const rk = RANKS.find(r => total >= r[0]);
  $('finalRank').innerHTML = ''; $('finalRank').append(rk[1]);
  const sm = document.createElement('small'); sm.textContent = rk[2]; $('finalRank').append(sm);
  const tn = THEMES[G.theme].name;
  $('finalBest').textContent = isBest ? (best ? `「${tn}」自己ベスト更新！（前回 ${best.toLocaleString()}）` : `「${tn}」はじめての記録！`) : `「${tn}」自己ベスト ${best.toLocaleString()}`;
  updateBest();

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
  if (total >= 17000) { Snd.great(); Confetti.burst(260); } else Snd.good();
}

function shareText() {
  const sq = s => s >= 4000 ? '🟩' : s >= 2000 ? '🟨' : s >= 500 ? '🟧' : '🟥';
  const rk = RANKS.find(r => G.total >= r[0])[1];
  const mode = THEMES[G.theme].name + (G.useSV ? `・ストリートビュー（${MOVE_LABEL[G.move]}）` : '・写真');
  return `${CONFIG.appName} みなとみらいジオゲッサー（${mode}）\n${G.total.toLocaleString()} / 25,000点「${rk}」\n${G.rounds.map(r => sq(r.score)).join('')}`;
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

// ===================== 画面切り替え・タイトル =====================
function setPhase(p) {
  body.classList.remove('phase-title', 'phase-game', 'phase-final', 'revealing', 'card-in', 'map-open', 'sv', 'sv-move', 'nmpz');
  body.classList.add('phase-' + p);
  if (p === 'title') { Bokeh.start(); TitleBg.start(); updateBest(); updateDexCount(); } else TitleBg.stop();
  if (p !== 'game') { clearInterval(timerId); View3D.close(); }
}
function updateBest() {
  document.querySelectorAll('.theme').forEach(b => {
    const v = store.get('best.' + b.dataset.theme, 0);
    b.querySelector('.t-best').textContent = v ? `ベスト ${v.toLocaleString()}` : '';
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
$('shareBtn').addEventListener('click', copyShare);
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
window.__mmg = { get G() { return G; }, map, SV, guess: (lat, lng) => placeGuess({ lat, lng }) };
document.title = `${CONFIG.appName}｜みなとみらいジオゲッサー`;
$('logo').textContent = CONFIG.appName; $('logo').setAttribute('aria-label', CONFIG.appName);
splitLogo();
if (apiKey()) MMMap.loadGoogle(apiKey()).then(() => MMMap.upgradeAll()).catch(() => {});
bindSeg('timeSeg', 'time', Number);
bindSeg('moveSeg', 'move');
syncMute();
setPhase('title');
})();
