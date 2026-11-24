// Màn "Bản đồ theo dõi": vị trí đang chia sẻ của tình nguyện viên (xanh lá) và người mua (cam).
// Bản đồ Leaflet nạp một lần từ CDN; nạp lỗi thì vẫn hiện danh sách. Làm mới 20 giây (lịch poll chung tự dừng khi tab ẩn/rảnh).
import { isPollFailure } from '../core/poll.js';
import { buildHash } from '../core/router.js';

const REFRESH_MS = 20000;
const STALE_MS = 5 * 60000;
const LIB_TIMEOUT_MS = 10000;
const FILTERS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'volunteer', label: 'Tình nguyện viên' },
  { key: 'customer', label: 'Người mua' },
];
const GROUP = { volunteer: 'Tình nguyện viên', customer: 'Người mua' };
const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
const MAP_CSS = '/frontend/foodsave-map.css';
const MAP_JS = '/frontend/foodsave-map.js';

const S = '[data-screen="tracking"]';
const CSS = `
${S} .trk-wrap{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:12px;align-items:start}
${S} .trk-map{height:560px;border:1px solid var(--bd);border-radius:var(--rs);background:var(--bg2);overflow:hidden}
${S} .trk-side{border:1px solid var(--bd);border-radius:var(--rs);background:var(--card);max-height:560px;overflow:auto}
${S} .trk-row{padding:10px 12px;border-bottom:1px solid var(--bd);font-size:.78rem;display:flex;gap:8px;align-items:flex-start}
${S} .trk-row:last-child{border-bottom:0}
${S} .trk-row[data-stale="1"]{opacity:.5}
${S} .trk-dot{width:10px;height:10px;border-radius:50%;margin-top:4px;flex:none}
${S} .trk-dot.volunteer{background:#1C7C45}
${S} .trk-dot.customer{background:#D97706}
${S} .trk-name{font-weight:700;color:var(--text)}
${S} .trk-meta{color:var(--t3);font-size:.7rem;margin-top:2px}
${S} .trk-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
${S} .trk-empty{padding:16px 12px;color:var(--t3);font-size:.76rem}
.trk-pin{width:30px;height:30px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.4);color:#fff;font-weight:800;font-size:.8rem;display:flex;align-items:center;justify-content:center}
.trk-pin.volunteer{background:#1C7C45}
.trk-pin.customer{background:#D97706}
.trk-pin.stale{opacity:.45}
@media(max-width:1100px){${S} .trk-wrap{grid-template-columns:1fr}${S} .trk-map{height:380px}${S} .trk-side{max-height:none}}
`;

const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : '');
const hasPoint = (r) => r.lat != null && r.lng != null && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng));
const ago = (iso) => {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'không rõ';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? 'vừa xong' : m < 60 ? `${m} phút trước` : `${Math.round(m / 60)} giờ trước`;
};
const code = (r) => `${r.context_kind === 'order' ? 'Đơn' : 'Lô'} ${r.context_code || String(r.context_id || '—').slice(0, 8)}`;

function loadLink(href) {
  if ([...document.head.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.getAttribute('href') === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}
function loadScript(src, ready) {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let el = [...document.scripts].find((s) => s.getAttribute('src') === src);
    if (el && el.dataset.failed) { el.remove(); el = null; }
    if (el && el.dataset.loaded) { reject(new Error('missing')); return; }
    if (!el) { el = document.createElement('script'); el.src = src; document.head.appendChild(el); }
    const timer = setTimeout(() => reject(new Error('timeout')), LIB_TIMEOUT_MS);
    el.addEventListener('load', () => { clearTimeout(timer); el.dataset.loaded = '1'; if (ready()) resolve(); else reject(new Error('missing')); }, { once: true });
    el.addEventListener('error', () => { clearTimeout(timer); el.dataset.failed = '1'; reject(new Error('load')); }, { once: true });
  });
}
// Nạp tuần tự Leaflet rồi foodsave-map; không nạp lại nếu đã có.
async function ensureMapLibs() {
  loadLink(LEAFLET_CSS);
  loadLink(MAP_CSS);
  await loadScript(LEAFLET_JS, () => Boolean(window.L?.map));
  await loadScript(MAP_JS, () => Boolean(window.FoodSaveMap?.createMap));
}

