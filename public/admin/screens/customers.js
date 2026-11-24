// Màn "Người mua": danh sách từ GET /admin/users (tối đa 500 người mới nhất), lọc/tìm phía client,
// hồ sơ trong ngăn kéo, một hành động ghi: mở khóa nhãn đỏ (POST /admin/customers/:id/unlock).
// Tab lưu trong hash (#/customers?tab=all|locked|suspended). Không poll (API quét toàn bộ đơn của người mua).
import { maskPhone, stamp } from '../core/format.js';
import { dataTable } from '../core/table.js';

const TABS = [
  { key: 'all', title: 'Tất cả' },
  { key: 'locked', title: 'Đang bị khóa nhãn đỏ' },
  { key: 'suspended', title: 'Tạm khóa tài khoản' },
];
const PROVIDERS = { email: 'Email', google: 'Google', phone: 'Số điện thoại', facebook: 'Facebook', apple: 'Apple' };
const STATUSES = { active: 'Đang hoạt động', suspended: 'Tạm khóa', pending: 'Chờ duyệt', rejected: 'Bị từ chối' };
const DAY_MS = 86400000;
const PAGE_SIZE = 25;
const NEW_DAYS = 7;

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const providerText = (p) => (own(PROVIDERS, p) ? PROVIDERS[p] : 'Khác');
const statusText = (s) => (own(STATUSES, s) ? STATUSES[s] : '—');
const time = (iso) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};
const isLocked = (b, now) => (time(b.red_ban_until) ?? 0) > now;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

let cleanup = [];

