// Màn "Người mua" (Đợt 2): danh sách phân trang/tìm phía server qua GET /admin/accounts?role=customer,
// hồ sơ 360° qua GET /admin/accounts/:id, hành động mở khóa nhãn đỏ (POST /admin/customers/:id/unlock)
// và tạm khóa / mở khóa tài khoản (POST /admin/accounts/:id/status). Tab lưu trong hash (#/customers?tab=all|locked|suspended).
import { maskPhone, stamp, vnd } from '../core/format.js';
import { actionLabel, badge } from '../core/vi.js';

const TABS = [
  { key: 'all', title: 'Tất cả' },
  { key: 'locked', title: 'Đang bị khóa nhãn đỏ' },
  { key: 'suspended', title: 'Tạm khóa tài khoản' },
];
const PROVIDERS = { password: 'Email', email: 'Email', google: 'Google', phone: 'Số điện thoại', facebook: 'Facebook', apple: 'Apple' };
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const providerText = (p) => (own(PROVIDERS, p) ? PROVIDERS[p] : 'Email');
const time = (iso) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};
const isLocked = (b, now = Date.now()) => (time(b?.red_ban_until) ?? 0) > now;
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
    let page = Math.max(1, Number(ctx.params?.page) || 1);
    let query = String(ctx.params?.q || '');
    let sortKey = 'created_at.desc';
    let data = null; // { items, total, page, limit, counts }
    let busy = false;
    let notice = '';
    let searchTimer = null;
    let seq = 0;
    let drawerSeq = 0;
    let openDetail = null;

    const buildListPath = () => {
      const sp = new URLSearchParams({ role: 'customer', page: String(page), limit: String(PAGE_SIZE), sort: sortKey });
      if (tab === 'locked') sp.set('red_banned', 'true');
      if (tab === 'suspended') sp.set('status', 'suspended');
      if (query.trim()) sp.set('q', query.trim().slice(0, 80));
      return `/admin/accounts?${sp.toString()}`;
    };

    const kpi = (key, label, value, note) =>
      html`<div class="K" data-kpi="${key}"><div class="K-l">${label}</div><div class="K-v">${value}</div><div class="K-n">${note}</div></div>`;

    function renderRows(items) {
      if (!items.length) {
        return html`<div style="padding:24px;text-align:center;color:var(--t3)">Không có người mua phù hợp.</div>`;
      }
      const now = Date.now();
      const rows = items.map((b) => {
        const locked = isLocked(b, now);
        const flags = [
          locked ? html`<span class="b b-e">Khóa nhãn đỏ</span>` : '',
          b.status === 'suspended' ? html`<span class="b b-w">Tạm khóa</span>` : '',
        ].join(' ');
        const loginAt = b.last_login_at || b.last_sign_in_at;
        return html`<tr>
          <td><button type="button" class="bt" data-act="open" data-id="${b.id}">${b.full_name || 'Chưa đặt tên'}</button> ${raw(flags)}</td>
          <td>${b.email || '—'}</td>
          <td>${b.phone ? maskPhone(b.phone) : '—'}</td>
          <td>${providerText(b.auth_provider || b.provider)}</td>
          <td><b>${num(b.points)}</b> · ${b.rank || '—'}</td>
          <td>${num(b.orders_completed)}/${num(b.orders_total)}/${num(b.orders_cancelled)}</td>
          <td>${stamp(loginAt)}</td>
        </tr>`;
      }).join('');

      const totalPages = Math.max(1, Math.ceil(num(data.total) / PAGE_SIZE));
      let pager = '';
      if (totalPages > 1) {
        const start = Math.max(1, page - 2);
        const end = Math.min(totalPages, start + 4);
        const btns = [];
        if (page > 1) btns.push(html`<button type="button" class="bt" data-act="page" data-page="${page - 1}">Trước</button>`);
        for (let p = start; p <= end; p += 1) {
          btns.push(html`<button type="button" class="bt${raw(p === page ? ' bt-p' : '')}" data-act="page" data-page="${p}"${raw(p === page ? ' aria-current="page"' : '')}>${p}</button>`);
        }
        if (page < totalPages) btns.push(html`<button type="button" class="bt" data-act="page" data-page="${page + 1}">Sau</button>`);
        pager = html`<nav aria-label="Phân trang" style="display:flex;gap:6px;justify-content:space-between;align-items:center;padding:8px 12px">
          <small style="color:var(--t3)">Trang ${page}/${totalPages} · ${num(data.total)} người mua</small>
          <span style="display:flex;gap:6px">${raw(btns.join(''))}</span>
        </nav>`;
      }

      return html`<table class="tbl">
        <thead><tr>
          <th>Người mua</th><th>Email</th><th>SĐT</th><th>Đăng nhập bằng</th><th>Điểm uy tín</th><th>Đơn (xong/tổng/hủy)</th><th>Đăng nhập cuối</th>
        </tr></thead>
        <tbody>${raw(rows)}</tbody>
      </table>${raw(pager)}`;
    }

    function drawBody() {
      const counts = data?.counts || {};
      const totalAll = Number.isFinite(Number(counts.total)) ? Number(counts.total) : num(data?.total);
      const lockedCount = Number.isFinite(Number(counts.locked)) ? Number(counts.locked) : 0;
      const suspendedCount = Number.isFinite(Number(counts.suspended)) ? Number(counts.suspended) : 0;
      const activeCount = Number.isFinite(Number(counts.active)) ? Number(counts.active) : Math.max(0, totalAll - suspendedCount);
      const tabCount = { all: totalAll, locked: lockedCount, suspended: suspendedCount };

      const tabs = TABS.map((t) =>
        html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-tab="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title} (${tabCount[t.key]})</button>`
      ).join('');
      const noticeHtml = notice
        ? html`<div role="status" data-role="notice" style="margin-bottom:12px;padding:10px 14px;border:1px solid var(--warn-bd);background:var(--warn-bg);color:var(--warn);border-radius:var(--rs);font-size:.8rem">${notice}</div>`
        : '';

      const hadFocus = document.activeElement?.dataset?.role === 'search';
      body.innerHTML = html`${raw(noticeHtml)}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px">
          ${raw(kpi('total', 'Tổng người mua', totalAll, 'Toàn bộ tài khoản người mua'))}
          ${raw(kpi('active', 'Đang hoạt động', activeCount, 'Tài khoản không bị tạm khóa'))}
          ${raw(kpi('locked', 'Đang bị khóa nhãn đỏ', lockedCount, 'Không đặt được hàng đỏ tới hết hạn'))}
          ${raw(kpi('suspended', 'Tài khoản tạm khóa', suspendedCount, 'Đã bị quản trị tạm khóa'))}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(tabs)}</div>
        <section class="P"><div class="P-h"><span class="P-t">Danh sách người mua</span>
          <input type="search" data-role="search" aria-label="Tìm người mua" placeholder="Tìm theo tên, email, SĐT" maxlength="80" style="padding:6px 10px;border:1px solid var(--bd2);border-radius:var(--rs);min-width:220px"></div>
          <div class="W" data-role="table">${raw(renderRows(data?.items || []))}</div></section>`;
      const searchEl = body.querySelector('[data-role="search"]');
      searchEl.value = query;
      if (hadFocus) { searchEl.focus(); searchEl.setSelectionRange(query.length, query.length); }
    }

    function detailHtml(d) {
      const p = d.profile || {};
      const trust = d.trust || {};
      const stats = d.order_stats || {};
      const orders = Array.isArray(d.recent_orders) ? d.recent_orders : [];
      const consents = Array.isArray(d.location_consents) ? d.location_consents : [];
      const auditRows = Array.isArray(d.recent_audit) ? d.recent_audit : [];
      const row = (label, value) => html`<tr><th style="text-align:left;padding:6px 0;width:42%;color:var(--t3);font-weight:600">${label}</th><td style="padding:6px 0">${value}</td></tr>`;

      const redLocked = Boolean(trust.red_banned || isLocked(p));
      const lockBadge = redLocked
        ? html`<span class="b b-e">Đang khóa đến ${stamp(trust.red_ban_until || p.red_ban_until)}</span>`
        : html`<span class="b b-ok">Không bị khóa</span>`;
      const consentText = consents.length
        ? consents.map((c) => `${c.granted ? 'Đã đồng ý' : 'Từ chối'} (${stamp(c.decided_at)})`).join(', ')
        : 'Chưa ghi nhận';

      const unlockBtn = redLocked
        ? html`<button type="button" class="bt bt-p" data-act="unlock" data-id="${p.id}">Mở khóa nhãn đỏ</button>`
        : '';
      const statusBtn = p.status === 'suspended'
        ? html`<button type="button" class="bt bt-p" data-act="account-status" data-status="active" data-id="${p.id}">Mở khóa tài khoản</button>`
        : html`<button type="button" class="bt b-e" data-act="account-status" data-status="suspended" data-id="${p.id}">Tạm khóa tài khoản</button>`;

      const ordersHtml = orders.length
        ? html`<table class="tbl"><thead><tr><th>Mã đơn</th><th>Trạng thái</th><th>Tiền</th><th>Thời gian</th></tr></thead><tbody>${raw(
          orders.map((o) => html`<tr><td>${o.order_number || String(o.id || '').slice(0, 8)}</td><td>${raw(badge('order', o.status))}</td><td>${vnd(o.total_cents)}</td><td>${stamp(o.created_at)}</td></tr>`).join('')
        )}</tbody></table>`
        : html`<div style="font-size:.8rem;color:var(--t3)">Chưa có đơn hàng nào.</div>`;

      const auditHtml = auditRows.length
        ? auditRows.map((a) => html`<div class="DR"><div class="DR-l">${stamp(a.created_at)}</div><div class="DR-v"><b>${a.actor_name || 'Hệ thống'}</b> · ${actionLabel(a.action)}${raw(a.detail?.reason ? html`<br><small style="color:var(--t3)">Lý do: ${a.detail.reason}</small>` : '')}</div></div>`).join('')
        : html`<div style="font-size:.8rem;color:var(--t3)">Chưa có lịch sử tác động.</div>`;

      return html`<div style="padding:14px 18px" data-role="profile" data-id="${p.id}">
        <h3 style="margin:0 0 8px">${p.full_name || 'Chưa đặt tên'}</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${raw(statusBtn)} ${raw(unlockBtn)}</div>
        <table style="width:100%;font-size:.82rem;border-collapse:collapse"><tbody>
          ${raw(row('Email', p.email || '—'))}
          ${raw(row('Số điện thoại', p.phone || '—'))}
          ${raw(row('Đăng nhập bằng', providerText(p.auth_provider || p.provider)))}
          ${raw(row('Trạng thái tài khoản', raw(badge('accountStatus', p.status || 'active'))))}
          ${raw(p.suspended_reason ? row('Lý do tạm khóa', p.suspended_reason) : '')}
          ${raw(row('Điểm uy tín', `${num(trust.points ?? p.points)} · ${trust.rank || p.rank || '—'}`))}
          ${raw(row('Khóa nhãn đỏ', raw(lockBadge)))}
          ${raw(row('Số lần vắng mặt (60 ngày)', num(trust.no_show_count)))}
          ${raw(row('Chia sẻ vị trí', consentText))}
          ${raw(row('Tham gia', stamp(p.created_at)))}
          ${raw(row('Đăng nhập cuối', stamp(p.last_login_at || p.last_sign_in_at)))}
          ${raw(row('Thống kê đơn', `${num(stats.completed)} xong / ${num(stats.total)} tổng / ${num(stats.cancelled)} hủy / ${num(stats.no_show)} vắng mặt`))}
          ${raw(row('Tổng chi tiêu', vnd(stats.spent_cents)))}
        </tbody></table>
        <h4 style="margin:16px 0 6px;font-size:.8rem">10 đơn gần nhất</h4>
        <div class="W">${raw(ordersHtml)}</div>
        <h4 style="margin:16px 0 6px;font-size:.8rem">Nhật ký gần đây</h4>
        <div>${raw(auditHtml)}</div>
      </div>`;
    }

    async function load({ quiet = false } = {}) {
      const mine = ++seq;
      if (!quiet || !data) loading(body);
      try {
        const res = await api.get(buildListPath(), { signal });
        if (!alive() || mine !== seq) return;
        data = {
          items: Array.isArray(res?.items) ? res.items : [],
          total: num(res?.total),
          page: num(res?.page) || page,
          limit: num(res?.limit) || PAGE_SIZE,
          counts: res?.counts || {},
        };
        drawBody();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet && data) { console.warn('[MIO] Không làm mới được danh sách người mua:', err); return; }
        error(body, err, () => load());
      }
    }

    async function openAccount(id, { fromDeepLink = false } = {}) {
      const mine = ++drawerSeq;
      if (!fromDeepLink) {
        ctx.ui.drawer.open(html`<div style="padding:16px">Đang tải hồ sơ 360°…</div>`, { title: 'Hồ sơ người mua' });
      }
      try {
        const detail = await api.get(`/admin/accounts/${encodeURIComponent(id)}`, { signal });
        if (!alive() || mine !== drawerSeq) return;
        openDetail = detail;
        ctx.ui.drawer.open(detailHtml(detail), { title: 'Hồ sơ người mua' });
      } catch (err) {
        if (!alive() || mine !== drawerSeq || err?.name === 'AbortError') return;
        if (fromDeepLink && err?.status === 404) {
          notice = 'Không tìm thấy tài khoản người mua này.';
          drawBody();
          return;
        }
        ctx.ui.drawer.open(html`<div role="alert" style="padding:16px;color:var(--err)">${err?.message || 'Không tải được hồ sơ người mua.'}</div>`, { title: 'Hồ sơ người mua' });
      }
    }

    async function unlock(id) {
      if (busy) return;
      const name = openDetail?.profile?.full_name || 'người mua này';
      const res = await ctx.ui.confirm({
        title: `Mở khóa nhãn đỏ cho ${name}?`,
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

    async function changeStatus(id, nextStatus) {
      if (busy) return;
      const name = openDetail?.profile?.full_name || 'tài khoản này';
      const suspending = nextStatus === 'suspended';
      const res = await ctx.ui.confirm({
        title: suspending ? `Tạm khóa tài khoản ${name}?` : `Mở khóa tài khoản ${name}?`,
        body: suspending
          ? 'Tài khoản bị tạm khóa sẽ không thể sử dụng ứng dụng cho tới khi quản trị viên mở khóa lại.'
          : 'Tài khoản sẽ hoạt động trở lại bình thường.',
        danger: suspending,
        reasonRequired: suspending,
        reasonOptional: !suspending,
        reasonLabel: suspending ? 'Lý do tạm khóa (bắt buộc, ít nhất 3 ký tự)' : 'Ghi chú (không bắt buộc)',
        confirmText: suspending ? 'Tạm khóa' : 'Mở khóa',
      });
      if (!res.ok || !alive()) return;
      busy = true;
      try {
        const bodyPayload = { status: nextStatus, ...(res.reason ? { reason: res.reason } : {}) };
        await api.post(`/admin/accounts/${encodeURIComponent(id)}/status`, bodyPayload, { signal });
        if (!alive()) return;
        ctx.ui.toast(suspending ? 'Đã tạm khóa tài khoản' : 'Đã mở khóa tài khoản');
        await load({ quiet: true });
        await openAccount(id);
        ctx.refreshWork();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Không cập nhật được trạng thái tài khoản', 'err');
      } finally {
        busy = false;
      }
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => {
      if (el.dataset.tab !== tab) ctx.navigate('customers', { tab: el.dataset.tab });
    });
    delegate(root, 'click', '[data-act="open"]', (_e, el) => openAccount(el.dataset.id));
    delegate(root, 'click', '[data-act="page"]', (_e, el) => {
      const next = Number(el.dataset.page) || 1;
      if (next !== page) { page = next; load(); }
    });
    delegate(root, 'input', '[data-role="search"]', (_e, el) => {
      query = el.value;
      page = 1;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { searchTimer = null; if (alive()) load({ quiet: true }); }, SEARCH_DEBOUNCE_MS);
    });

    const drawerEl = typeof document !== 'undefined' ? document.getElementById('drawer') : null;
    if (drawerEl) {
      cleanup.push(delegate(drawerEl, 'click', '[data-act="unlock"]', (_e, el) => unlock(el.dataset.id)));
      cleanup.push(delegate(drawerEl, 'click', '[data-act="account-status"]', (_e, el) => changeStatus(el.dataset.id, el.dataset.status)));
    }
    cleanup.push(() => { if (searchTimer) clearTimeout(searchTimer); drawerSeq += 1; });

    await load();
    const wanted = ctx.params?.id;
    if (wanted && alive()) {
      await openAccount(wanted, { fromDeepLink: true });
    }
  },

  destroy() {
    cleanup.forEach((off) => off());
    cleanup = [];
  },
};