let styleEl = null;
let mapInst = null;

export default {
  id: 'tracking',
  title: 'Bản đồ theo dõi',
  group: 'HOẠT ĐỘNG',

  async render(container, ctx) {
    const { html, raw, esc, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.dataset.screen = 'tracking';
      styleEl.textContent = CSS;
      document.head.appendChild(styleEl);
    }

    container.innerHTML = html`<div data-screen="tracking"><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    let filter = FILTERS.some((f) => f.key === ctx.params?.kind) ? ctx.params.kind : 'all';
    let rows = null;
    let failed = false;
    let mapState = 'loading'; // loading | ready | failed
    let layer = null;
    let fitted = false;

    const stale = (r) => failed || !(Date.now() - new Date(r.updated_at).getTime() <= STALE_MS);
    const visible = () => (rows || []).filter((r) => filter === 'all' || r.actor_kind === filter);

    function drawShell() {
      const bar = FILTERS.map((f) => html`<button type="button" class="bt${raw(filter === f.key ? ' bt-p' : '')}" data-act="filter" data-kind="${f.key}" aria-pressed="${filter === f.key ? 'true' : 'false'}">${f.label}</button>`).join('');
      body.innerHTML = html`<div class="trk-bar">${raw(bar)}<span data-role="status" style="font-size:.72rem;color:var(--t3);margin-left:6px" role="status"></span></div>
        <div class="trk-wrap"><div data-role="map" class="trk-map"></div><div data-role="list" class="trk-side"></div></div>`;
    }

    function showMapFailed() {
      const el = body.querySelector('[data-role="map"]');
      if (el) el.innerHTML = html`<div class="trk-empty">Không tải được bản đồ. Danh sách bên cạnh vẫn cập nhật.</div>`;
    }

    function initMap() {
      const el = body.querySelector('[data-role="map"]');
      if (!el) return;
      const first = (rows || []).find(hasPoint);
      mapInst = window.FoodSaveMap.createMap(el, { center: first ? { lat: Number(first.lat), lng: Number(first.lng) } : undefined, zoom: 12 });
      if (!mapInst) { mapState = 'failed'; showMapFailed(); return; }
      layer = window.L.layerGroup().addTo(mapInst);
      mapState = 'ready';
      drawMarkers();
    }

    function drawMarkers() {
      if (mapState !== 'ready' || !layer || !rows) return;
      let openKey = null;
      layer.eachLayer((m) => { if (m.isPopupOpen && m.isPopupOpen()) openKey = m.trkKey; });
      layer.clearLayers();
      const points = [];
      for (const r of visible()) {
        if (!hasPoint(r)) continue;
        const lat = Number(r.lat);
        const lng = Number(r.lng);
        points.push([lat, lng]);
        const isStale = stale(r);
        const url = safeUrl(r.directions_url);
        const popup = `<b>${esc(r.name)}</b><br>${esc(GROUP[r.actor_kind] || '')} · ${esc(code(r))}<br>Cập nhật ${esc(ago(r.updated_at))}`
          + (r.destination ? `<br>Đang tới: ${esc(r.destination.label || '')}` : '')
          + (url ? `<br><a href="${esc(url)}" target="_blank" rel="noopener">Chỉ đường</a>` : '');
        const key = `${r.actor_kind}:${r.actor_id}`;
        const pin = `<div class="trk-pin ${r.actor_kind === 'customer' ? 'customer' : 'volunteer'}${isStale ? ' stale' : ''}">${esc(String(r.name || '?').trim().slice(0, 1).toUpperCase())}</div>`;
        const marker = window.L.marker([lat, lng], {
          icon: window.L.divIcon({ className: '', html: pin, iconSize: [30, 30], iconAnchor: [15, 15] }),
          opacity: isStale ? 0.45 : 1,
        }).bindPopup(popup, { autoPan: key !== openKey }).addTo(layer);
        marker.trkKey = key;
        if (key === openKey) marker.openPopup();
      }
      // Chỉ canh khung lần đầu hoặc khi đổi bộ lọc để làm mới không đổi zoom người dùng đang xem
      if (points.length && !fitted) { mapInst.fitBounds(points, { padding: [40, 40], maxZoom: 15, animate: false }); fitted = true; }
    }

    function drawList() {
      const list = body.querySelector('[data-role="list"]');
      if (!list) return;
      const shown = visible();
      list.innerHTML = shown.length ? shown.map((r) => {
        const g = r.actor_kind === 'customer' ? 'customer' : 'volunteer';
        const url = safeUrl(r.directions_url);
        const dest = r.destination ? html`<div class="trk-meta">Đang tới: ${r.destination.label || ''}</div>` : '';
        const dir = url ? html`<div class="trk-meta"><a href="${url}" target="_blank" rel="noopener">Chỉ đường</a></div>` : '';
        return html`<div class="trk-row" data-kind="${g}" data-stale="${stale(r) ? 1 : 0}"><span class="trk-dot ${g}"></span>
          <div style="min-width:0;flex:1"><div class="trk-name">${r.name}</div>
          <div class="trk-meta">${GROUP[g]} · ${code(r)} · cập nhật ${ago(r.updated_at)}</div>${raw(dest)}${raw(dir)}</div></div>`;
      }).join('') : html`<div class="trk-empty">Chưa có ai chia sẻ vị trí. Vị trí chỉ hiện khi tình nguyện viên đang làm nhiệm vụ hoặc người mua có đơn đã thanh toán và đã cho phép.</div>`;
      const status = body.querySelector('[data-role="status"]');
      if (status) {
        status.textContent = failed
          ? 'Không tải được vị trí mới. Dữ liệu có thể đã cũ, sẽ thử lại sau ít giây.'
          : `${shown.length} đang hiển thị${filter === 'all' ? '' : ' (đã lọc)'} · tự làm mới mỗi 20 giây`;
      }
    }

    function drawAll() { drawList(); drawMarkers(); }

    let seq = 0;
    async function refresh({ quiet = false } = {}) {
      const mine = ++seq;
      if (!quiet || !rows) { loading(body); mapInst = null; layer = null; mapState = 'loading'; }
      try {
        const res = await api.get('/admin/live-locations', { signal });
        if (!alive() || mine !== seq) return;
        const firstDraw = !body.querySelector('[data-role="map"]');
        rows = Array.isArray(res) ? res : [];
        failed = false;
        if (firstDraw) {
          drawShell();
          fitted = false;
          ensureMapLibs().then(() => { if (alive() && mapState === 'loading') initMap(); }).catch(() => { if (alive()) { mapState = 'failed'; showMapFailed(); } });
        }
        drawAll();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet) {
          if (rows) { failed = true; drawAll(); console.warn('[MIO] Không làm mới được vị trí:', err); }
          else error(body, err, () => refresh());
          if (isPollFailure(err)) throw err;
          return;
        }
        error(body, err, () => refresh());
      }
    }

    delegate(root, 'click', '[data-act="filter"]', (_e, el) => {
      if (el.dataset.kind === filter || !rows) return;
      filter = el.dataset.kind;
      fitted = false;
      history.replaceState(null, '', buildHash('tracking', { kind: filter === 'all' ? '' : filter }));
      root.querySelectorAll('[data-act="filter"]').forEach((b) => {
        const on = b.dataset.kind === filter;
        b.classList.toggle('bt-p', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      drawAll();
    });

    ctx.poll.add('screen:tracking', () => refresh({ quiet: true }), { everyMs: REFRESH_MS });
    await refresh();
  },

  destroy() {
    if (mapInst) { try { mapInst.remove(); } catch (e) { console.warn('[MIO] Không gỡ được bản đồ:', e); } mapInst = null; }
    if (styleEl) { styleEl.remove(); styleEl = null; }
  },
};
