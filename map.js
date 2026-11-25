/* 地図の共通部品。Google マップ（APIキーがあるとき）と 国土地理院＋Leaflet（キーなし）を同じ使い方で扱う。
 * MMMap.create(el, opts) が返す地図は、使うエンジンが変わったら ensure() で作り直せる。
 */
window.MMMap = (() => {
'use strict';

// 国土地理院の淡色地図（APIキー不要・出典表示が条件）
const TILE = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
const ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';
// Google マップ：お店のアイコンは消し、名所・駅・公園は残す（街を覚える手がかりにする）
const GSTYLE = [
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.medical', stylers: [{ visibility: 'off' }] },
];
const C = { reveal: '#13233f', glow: '#ff4d7e', link: '#ff8a5b', final: '#ff4d7e', hint: '#3fd8ff' };

let engine = 'leaflet';
let gReady = null;
const all = [];

function pinHtml(kind, { num = '', ripple = false, drop = true } = {}) {
  return `<div class="pin ${kind}${drop ? ' drop' : ''}">${ripple ? '<i class="ripple"></i>' : ''}<i class="shadow"></i><i class="head"></i>${num ? `<b class="flag-num">${num}</b>` : '<i class="dot"></i>'}</div>`;
}
const STAR = '<i class="spot-star"></i>';
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const reduced = matchMedia('(prefers-reduced-motion:reduce)').matches;

// ---------- Google マップの読み込み ----------
// Firebase App Check：config.js に設定があるときだけ有効。キーが他サイトにコピーされても、
// このサイトで発行されたトークンがないリクエストは Google 側で拒否される（強制を ON にしたあと）。
async function setupAppCheck() {
  const cfg = window.MM_CONFIG || {};
  if (!cfg.firebaseConfig || !cfg.appCheckSiteKey) return;
  const V = '10.12.2';
  const [{ initializeApp }, ac] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app-check.js`),
  ]);
  const { Settings } = await google.maps.importLibrary('core');
  const Provider = cfg.appCheckProvider === 'enterprise' ? ac.ReCaptchaEnterpriseProvider : ac.ReCaptchaV3Provider;
  const appCheck = ac.initializeAppCheck(initializeApp(cfg.firebaseConfig), { provider: new Provider(cfg.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  Settings.getInstance().fetchAppCheckToken = () => ac.getToken(appCheck, false);
}
function loadGoogle(key) {
  if (gReady) return gReady;
  gReady = new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('timeout')), 12000);
    window.__mmgInit = async () => {
      clearTimeout(timer);
      try {
        await setupAppCheck(); // 地図を作る前に App Check を有効にする
        await google.maps.importLibrary('maps');
        await google.maps.importLibrary('streetView');
        res();
      } catch (e) { rej(e); }
    };
    const s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&loading=async&callback=__mmgInit&v=weekly&language=ja&region=JP';
    s.async = true; s.onerror = () => { clearTimeout(timer); rej(new Error('load')); };
    document.head.appendChild(s);
  });
  gReady.then(() => { if (engine !== 'broken') engine = 'google'; }, () => { gReady = null; });
  return gReady;
}

// ---------- Leaflet（国土地理院） ----------
function leafletImpl(el, o) {
  const m = L.map(el, {
    zoomControl: false, minZoom: o.minZoom, maxZoom: Math.min(o.maxZoom, 18), zoomSnap: .25,
    maxBounds: o.bounds ? L.latLngBounds(o.bounds).pad(.5) : undefined, maxBoundsViscosity: .7,
    scrollWheelZoom: o.wheel !== false,
  }).setView(o.center, o.zoom);
  L.tileLayer(TILE, { attribution: ATTR, maxNativeZoom: 18, maxZoom: 19 }).addTo(m);
  if (o.zoomCtrl) L.control.zoom({ position: 'bottomright' }).addTo(m);
  const layer = L.layerGroup().addTo(m);
  const ll = p => [p.lat, p.lng];
  const icon = (html, size, anchor) => L.divIcon({ className: '', iconSize: size, iconAnchor: anchor, html });
  return {
    kind: 'leaflet',
    onClick(cb) { m.on('click', e => cb({ lat: e.latlng.lat, lng: e.latlng.lng })); },
    setView(p, z) { m.setView(ll(p), z, { animate: false }); },
    resize() { m.invalidateSize({ animate: false }); },
    clear() { layer.clearLayers(); },
    fit(points, { padTL = [30, 30], padBR = [30, 30], maxZoom = 16.5, animate = true } = {}) {
      const b = L.latLngBounds(points.map(ll)), opt = { paddingTopLeft: padTL, paddingBottomRight: padBR, maxZoom: Math.min(maxZoom, 16.5) };
      animate && !reduced ? m.flyToBounds(b, { ...opt, duration: 1.1 }) : m.fitBounds(b, { ...opt, animate: false });
    },
    flyTo(p, z, animate = true) { animate && !reduced ? m.flyTo(ll(p), Math.min(z, 16), { duration: 1.1 }) : m.setView(ll(p), Math.min(z, 16), { animate: false }); },
    pin(p, { kind = 'answer', num = '', ripple = false, label = '', labelCls = '', z = 0 } = {}) {
      const mk = L.marker(ll(p), { icon: icon(pinHtml(kind, { num, ripple }), [34, 44], [17, 42]), keyboard: false, interactive: false, zIndexOffset: z }).addTo(layer);
      if (label) mk.bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -46], className: 'dist-label ' + labelCls });
      return { setPos(q) { mk.setLatLng(ll(q)); }, remove() { layer.removeLayer(mk); } };
    },
    star(p, label) {
      L.marker(ll(p), { icon: icon(STAR, [18, 18], [9, 9]), keyboard: false, interactive: false }).addTo(layer)
        .bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -10], className: 'dist-label spot-label' });
    },
    line(a, b, style) {
      if (style === 'reveal') {
        L.polyline([ll(a), ll(b)], { color: C.glow, weight: 12, opacity: .3, interactive: false }).addTo(layer);
        const ln = L.polyline([ll(a), ll(b)], { color: C.reveal, weight: 4, opacity: .95, interactive: false }).addTo(layer);
        return {
          async draw() {
            const path = ln.getElement();
            if (!path || reduced) return;
            const len = path.getTotalLength();
            path.style.strokeDasharray = len; path.style.strokeDashoffset = len; path.getBoundingClientRect();
            path.style.transition = 'stroke-dashoffset .85s cubic-bezier(.6,0,.2,1)'; path.style.strokeDashoffset = 0;
            await new Promise(r => setTimeout(r, 870));
            path.style.transition = ''; path.style.strokeDasharray = '2 10';
          },
          label(t) { ln.bindTooltip(t, { permanent: true, direction: 'center', className: 'dist-label' }).openTooltip(); },
        };
      }
      const st = style === 'link' ? { color: C.link, weight: 2, dashArray: '3 6', opacity: .8 } : { color: C.final, weight: 3, dashArray: '4 7', opacity: .9 };
      L.polyline([ll(a), ll(b)], { ...st, interactive: false }).addTo(layer);
      return { async draw() {}, label() {} };
    },
    circle(c, radius) {
      const ci = L.circle(ll(c), { radius, color: C.hint, weight: 2, dashArray: '6 8', fillColor: C.hint, fillOpacity: .1, interactive: false }).addTo(layer);
      m.invalidateSize({ animate: false });
      m.flyToBounds(ci.getBounds(), { padding: [30, 30], duration: .8 });
    },
    destroy() { m.remove(); },
  };
}

// ---------- Google マップ ----------
function googleImpl(el, o) {
  const g = google.maps;
  // ピンや吹き出しを、Leaflet版と同じHTML・CSSで描くための重ね表示
  class Html extends g.OverlayView {
    constructor(pos, html, anchor, z) {
      super(); this.pos = pos; this.anchor = anchor; this.z = z;
      this.div = document.createElement('div'); this.div.className = 'gm-ov'; this.div.innerHTML = html;
    }
    onAdd() { this.getPanes().floatPane.appendChild(this.div); }
    draw() {
      const p = this.getProjection()?.fromLatLngToDivPixel(new g.LatLng(this.pos.lat, this.pos.lng));
      if (!p) return;
      this.div.style.left = (p.x - this.anchor[0]) + 'px'; this.div.style.top = (p.y - this.anchor[1]) + 'px'; this.div.style.zIndex = this.z;
    }
    onRemove() { this.div.remove(); }
    setPos(pos) { this.pos = pos; this.draw(); }
  }
  const pad = o.bounds ? (() => {
    const [[s, w], [n, e]] = o.bounds, dl = (n - s) * .5, dg = (e - w) * .5;
    return { south: s - dl, west: w - dg, north: n + dl, east: e + dg };
  })() : null;
  const m = new g.Map(el, {
    center: { lat: o.center[0], lng: o.center[1] }, zoom: o.zoom, minZoom: o.minZoom, maxZoom: o.maxZoom,
    disableDefaultUI: true, zoomControl: !!o.zoomCtrl,
    zoomControlOptions: o.zoomCtrl ? { position: g.ControlPosition.RIGHT_BOTTOM } : undefined,
    gestureHandling: o.wheel === false ? 'cooperative' : 'greedy', clickableIcons: false,
    restriction: pad ? { latLngBounds: pad, strictBounds: false } : undefined,
    styles: GSTYLE, backgroundColor: '#e8eaed',
  });
  let items = [];
  const keep = x => { items.push(x); return x; };
  // 吹き出し：重ね表示の左上を基準に (left, top) の位置へ、中央寄せで置く
  const tip = (text, cls, left, top, center) => {
    const d = document.createElement('div');
    d.className = `gm-tip dist-label ${cls}${center ? ' center' : ''}`; d.style.left = left + 'px'; d.style.top = top + 'px'; d.textContent = text;
    return d.outerHTML;
  };
  const html = (p, h, anchor, z = 0) => { const ov = new Html(p, h, anchor, z); ov.setMap(m); return keep(ov); };
  const fitPad = (padTL, padBR) => {
    // 余白が地図より大きいと縮尺が壊れるので、地図サイズの範囲に収める
    const W = el.clientWidth, H = el.clientHeight;
    const k = Math.min(1, (W - 60) / Math.max(1, padTL[0] + padBR[0]), (H - 60) / Math.max(1, padTL[1] + padBR[1]));
    return { left: padTL[0] * k, top: padTL[1] * k, right: padBR[0] * k, bottom: padBR[1] * k };
  };
  return {
    kind: 'google',
    onClick(cb) { m.addListener('click', e => e.latLng && cb({ lat: e.latLng.lat(), lng: e.latLng.lng() })); },
    setView(p, z) { m.setCenter(p); m.setZoom(z); },
    resize() { /* Google マップは自動で追従する */ },
    clear() { items.forEach(x => x.setMap(null)); items = []; },
    fit(points, { padTL = [30, 30], padBR = [30, 30], maxZoom = 17 } = {}) {
      const b = new g.LatLngBounds(); points.forEach(p => b.extend(p));
      // 地図の大きさが変わった直後は Google 側の認識が遅れるので、2フレーム待ってから合わせる
      requestAnimationFrame(() => requestAnimationFrame(() => {
        m.setOptions({ maxZoom }); // 上限を一時的に下げて、寄りすぎを防ぐ
        m.fitBounds(b, fitPad(padTL, padBR));
        g.event.addListenerOnce(m, 'idle', () => m.setOptions({ maxZoom: o.maxZoom }));
      }));
    },
    flyTo(p, z) { requestAnimationFrame(() => requestAnimationFrame(() => { m.setZoom(z); m.panTo(p); })); },
    pin(p, { kind = 'answer', num = '', ripple = false, label = '', labelCls = '', z = 0 } = {}) {
      const ov = html(p, pinHtml(kind, { num, ripple }) + (label ? tip(label, labelCls, 17, -6, false) : ''), [17, 42], 10 + z);
      return { setPos(q) { ov.setPos(q); }, remove() { ov.setMap(null); items = items.filter(x => x !== ov); } };
    },
    star(p, label) { html(p, STAR + tip(label, 'spot-label', 9, -4, false), [9, 9], 5); },
    line(a, b, style) {
      if (style === 'reveal') {
        const glow = keep(new g.Polyline({ path: [a, a], strokeColor: C.glow, strokeOpacity: .3, strokeWeight: 12, clickable: false, map: m }));
        const ln = keep(new g.Polyline({ path: [a, a], strokeColor: C.reveal, strokeOpacity: .95, strokeWeight: 4, clickable: false, map: m }));
        return {
          draw() {
            return new Promise(res => {
              const t0 = performance.now(), dur = reduced ? 1 : 850;
              const step = now => {
                const t = Math.min(1, (now - t0) / dur), e = ease(t);
                const p = { lat: a.lat + (b.lat - a.lat) * e, lng: a.lng + (b.lng - a.lng) * e };
                glow.setPath([a, p]); ln.setPath([a, p]);
                if (t < 1) return requestAnimationFrame(step);
                ln.setOptions({ strokeOpacity: 0, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: .95, strokeColor: C.reveal, strokeWeight: 4, scale: 2 }, offset: '0', repeat: '11px' }] });
                res();
              };
              requestAnimationFrame(step);
            });
          },
          label(t) { html({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }, tip(t, '', 0, 0, true), [0, 0], 20); },
        };
      }
      const color = style === 'link' ? C.link : C.final, w = style === 'link' ? 2 : 3;
      keep(new g.Polyline({ path: [a, b], strokeOpacity: 0, clickable: false, map: m,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: .9, strokeColor: color, strokeWeight: w, scale: 2 }, offset: '0', repeat: style === 'link' ? '9px' : '11px' }] }));
      return { async draw() {}, label() {} };
    },
    circle(c, radius) {
      const ci = keep(new g.Circle({ center: c, radius, strokeColor: C.hint, strokeWeight: 2, fillColor: C.hint, fillOpacity: .1, clickable: false, map: m }));
      m.fitBounds(ci.getBounds(), 30);
    },
    destroy() { this.clear(); el.innerHTML = ''; },
  };
}

// ---------- 外向きの窓口 ----------
function create(el, opts) {
  const o = Object.assign({ center: [35.4568, 139.6345], zoom: 15, minZoom: 14, maxZoom: 19, zoomCtrl: false, wheel: true, bounds: null }, opts);
  const clicks = [];
  const w = {
    impl: null,
    ensure() {
      const want = engine === 'google' ? 'google' : 'leaflet';
      if (w.impl && w.impl.kind === want) return w;
      if (w.impl) w.impl.destroy();
      try { w.impl = want === 'google' ? googleImpl(el, o) : leafletImpl(el, o); }
      catch { w.impl = leafletImpl(el, o); }
      clicks.forEach(cb => w.impl.onClick(cb));
      return w;
    },
    onClick(cb) { clicks.push(cb); w.impl.onClick(cb); },
  };
  for (const k of ['setView', 'resize', 'clear', 'fit', 'flyTo', 'pin', 'star', 'line', 'circle']) w[k] = (...a) => w.ensure().impl[k](...a);
  w.ensure();
  all.push(w);
  return w;
}

return {
  create,
  loadGoogle,
  get engine() { return engine; },
  // キーが使えなかったとき：全部の地図を国土地理院に戻す
  fallback() { engine = 'broken'; all.forEach(w => w.ensure()); },
  upgradeAll() { all.forEach(w => w.ensure()); },
  pinHtml,
};
})();