export default {
  id: 'customers',
  title: 'Người mua',
  group: 'HỒ SƠ',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div data-screen="customers"><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    const tab = TABS.some((t) => t.key === ctx.params?.tab) ? ctx.params.tab : 'all';
    let data = null; // { counts, buyers }
    let query = '';
    let table = null;
    let busy = false;
    let notice = ''; // thông báo ngắn trên đầu màn (id từ hash không có trong danh sách)
    let sortState = { key: 'created_at', dir: 'desc' };

    // Ngày giờ "bây giờ" lấy lúc vẽ; mỗi hàng được gắn sẵn các trường dùng để lọc/sắp xếp
    const decorate = (b, now) => ({
      ...b,
      _locked: isLocked(b, now),
      _suspended: b.status === 'suspended',
      _new: (time(b.created_at) ?? 0) > now - NEW_DAYS * DAY_MS,
      _login: time(b.last_sign_in_at),
      _search: [b.full_name, b.email, b.phone].map((v) => String(v ?? '').toLowerCase()).join(' '),
    });

    const visible = () => {
      const q = query.trim().toLowerCase();
      return data.rows.filter((b) => (tab === 'locked' ? b._locked : tab === 'suspended' ? b._suspended : true)
        && (!q || b._search.includes(q)));
    };

    function nameCell(b) {
      const flags = [
        b._locked ? html`<span class="b b-e">Khóa nhãn đỏ</span>` : '',
        b._suspended ? html`<span class="b b-w">Tạm khóa</span>` : '',
      ].join(' ');
      return html`<button type="button" class="bt" data-act="open" data-id="${b.id}">${b.full_name || 'Chưa đặt tên'}</button> ${raw(flags)}`;
    }

    function tableHtml() {
      table = dataTable({
        pageSize: PAGE_SIZE,
        rows: visible(),
        sort: sortState,
        emptyText: 'Không có người mua phù hợp.',
        columns: [
          { key: 'full_name', label: 'Người mua', sort: true, render: nameCell },
          { key: 'email', label: 'Email', render: (b) => html`${b.email || '—'}` },
          { key: 'phone', label: 'SĐT', render: (b) => html`${b.phone ? maskPhone(b.phone) : '—'}` },
          { key: 'provider', label: 'Đăng nhập bằng', render: (b) => html`${providerText(b.provider)}` },
          { key: 'points', label: 'Điểm uy tín', sort: true, render: (b) => html`<b>${num(b.points)}</b> · ${b.rank || '—'}` },
          { key: 'orders_total', label: 'Đơn (xong/tổng/hủy)', sort: true, render: (b) => html`${num(b.orders_completed)}/${num(b.orders_total)}/${num(b.orders_cancelled)}` },
          { key: '_login', label: 'Đăng nhập cuối', sort: true, render: (b) => html`${stamp(b.last_sign_in_at)}` },
        ],
      });
      return table.html();
    }

    const redrawTable = () => {
      const el = body.querySelector('[data-role="table"]');
      if (el) el.innerHTML = tableHtml();
    };

    function kpi(key, label, value, note) {
      return html`<div class="K" data-kpi="${key}"><div class="K-l">${label}</div><div class="K-v">${value}</div><div class="K-n">${note}</div></div>`;
    }

    function drawBody() {
      const { rows, counts } = data;
      const total = Number.isFinite(Number(counts?.customers)) ? Number(counts.customers) : rows.length;
      const shown = total > rows.length ? `Danh sách hiện ${rows.length} người mới nhất` : 'Toàn bộ người mua';
      const n = { locked: rows.filter((b) => b._locked).length, suspended: rows.filter((b) => b._suspended).length, fresh: rows.filter((b) => b._new).length };
      const tabCount = { all: rows.length, locked: n.locked, suspended: n.suspended };
      const tabs = TABS.map((t) => html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-tab="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title} (${tabCount[t.key]})</button>`).join('');
      const prevQuery = body.querySelector('[data-role="search"]')?.value ?? query;
      const noticeHtml = notice ? html`<div role="status" data-role="notice" style="margin-bottom:12px;padding:10px 14px;border:1px solid var(--warn-bd);background:var(--warn-bg);color:var(--warn);border-radius:var(--rs);font-size:.8rem">${notice}</div>` : '';
      body.innerHTML = html`${raw(noticeHtml)}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px">
          ${raw(kpi('total', 'Tổng người mua', total, shown))}
          ${raw(kpi('locked', 'Đang bị khóa nhãn đỏ', n.locked, 'Không đặt được đơn tới hết hạn khóa'))}
          ${raw(kpi('suspended', 'Tài khoản tạm khóa', n.suspended, 'Trạng thái của hồ sơ'))}
          ${raw(kpi('new7', 'Người mua mới 7 ngày', n.fresh, 'Tính trên danh sách đã tải'))}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(tabs)}</div>
        <section class="P"><div class="P-h"><span class="P-t">Danh sách người mua</span>
          <input type="search" data-role="search" aria-label="Tìm người mua" placeholder="Tìm theo tên, email, SĐT" maxlength="80" style="padding:6px 10px;border:1px solid var(--bd2);border-radius:var(--rs);min-width:220px"></div>
          <div class="W" data-role="table"></div></section>
        <section class="P"><div class="P-h"><span class="P-t">Sắp có</span></div>
          <div style="padding:12px 16px;font-size:.8rem;color:var(--t3)">Khóa hoặc mở tài khoản, lịch sử điểm uy tín và danh sách đơn của từng người mua cần API mới nên chưa dùng được. Hiện chỉ mở khóa nhãn đỏ.</div></section>`;
      const search = body.querySelector('[data-role="search"]');
      search.value = prevQuery;
      redrawTable();
    }

    function profileHtml(b) {
      const row = (label, value) => html`<tr><th style="text-align:left;padding:6px 0;width:42%;color:var(--t3);font-weight:600">${label}</th><td style="padding:6px 0">${value}</td></tr>`;
      const lock = b._locked
        ? html`<span class="b b-e">Đang bị khóa đến ${stamp(b.red_ban_until)}</span>`
        : html`<span class="b b-ok">Không bị khóa</span>`;
      const unlock = b._locked
        ? html`<button type="button" class="bt bt-p" data-act="unlock" data-id="${b.id}">Mở khóa nhãn đỏ</button>`
        : '';
      return html`<div style="padding:14px 18px" data-role="profile" data-id="${b.id}">
        <h3 style="margin:0 0 8px">${b.full_name || 'Chưa đặt tên'}</h3>
        <table style="width:100%;font-size:.82rem;border-collapse:collapse"><tbody>
          ${raw(row('Email', b.email || '—'))}
          ${raw(row('Số điện thoại', b.phone || '—'))}
          ${raw(row('Đăng nhập bằng', providerText(b.provider)))}
          ${raw(row('Trạng thái tài khoản', statusText(b.status)))}
          ${raw(row('Điểm uy tín', `${num(b.points)} · ${b.rank || '—'}`))}
          ${raw(row('Khóa nhãn đỏ', raw(lock)))}
          ${raw(row('Tham gia', stamp(b.created_at)))}
          ${raw(row('Đăng nhập cuối', stamp(b.last_sign_in_at)))}
          ${raw(row('Đơn hoàn thành', num(b.orders_completed)))}
          ${raw(row('Tổng đơn', num(b.orders_total)))}
          ${raw(row('Đơn đã hủy', num(b.orders_cancelled)))}
        </tbody></table>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">${raw(unlock)}</div>
        <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--bd)">
          <div style="font-size:.72rem;font-weight:700;color:var(--t3);margin-bottom:6px">Sắp có — cần API mới</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="bt" disabled>Khóa / mở tài khoản</button>
            <button type="button" class="bt" disabled>Lịch sử điểm uy tín</button>
            <button type="button" class="bt" disabled>Danh sách đơn</button>
          </div>
        </div></div>`;
    }

    let seq = 0;
    async function load({ quiet = false } = {}) {
      const mine = ++seq;
      if (!quiet || !data) loading(body);
      try {
        const res = await api.get('/admin/users', { signal });
        if (!alive() || mine !== seq) return;
        const now = Date.now();
        data = { counts: res?.counts || {}, rows: (Array.isArray(res?.buyers) ? res.buyers : []).map((b) => decorate(b, now)) };
        drawBody();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet && data) { console.warn('[MIO] Không làm mới được danh sách người mua:', err); return; }
        error(body, err, () => load());
      }
    }

    async function unlock(id) {
      if (busy) return;
      const b = data?.rows.find((r) => r.id === id);
      if (!b) return;
      const res = await ctx.ui.confirm({
        title: `Mở khóa nhãn đỏ cho ${b.full_name || 'người mua này'}?`,
        body: 'Người mua đặt đơn lại được ngay và nhận thông báo. Điểm uy tín được nâng lên mức tối thiểu để mua hàng.',
        reasonOptional: true, reasonLabel: 'Ghi chú (không bắt buộc)', confirmText: 'Mở khóa',
      });
      if (!res.ok || !alive()) return;
      busy = true;
      try {
        await api.post(`/admin/customers/${encodeURIComponent(id)}/unlock`, res.reason ? { note: res.reason } : {}, { signal });
        if (!alive()) return;
        ctx.ui.toast('Đã mở khóa nhãn đỏ');
        ctx.ui.drawer.close();
        await load({ quiet: true });
        ctx.refreshWork();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Không mở khóa được', 'err');
      } finally {
        busy = false;
      }
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => { if (el.dataset.tab !== tab) ctx.navigate('customers', { tab: el.dataset.tab }); });
    delegate(root, 'click', '[data-act="open"]', (_e, el) => {
      const b = data?.rows.find((r) => r.id === el.dataset.id);
      if (b) ctx.ui.drawer.open(profileHtml(b), { title: 'Hồ sơ người mua' });
    });
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

    const drawerEl = typeof document !== 'undefined' ? document.getElementById('drawer') : null;
    if (drawerEl) cleanup.push(delegate(drawerEl, 'click', '[data-act="unlock"]', (_e, el) => unlock(el.dataset.id)));

    await load();
    // Liên kết sâu từ màn khác (#/customers?id=<id>): mở hồ sơ sau lần tải đầu
    const wanted = ctx.params?.id;
    if (wanted && data && alive()) {
      const found = data.rows.find((r) => r.id === wanted);
      if (found) ctx.ui.drawer.open(profileHtml(found), { title: 'Hồ sơ người mua' });
      else { notice = 'Không tìm thấy người mua này trong 500 tài khoản mới nhất'; drawBody(); }
    }
  },

  destroy() {
    cleanup.forEach((off) => off());
    cleanup = [];
  },
};
