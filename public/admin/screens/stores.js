// Màn "Cửa hàng" (Đợt 2): danh sách từ GET /admin/stores (tabs active|pending|suspended), tìm kiếm & phân trang server,
// hồ sơ 360° qua GET /admin/stores/:id (chủ cửa hàng, giấy tờ đã che, ví, uy tín, sản phẩm, 10 đơn/khiếu nại/lô tặng),
// hành động tạm ngưng bán / mở bán lại (POST /admin/stores/:id/status). Hỗ trợ #/stores?id=<id>.
import { maskPhone, stamp, vnd } from '../core/format.js';
import { actionLabel, badge } from '../core/vi.js';

const TABS = [
  { key: 'active', title: 'Đang hoạt động' },
  { key: 'pending', title: 'Chờ duyệt' },
  { key: 'suspended', title: 'Tạm ngưng' },
];
const REP_STATUSES = { Active: ['Đang hoạt động', 'ok'], Restricted: ['Bị hạn chế', 'w'], Banned: ['Bị cấm', 'e'] };
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const rating = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v).toFixed(1) : '—');
const place = (s) => [s?.district, s?.city].filter(Boolean).join(', ') || '—';

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
    let page = Math.max(1, Number(ctx.params?.page) || 1);
    let query = String(ctx.params?.q || '');
    let data = null; // { items, total, page, limit, counts }
    let busy = false;
    let notice = '';
    let searchTimer = null;
    let seq = 0;
    let drawerSeq = 0;
    let openDetail = null;

    const buildListPath = () => {
      const sp = new URLSearchParams({ status: tab, page: String(page), limit: String(PAGE_SIZE), sort: 'created_at.desc' });
      if (query.trim()) sp.set('q', query.trim().slice(0, 80));
      return `/admin/stores?${sp.toString()}`;
    };

    const kpi = (key, label, value, note) =>
      html`<div class="K" data-kpi="${key}"><div class="K-l">${label}</div><div class="K-v">${value}</div><div class="K-n">${note}</div></div>`;

    function renderTable(items) {
      if (!items.length) {
        const emptyMsg = tab === 'pending' ? 'Không có cửa hàng nào chờ duyệt.' : tab === 'suspended' ? 'Không có cửa hàng nào đang tạm ngưng.' : 'Không có cửa hàng phù hợp.';
        return html`<div style="padding:24px;text-align:center;color:var(--t3)">${emptyMsg}</div>`;
      }
      const rows = items.map((s) => html`<tr>
        <td><button type="button" class="bt" data-act="open" data-id="${s.id}">${s.name || 'Chưa đặt tên'}</button></td>
        <td>${s.address || '—'}</td>
        <td>${place(s)}</td>
        <td>${s.owner_name || '—'}${raw(s.owner_phone ? html`<br><small style="color:var(--t3)">${s.owner_phone}</small>` : '')}</td>
        <td>${rating(s.rating)}</td>
        <td>${s.is_verified ? html`<span class="b b-ok">Đã xác minh</span>` : html`<span class="b b-m">Chưa xác minh</span>`}</td>
        <td>${stamp(s.created_at)}</td>
      </tr>`).join('');

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
          <small style="color:var(--t3)">Trang ${page}/${totalPages} · ${num(data.total)} cửa hàng</small>
          <span style="display:flex;gap:6px">${raw(btns.join(''))}</span>
        </nav>`;
      }

      return html`<table class="tbl"><thead><tr>
        <th>Cửa hàng</th><th>Địa chỉ</th><th>Quận / thành phố</th><th>Chủ cửa hàng</th><th>Đánh giá</th><th>Xác minh</th><th>Ngày tham gia</th>
      </tr></thead><tbody>${raw(rows)}</tbody></table>${raw(pager)}`;
    }

    function drawBody() {
      const counts = data?.counts || {};
      const activeCount = num(counts.active);
      const pendingCount = num(counts.pending);
      const suspendedCount = num(counts.suspended);
      const tabCount = { active: activeCount, pending: pendingCount, suspended: suspendedCount };
      const tabs = TABS.map((t) =>
        html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-tab="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title} (${tabCount[t.key]})</button>`
      ).join('');
      const goVerify = tab === 'pending' ? html`<button type="button" class="bt bt-p" data-act="go-verify">Mở Duyệt hồ sơ</button>` : '';
      const noticeHtml = notice
        ? html`<div role="status" data-role="notice" style="margin-bottom:12px;padding:10px 14px;border:1px solid var(--warn-bd);background:var(--warn-bg);color:var(--warn);border-radius:var(--rs);font-size:.8rem">${notice}</div>`
        : '';

      const hadFocus = document.activeElement?.dataset?.role === 'search';
      body.innerHTML = html`${raw(noticeHtml)}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:16px">
          ${raw(kpi('active', 'Đang hoạt động', activeCount, 'Cửa hàng đang bán trên ứng dụng'))}
          ${raw(kpi('pending', 'Chờ duyệt', pendingCount, 'Duyệt ở màn Duyệt hồ sơ'))}
          ${raw(kpi('suspended', 'Tạm ngưng bán', suspendedCount, 'Ẩn khỏi ứng dụng cho tới khi mở lại'))}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(tabs)}</div>
        <section class="P"><div class="P-h"><span class="P-t">${TABS.find((t) => t.key === tab)?.title || 'Cửa hàng'}</span>
          <span style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${raw(goVerify)}
            <input type="search" data-role="search" aria-label="Tìm cửa hàng" placeholder="Tìm theo tên, địa chỉ" maxlength="80" style="padding:6px 10px;border:1px solid var(--bd2);border-radius:var(--rs);min-width:200px"></span></div>
          <div class="W" data-role="table">${raw(renderTable(data?.items || []))}</div></section>`;
      const searchEl = body.querySelector('[data-role="search"]');
      searchEl.value = query;
      if (hadFocus) { searchEl.focus(); searchEl.setSelectionRange(query.length, query.length); }
    }

    function detailHtml(d) {
      const s = d.store || {};
      const owner = d.owner || null;
      const partner = d.partner_profile || null;
      const wallet = d.wallet || null;
      const rep = d.reputation || null;
      const prod = d.product_summary || { total: 0, active: 0, out_of_stock: 0, by_label: { green: 0, yellow: 0, red: 0 } };
      const payout = d.payout_accounts?.current || null;
      const orders = Array.isArray(d.recent_orders) ? d.recent_orders : [];
      const auditRows = Array.isArray(d.recent_audit) ? d.recent_audit : [];

      const row = (label, value) => html`<tr><th style="text-align:left;padding:6px 0;width:42%;color:var(--t3);font-weight:600">${label}</th><td style="padding:6px 0">${value}</td></tr>`;

      let actionBtn = '';
      if (s.status === 'active') {
        actionBtn = html`<button type="button" class="bt b-e" data-act="store-status" data-status="suspended" data-id="${s.id}">Tạm ngưng bán</button>`;
      } else if (s.status === 'suspended' && s.is_verified) {
        actionBtn = html`<button type="button" class="bt bt-p" data-act="store-status" data-status="active" data-id="${s.id}">Mở bán lại</button>`;
      } else if (s.status === 'pending') {
        actionBtn = html`<button type="button" class="bt bt-p" data-act="go-verify">Đi tới Duyệt hồ sơ</button>`;
      }

      const [repText, repLevel] = own(REP_STATUSES, rep?.status) ? REP_STATUSES[rep.status] : ['—', 'm'];
      const repBlock = rep
        ? html`<div><b>Điểm uy tín: ${num(rep.trust_score)}</b> · Đánh giá TB: ${rating(rep.rating_avg)} <span class="b b-${raw(repLevel)}">${repText}</span></div>`
        : html`<span style="color:var(--t3)">Chưa có dữ liệu uy tín.</span>`;

      const walletBlock = wallet
        ? html`<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;font-size:.8rem">
            <div class="K"><div class="K-l">Số dư khả dụng</div><div class="K-v" style="font-size:1rem">${vnd(wallet.available)}</div></div>
            <div class="K"><div class="K-l">Tiền giữ chờ</div><div class="K-v" style="font-size:1rem">${vnd(wallet.held)}</div></div>
            <div class="K"><div class="K-l">Đang chờ rút</div><div class="K-v" style="font-size:1rem">${vnd(wallet.pending_withdrawals)}</div></div>
            <div class="K"><div class="K-l">Đã rút</div><div class="K-v" style="font-size:1rem">${vnd(wallet.withdrawn)}</div></div>
          </div>`
        : html`<div style="font-size:.8rem;color:var(--t3)">Chưa có dữ liệu ví.</div>`;

      const ordersHtml = orders.length
        ? html`<table class="tbl"><thead><tr><th>Mã đơn</th><th>Trạng thái</th><th>Tiền</th><th>Thời gian</th></tr></thead><tbody>${raw(
          orders.map((o) => html`<tr><td>${o.order_number || String(o.id || '').slice(0, 8)}</td><td>${raw(badge('order', o.status))}</td><td>${vnd(o.total_cents)}</td><td>${stamp(o.created_at)}</td></tr>`).join('')
        )}</tbody></table>`
        : html`<div style="font-size:.8rem;color:var(--t3)">Chưa có đơn hàng nào.</div>`;

      const auditHtml = auditRows.length
        ? auditRows.map((a) => html`<div class="DR"><div class="DR-l">${stamp(a.created_at)}</div><div class="DR-v"><b>${a.actor_name || 'Hệ thống'}</b> · ${actionLabel(a.action)}${raw(a.detail?.reason ? html`<br><small style="color:var(--t3)">Lý do: ${a.detail.reason}</small>` : '')}</div></div>`).join('')
        : html`<div style="font-size:.8rem;color:var(--t3)">Chưa có lịch sử tác động.</div>`;

      return html`<div style="padding:14px 18px" data-role="store" data-id="${s.id}">
        <h3 style="margin:0 0 8px">${s.name || 'Chưa đặt tên'}</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${raw(actionBtn)}</div>
        <table style="width:100%;font-size:.82rem;border-collapse:collapse"><tbody>
          ${raw(row('Trạng thái', raw(badge('storeStatus', s.status || 'pending'))))}
          ${raw(s.suspended_reason ? row('Lý do tạm ngưng', s.suspended_reason) : '')}
          ${raw(row('Địa chỉ', s.address || '—'))}
          ${raw(row('Quận / thành phố', place(s)))}
          ${raw(row('Giờ mở cửa', s.opening_hours || '—'))}
          ${raw(row('Xác minh', s.is_verified ? 'Đã xác minh' : 'Chưa xác minh'))}
          ${raw(row('Đánh giá', rating(s.rating)))}
          ${raw(row('Chủ cửa hàng', owner ? `${owner.full_name || '—'} · ${owner.email || '—'}${owner.phone ? ` · ${owner.phone}` : ''}` : '—'))}
          ${raw(partner ? row('Tên pháp lý', partner.legal_name || '—') : '')}
          ${raw(partner?.tax_code ? row('Mã số thuế (đã che)', partner.tax_code) : '')}
          ${raw(partner?.cccd_number ? row('CCCD đại diện (đã che)', partner.cccd_number) : '')}
          ${raw(payout ? row('Tài khoản nhận tiền', raw(html`${payout.bank_name} · ••••${payout.account_last4} ${raw(badge('payoutAccount', payout.status))}`)) : row('Tài khoản nhận tiền', 'Chưa khai báo'))}
          ${raw(row('Tham gia', stamp(s.created_at)))}
        </tbody></table>
        <h4 style="margin:16px 0 6px;font-size:.8rem">Ví cửa hàng</h4>
        ${raw(walletBlock)}
        <h4 style="margin:16px 0 6px;font-size:.8rem">Uy tín cửa hàng</h4>
        <div data-role="reputation" style="font-size:.82rem">${raw(repBlock)}</div>
        <h4 style="margin:16px 0 6px;font-size:.8rem">Tóm tắt hàng hóa</h4>
        <div style="font-size:.82rem">Tổng <b>${num(prod.total)}</b> món · Đang bán <b>${num(prod.active)}</b> · Xanh ${num(prod.by_label?.green)} · Vàng ${num(prod.by_label?.yellow)} · Đỏ ${num(prod.by_label?.red)}</div>
        <h4 style="margin:16px 0 6px;font-size:.8rem">10 đơn gần nhất</h4>
        <div class="W" data-role="orders">${raw(ordersHtml)}</div>
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
        if (quiet && data) { console.warn('[MIO] Không làm mới được danh sách cửa hàng:', err); return; }
        error(body, err, () => load());
      }
    }

    async function openStore(id, { fromDeepLink = false } = {}) {
      const mine = ++drawerSeq;
      if (!fromDeepLink) {
        ctx.ui.drawer.open(html`<div style="padding:16px">Đang tải hồ sơ 360° cửa hàng…</div>`, { title: 'Chi tiết cửa hàng' });
      }
      try {
        const detail = await api.get(`/admin/stores/${encodeURIComponent(id)}`, { signal });
        if (!alive() || mine !== drawerSeq) return;
        openDetail = detail;
        ctx.ui.drawer.open(detailHtml(detail), { title: 'Chi tiết cửa hàng' });
      } catch (err) {
        if (!alive() || mine !== drawerSeq || err?.name === 'AbortError') return;
        if (fromDeepLink && err?.status === 404) {
          notice = 'Không tìm thấy cửa hàng này.';
          drawBody();
          return;
        }
        ctx.ui.drawer.open(html`<div role="alert" style="padding:16px;color:var(--err)">${err?.message || 'Không tải được chi tiết cửa hàng.'}</div>`, { title: 'Chi tiết cửa hàng' });
      }
    }

    async function changeStatus(id, nextStatus) {
      if (busy) return;
      const name = openDetail?.store?.name || 'cửa hàng này';
      const suspending = nextStatus === 'suspended';
      const res = await ctx.ui.confirm({
        title: suspending ? `Tạm ngưng bán cửa hàng ${name}?` : `Mở bán lại cửa hàng ${name}?`,
        body: suspending
          ? 'Cửa hàng sẽ bị ẩn khỏi danh mục và khách hàng không thể đặt đơn mới cho tới khi mở bán lại.'
          : 'Cửa hàng đã xác minh sẽ hiển thị và nhận đơn trở lại.',
        danger: suspending,
        reasonRequired: suspending,
        reasonOptional: !suspending,
        reasonLabel: suspending ? 'Lý do tạm ngưng (bắt buộc, ít nhất 3 ký tự)' : 'Ghi chú (không bắt buộc)',
        confirmText: suspending ? 'Tạm ngưng bán' : 'Mở bán lại',
      });
      if (!res.ok || !alive()) return;
      busy = true;
      try {
        const payload = { status: nextStatus, ...(res.reason ? { reason: res.reason } : {}) };
        await api.post(`/admin/stores/${encodeURIComponent(id)}/status`, payload, { signal });
        if (!alive()) return;
        ctx.ui.toast(suspending ? 'Đã tạm ngưng cửa hàng' : 'Đã mở bán lại cửa hàng');
        await load({ quiet: true });
        await openStore(id);
        ctx.refreshWork();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Không cập nhật được trạng thái cửa hàng', 'err');
      } finally {
        busy = false;
      }
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => {
      if (el.dataset.tab !== tab) ctx.navigate('stores', { tab: el.dataset.tab });
    });
    delegate(root, 'click', '[data-act="go-verify"]', () => ctx.navigate('verify'));
    delegate(root, 'click', '[data-act="open"]', (_e, el) => openStore(el.dataset.id));
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
      cleanup.push(delegate(drawerEl, 'click', '[data-act="store-status"]', (_e, el) => changeStatus(el.dataset.id, el.dataset.status)));
      cleanup.push(delegate(drawerEl, 'click', '[data-act="go-verify"]', () => { ctx.ui.drawer.close(); ctx.navigate('verify'); }));
    }
    cleanup.push(() => { if (searchTimer) clearTimeout(searchTimer); drawerSeq += 1; });

    await load();
    const wanted = ctx.params?.id;
    if (wanted && alive()) {
      await openStore(wanted, { fromDeepLink: true });
    }
  },

  destroy() {
    cleanup.forEach((off) => off());
    cleanup = [];
  },
};
