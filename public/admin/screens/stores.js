// Màn "Cửa hàng": danh sách đang hoạt động (GET /catalog/stores?limit=100, công khai) và cửa hàng chờ duyệt
// (GET /admin/pending-partners). Ngăn kéo chi tiết: uy tín (GET /seller-reputation/:id) và 10 đơn gần nhất
// (GET /orders?store_id=…). Chỉ đọc, không có hành động ghi. Tab lưu trong hash (#/stores?tab=active|pending).
import { maskPhone, stamp, vnd } from '../core/format.js';
import { dataTable } from '../core/table.js';
import { badge } from '../core/vi.js';

const TABS = [
  { key: 'active', title: 'Đang hoạt động' },
  { key: 'pending', title: 'Chờ duyệt' },
];
const STATUSES = { Active: ['Đang hoạt động', 'ok'], Restricted: ['Bị hạn chế', 'w'], Banned: ['Bị cấm', 'e'] };
const PAGE_SIZE = 25;
const ORDER_LIMIT = 10;

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const list = (v) => (Array.isArray(v) ? v : v?.items || []);
const rating = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v).toFixed(1) : '—');
const place = (s) => [s.district, s.city].filter(Boolean).join(', ') || '—';

let cleanup = [];

export default {
  id: 'stores',
  title: 'Cửa hàng',
  group: 'HỒ SƠ',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div data-screen="stores"><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    const tab = TABS.some((t) => t.key === ctx.params?.tab) ? ctx.params.tab : 'active';
    let data = null; // { stores, total, pending }
    let query = '';
    let table = null;
    let sortState = { key: tab === 'pending' ? 'created_at' : 'rating', dir: 'desc' };
    let drawerToken = 0;

    const matches = (s) => {
      const q = query.trim().toLowerCase();
      return !q || [s.name, s.address].some((v) => String(v ?? '').toLowerCase().includes(q));
    };

    function tableHtml() {
      const nameCell = (s) => html`<button type="button" class="bt" data-act="open" data-id="${s.id}">${s.name || 'Chưa đặt tên'}</button>`;
      const columns = tab === 'pending'
        ? [
          { key: 'name', label: 'Cửa hàng', sort: true, render: (s) => html`<b>${s.name || 'Chưa đặt tên'}</b>` },
          { key: 'address', label: 'Địa chỉ', render: (s) => html`${s.address || '—'}` },
          { key: '_owner', label: 'Chủ cửa hàng', render: (s) => html`${s._owner || '—'}${raw(s._phone ? html`<br><small style="color:var(--t3)">${maskPhone(s._phone)}</small>` : '')}` },
          { key: 'created_at', label: 'Gửi lúc', sort: true, render: (s) => html`${stamp(s.created_at)}` },
        ]
        : [
          { key: 'name', label: 'Cửa hàng', sort: true, render: nameCell },
          { key: 'address', label: 'Địa chỉ', render: (s) => html`${s.address || '—'}` },
          { key: 'district', label: 'Quận / thành phố', render: (s) => html`${place(s)}` },
          { key: 'rating', label: 'Đánh giá', sort: true, render: (s) => html`${rating(s.rating)}` },
          { key: 'is_verified', label: 'Xác minh', render: (s) => (s.is_verified ? html`<span class="b b-ok">Đã xác minh</span>` : html`<span class="b b-m">Chưa xác minh</span>`) },
          { key: 'created_at', label: 'Ngày tham gia', sort: true, render: (s) => html`${stamp(s.created_at)}` },
        ];
      table = dataTable({
        pageSize: PAGE_SIZE,
        rows: (tab === 'pending' ? data.pending : data.stores).filter(matches),
        sort: sortState,
        columns,
        emptyText: tab === 'pending' ? 'Không có cửa hàng nào chờ duyệt.' : 'Không có cửa hàng phù hợp.',
      });
      return table.html();
    }

    const redrawTable = () => {
      const el = body.querySelector('[data-role="table"]');
      if (el) el.innerHTML = tableHtml();
    };

    const kpi = (key, label, value, note) => html`<div class="K" data-kpi="${key}"><div class="K-l">${label}</div><div class="K-v">${value}</div><div class="K-n">${note}</div></div>`;

    function drawBody() {
      const more = data.total > data.stores.length ? `Danh sách hiện ${data.stores.length} cửa hàng đầu` : 'Cửa hàng đang bán trên ứng dụng';
      const tabCount = { active: data.total, pending: data.pending.length };
      const tabs = TABS.map((t) => html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-tab="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title} (${tabCount[t.key]})</button>`).join('');
      const prevQuery = body.querySelector('[data-role="search"]')?.value ?? query;
      const goVerify = tab === 'pending' ? html`<button type="button" class="bt bt-p" data-act="go-verify">Mở Duyệt hồ sơ</button>` : '';
      body.innerHTML = html`
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px">
          ${raw(kpi('active', 'Đang hoạt động', data.total, more))}
          ${raw(kpi('pending', 'Chờ duyệt', data.pending.length, 'Duyệt ở màn Duyệt hồ sơ'))}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(tabs)}</div>
        <section class="P"><div class="P-h"><span class="P-t">${tab === 'pending' ? 'Cửa hàng chờ duyệt' : 'Cửa hàng đang hoạt động'}</span>
          <span style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${raw(goVerify)}
            <input type="search" data-role="search" aria-label="Tìm cửa hàng" placeholder="Tìm theo tên, địa chỉ" maxlength="80" style="padding:6px 10px;border:1px solid var(--bd2);border-radius:var(--rs);min-width:200px"></span></div>
          <div class="W" data-role="table"></div></section>
        <section class="P"><div class="P-h"><span class="P-t">Sắp có</span></div>
          <div style="padding:12px 16px;font-size:.8rem;color:var(--t3)">Tạm ngưng bán, ví cửa hàng và giấy tờ đăng ký cần API mới nên chưa dùng được. Màn này chỉ để xem.</div></section>`;
      body.querySelector('[data-role="search"]').value = prevQuery;
      redrawTable();
    }

    function storeHtml(s) {
      const row = (label, value) => html`<tr><th style="text-align:left;padding:6px 0;width:42%;color:var(--t3);font-weight:600">${label}</th><td style="padding:6px 0">${value}</td></tr>`;
      const yes = (v, a, b) => (v ? a : b);
      return html`<div style="padding:14px 18px" data-role="store" data-id="${s.id}">
        <h3 style="margin:0 0 8px">${s.name || 'Chưa đặt tên'}</h3>
        <table style="width:100%;font-size:.82rem;border-collapse:collapse"><tbody>
          ${raw(row('Địa chỉ', s.address || '—'))}
          ${raw(row('Quận / thành phố', place(s)))}
          ${raw(row('Giờ mở cửa', s.opening_hours || '—'))}
          ${raw(row('Đang mở cửa', yes(s.is_open, 'Có', 'Không')))}
          ${raw(row('Xác minh', yes(s.is_verified, 'Đã xác minh', 'Chưa xác minh')))}
          ${raw(row('Đánh giá', rating(s.rating)))}
          ${raw(row('Tham gia', stamp(s.created_at)))}
        </tbody></table>
        <h4 style="margin:16px 0 6px;font-size:.8rem">Uy tín cửa hàng</h4>
        <div data-role="reputation" style="font-size:.82rem;color:var(--t3)">Đang tải…</div>
        <h4 style="margin:16px 0 6px;font-size:.8rem">${ORDER_LIMIT} đơn gần nhất</h4>
        <div data-role="orders" style="font-size:.82rem;color:var(--t3)">Đang tải…</div>
        <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--bd)">
          <div style="font-size:.72rem;font-weight:700;color:var(--t3);margin-bottom:6px">Sắp có — cần API mới</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="bt" disabled>Tạm ngưng bán</button>
            <button type="button" class="bt" disabled>Ví cửa hàng</button>
            <button type="button" class="bt" disabled>Giấy tờ đăng ký</button>
          </div></div></div>`;
    }

    function reputationHtml(r) {
      const [text, level] = own(STATUSES, r?.status) ? STATUSES[r.status] : ['—', 'm'];
      const until = r?.restricted_until ? html`<div>Hạn chế đến ${stamp(r.restricted_until)}</div>` : '';
      const score = Number.isFinite(Number(r?.trust_score)) && r?.trust_score != null ? Number(r.trust_score) : '—';
      return html`<div><b>Điểm uy tín: ${score}</b> · Đánh giá TB: ${rating(r?.rating_avg)}</div>
        <div style="margin-top:4px"><span class="b b-${raw(level)}">${text}</span></div>${raw(until)}`;
    }

    function ordersHtml(items) {
      if (!items.length) return html`Chưa có đơn nào.`;
      return html`<table class="tbl"><thead><tr><th>Mã đơn</th><th>Trạng thái</th><th>Tiền</th><th>Thời gian</th></tr></thead><tbody>${raw(items.map((o) => html`<tr>
        <td>${o.order_number || String(o.id || '').slice(0, 8) || '—'}</td><td>${raw(badge('order', o.status))}</td>
        <td>${vnd(o.total_cents)}</td><td>${stamp(o.created_at)}</td></tr>`).join(''))}</tbody></table>`;
    }

    async function openStore(id) {
      const s = data?.stores.find((r) => r.id === id);
      if (!s) return;
      const token = ++drawerToken;
      ctx.ui.drawer.open(storeHtml(s), { title: 'Chi tiết cửa hàng' });
      const slot = (role) => {
        const el = document.querySelector(`#drawer [data-role="${role}"]`);
        const mine = el && token === drawerToken && alive() && el.closest('[data-role="store"]')?.dataset.id === id ? el : null;
        return mine;
      };
      const [rep, ord] = await Promise.allSettled([
        api.get(`/seller-reputation/${encodeURIComponent(id)}`, { signal }),
        api.get(`/orders?store_id=${encodeURIComponent(id)}&limit=${ORDER_LIMIT}`, { signal }),
      ]);
      const repEl = slot('reputation');
      if (repEl) repEl.innerHTML = rep.status === 'fulfilled' && rep.value ? reputationHtml(rep.value) : html`—`;
      const ordEl = slot('orders');
      if (ordEl) ordEl.innerHTML = ord.status === 'fulfilled' ? ordersHtml(list(ord.value).slice(0, ORDER_LIMIT)) : html`Không tải được đơn gần nhất.`;
    }

    let seq = 0;
    async function load() {
      const mine = ++seq;
      loading(body);
      try {
        const [stores, pending] = await Promise.all([
          api.get('/catalog/stores?limit=100', { signal }),
          api.get('/admin/pending-partners', { signal }),
        ]);
        if (!alive() || mine !== seq) return;
        const items = list(stores);
        data = {
          stores: items,
          total: Number.isFinite(Number(stores?.pagination?.total)) ? Number(stores.pagination.total) : items.length,
          pending: (Array.isArray(pending) ? pending : []).map((p) => ({ ...(p.store || {}), _owner: p.profile?.full_name || '', _phone: p.profile?.phone || '' })),
        };
        drawBody();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        error(body, err, () => load());
      }
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => { if (el.dataset.tab !== tab) ctx.navigate('stores', { tab: el.dataset.tab }); });
    delegate(root, 'click', '[data-act="go-verify"]', () => ctx.navigate('verify'));
    delegate(root, 'click', '[data-act="open"]', (_e, el) => openStore(el.dataset.id));
    delegate(root, 'click', '[data-act="sort"]', (_e, el) => {
      const key = el.dataset.key;
      sortState = { key, dir: sortState.key === key && sortState.dir === 'asc' ? 'desc' : 'asc' };
      redrawTable();
    });
    delegate(root, 'click', '[data-act="page"]', (_e, el) => {
      table.state.page = Number(el.dataset.page) || 1;
      const el2 = body.querySelector('[data-role="table"]');
      if (el2) el2.innerHTML = table.html();
    });
    delegate(root, 'input', '[data-role="search"]', (_e, el) => { query = el.value; redrawTable(); });
    cleanup.push(() => { drawerToken += 1; });

    await load();
  },

  destroy() {
    cleanup.forEach((off) => off());
    cleanup = [];
  },
};
