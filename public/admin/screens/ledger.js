// Màn "Tiền & sổ cái": số dư các ví hệ thống, trạng thái đối soát và sổ cái bút toán (chỉ đọc, trừ "Chạy đối soát ngay").
// Bộ lọc và trang lưu trong hash (#/ledger?type=...&order=...&from=...&to=...&page=...). Không poll.
// Lệnh rút và tài khoản nhận tiền nằm ở màn "Rút tiền & chi trả" và "Duyệt hồ sơ".
import { stamp, vnd } from '../core/format.js';
import { VI } from '../core/vi.js';

const LIMIT = 25;
const TYPES = Object.keys(VI.ledger);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Tên ví do máy chủ trả (đã là nhãn, riêng ví hệ thống còn kèm mã tiếng Anh) → nhãn Việt gọn.
// Ví cửa hàng có dạng "Ví <tên cửa hàng>" nên giữ nguyên; nhãn lạ không phải ví cửa hàng không được lộ ra.
const WALLETS = {
  'Bên ngoài (khách / ngân hàng)': 'Bên ngoài',
  'Giữ chờ (escrow)': 'Tiền giữ chờ',
  'Doanh thu nền tảng': 'Doanh thu nền tảng',
  'Quỹ từ thiện': 'Quỹ từ thiện',
  external: 'Bên ngoài',
  escrow: 'Tiền giữ chờ',
  platform_revenue: 'Doanh thu nền tảng',
  charity_pool: 'Quỹ từ thiện',
};
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
export function walletLabel(name) {
  if (name == null || name === '' || name === '—') return '—';
  const s = String(name);
  if (own(WALLETS, s)) return WALLETS[s];
  return s.startsWith('Ví ') ? s : 'Ví khác';
}

// Lý do ghi kèm bút toán (metadata.reason); mã lạ thì không hiện.
const REASONS = {
  completed: 'Hoàn tất',
  late_cancel: 'Hủy muộn',
  no_show: 'Vắng mặt',
  complaint_upheld: 'Khiếu nại đúng',
  complaint_partial: 'Khiếu nại (một phần)',
  customer_free_cancel: 'Khách hủy miễn phí',
  late_payment: 'Thanh toán trễ',
  refund: 'Hoàn tiền',
};
const reasonLabel = (r) => (r && own(REASONS, r) ? REASONS[r] : '');

const RANGE_ERROR = 'Từ ngày phải trước Đến ngày.';
const money = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '—' : vnd(v));

// Hash → bộ lọc hợp lệ (giá trị ngoài danh sách bị bỏ)
function readFilters(params = {}) {
  const dateOf = (v) => (DATE_RE.test(String(v ?? '')) && Number.isFinite(Date.parse(v)) ? String(v) : '');
  const page = Math.min(100000, Math.max(1, Number.parseInt(params.page, 10) || 1));
  return {
    type: TYPES.includes(params.type) ? params.type : '',
    order: String(params.order ?? '').trim().slice(0, 60),
    from: dateOf(params.from),
    to: dateOf(params.to),
    page,
  };
}

function ledgerPath(f) {
  const q = new URLSearchParams({ page: String(f.page), limit: String(LIMIT) });
  if (f.type) q.set('type', f.type);
  if (f.order) q.set('order_number', f.order);
  if (f.from) q.set('from', `${f.from}T00:00:00+07:00`);
  if (f.to) q.set('to', `${f.to}T23:59:59.999+07:00`);
  return `/admin/ledger?${q}`;
}

export default {
  id: 'ledger',
  title: 'Tiền & sổ cái',
  group: 'HOẠT ĐỘNG',

  async render(container, ctx) {
    const { html, raw, delegate, loading, empty, error } = ctx.ui;
    const { api, signal } = ctx;
    const f = readFilters(ctx.params);

    const typeOptions = [html`<option value="">Tất cả loại</option>`]
      .concat(TYPES.map((t) => html`<option value="${t}"${raw(f.type === t ? ' selected' : '')}>${VI.ledger[t]}</option>`)).join('');

    container.innerHTML = html`<div data-screen="ledger">
      <section class="P" aria-label="Tổng quan tiền">
        <div class="P-h"><span class="P-t">TỔNG QUAN TIỀN</span>
          <div class="P-a"><button type="button" class="bt bt-p" data-act="reconcile">Chạy đối soát ngay</button></div></div>
        <div data-role="summary-body" style="padding:14px 16px"></div>
      </section>
      <section class="P" aria-label="Sổ cái">
        <div class="P-h"><span class="P-t">SỔ CÁI BÚT TOÁN</span></div>
        <form data-role="filter" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 16px">
          <select name="type" aria-label="Loại bút toán">${raw(typeOptions)}</select>
          <input name="order" placeholder="Mã đơn (ví dụ FS-…)" maxlength="60" value="${f.order}" aria-label="Mã đơn">
          <label style="font-size:.72rem;color:var(--t3)">Từ ngày <input type="date" name="from" value="${f.from}"></label>
          <label style="font-size:.72rem;color:var(--t3)">Đến ngày <input type="date" name="to" value="${f.to}"></label>
          <button type="submit" class="bt bt-p" data-act="filter">Lọc</button>
          <button type="button" class="bt" data-act="clear">Xóa lọc</button>
          <span data-role="range-error" role="alert" style="font-size:.74rem;color:var(--err)"></span>
        </form>
        <div data-role="ledger-body"></div>
      </section>
    </div>`;
    const root = container.firstElementChild;
    const summaryBody = root.querySelector('[data-role="summary-body"]');
    const ledgerBody = root.querySelector('[data-role="ledger-body"]');
    const reconcileBtn = root.querySelector('[data-act="reconcile"]');
    const alive = () => !signal.aborted && root.isConnected;
    let busy = false;
    let summaryTotals = null;

    const kpi = (key, label, value, note, color) => html`<div class="K" data-kpi="${key}">
      <div class="K-l">${label}</div><div class="K-v"${raw(color ? ` style="color:${color}"` : '')}>${value}</div><div class="K-n">${note}</div></div>`;

    function drawSummary(data) {
      const w = data?.wallets || {};
      const rc = data?.reconcile || {};
      const good = rc.ok === true;
      const grid = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px';
      const reconcileValue = rc.ok == null ? '—' : good ? 'KHỚP' : 'LỆCH';
      summaryBody.innerHTML = html`<div style="${grid}">
          ${raw(kpi('escrow', 'Tiền đang giữ chờ', money(w.escrow), 'Khách đã trả, chờ nhận hàng', 'var(--warn)'))}
          ${raw(kpi('platform', 'Doanh thu nền tảng', money(w.platform_revenue), 'Phí nền tảng đã thu'))}
          ${raw(kpi('charity', 'Quỹ từ thiện', money(w.charity_pool), 'Khách đóng góp khi đặt hàng'))}
          ${raw(kpi('reconcile', 'Đối soát sổ cái', reconcileValue,
            `Tổng số dư mọi ví: ${money(rc.total_balance)} · ${Number(rc.mismatched_wallets) || 0} ví lệch`,
            rc.ok == null ? '' : good ? 'var(--ok)' : 'var(--err)'))}
        </div>
        <div style="${grid};margin-top:12px">
          ${raw(kpi('released', 'Đã giải ngân cho cửa hàng', money(data?.released_total), 'Tổng phần cửa hàng đã nhận'))}
          ${raw(kpi('forfeited', 'Giữ lại do vắng mặt / hủy muộn', money(data?.forfeited_total), 'Cửa hàng được giữ'))}
          ${raw(kpi('refunded', 'Đã hoàn cho khách', money(data?.refunded_total), 'Hoàn sớm và khiếu nại'))}
          ${raw(kpi('stores', 'Số dư các ví cửa hàng', money(data?.store_wallets_total), 'Đã giải ngân trừ tiền đã rút'))}
        </div>
        <p style="font-size:.72rem;color:var(--t3);margin-top:10px">Sổ cái mô phỏng: mọi thay đổi tiền là một bút toán không sửa hay xóa được.</p>`;
      summaryTotals = data;
    }

    let summarySeq = 0;
    async function loadSummary({ quiet = false } = {}) {
      const mine = ++summarySeq;
      if (!quiet || !summaryTotals) loading(summaryBody);
      try {
        const data = await api.get('/admin/finance/summary', { signal });
        if (!alive() || mine !== summarySeq) return;
        drawSummary(data || {});
      } catch (err) {
        if (!alive() || mine !== summarySeq || err?.name === 'AbortError') return;
        if (quiet && summaryTotals) { console.warn('[MIO] Không làm mới được tổng quan tiền:', err); return; }
        error(summaryBody, err, () => loadSummary());
      }
    }

    function entryRow(e) {
      const reason = reasonLabel(e.reason);
      const type = own(VI.ledger, e.type) ? VI.ledger[e.type] : 'Khác';
      return html`<tr>
        <td>${stamp(e.created_at)}</td>
        <td><b>${type}</b></td>
        <td>${e.order_number || '—'}</td>
        <td>${walletLabel(e.from)} → ${walletLabel(e.to)}</td>
        <td style="text-align:right"><b>${money(e.amount)}</b></td>
        <td style="color:var(--t3)">${reason || '—'}</td></tr>`;
    }

    function drawLedger(data) {
      const items = Array.isArray(data?.items) ? data.items : [];
      const total = Number(data?.total);
      const count = Number.isFinite(total) ? total : items.length;
      const pages = Math.max(1, Math.ceil(count / LIMIT));
      if (!items.length) { empty(ledgerBody, 'Không có bút toán phù hợp.', f.page > 1 ? 'Trang này không còn dữ liệu, thử quay lại trang trước.' : 'Thử bỏ bớt bộ lọc.'); }
      else {
        ledgerBody.innerHTML = html`<div class="W"><table class="tbl" data-role="ledger-table">
          <thead><tr><th>Thời gian</th><th>Loại</th><th>Mã đơn</th><th>Ví chuyển → ví nhận</th><th style="text-align:right">Số tiền</th><th>Ghi chú</th></tr></thead>
          <tbody>${raw(items.map(entryRow).join(''))}</tbody></table></div>`;
      }
      ledgerBody.insertAdjacentHTML('beforeend', html`<div data-role="pager" style="display:flex;gap:8px;align-items:center;padding:10px 16px">
        <button type="button" class="bt" data-act="prev"${raw(f.page <= 1 ? ' disabled' : '')}>‹ Trước</button>
        <span style="font-size:.75rem">Trang ${f.page}/${pages} · ${count} bút toán</span>
        <button type="button" class="bt" data-act="next"${raw(f.page >= pages ? ' disabled' : '')}>Sau ›</button></div>`);
    }

    let ledgerSeq = 0;
    async function loadLedger() {
      const mine = ++ledgerSeq;
      if (f.from && f.to && f.from > f.to) { empty(ledgerBody, RANGE_ERROR); return; } // không gọi API khi khoảng ngày ngược
      loading(ledgerBody);
      try {
        const data = await api.get(ledgerPath(f), { signal });
        if (!alive() || mine !== ledgerSeq) return;
        drawLedger(data);
      } catch (err) {
        if (!alive() || mine !== ledgerSeq || err?.name === 'AbortError') return;
        error(ledgerBody, err, () => loadLedger());
      }
    }

    function setBusy(value) {
      busy = value;
      reconcileBtn.disabled = value;
      reconcileBtn.textContent = value ? 'Đang đối soát…' : 'Chạy đối soát ngay';
    }

    async function reconcile() {
      if (busy) return;
      const res = await ctx.ui.confirm({
        title: 'Chạy đối soát ngay?',
        body: 'Hệ thống bù bút toán còn thiếu cho các đơn đã chốt rồi kiểm tra tổng số dư mọi ví. Bút toán cũ không bị sửa hay xóa.',
        confirmText: 'Chạy đối soát',
      });
      if (!res.ok || !alive()) return;
      setBusy(true);
      try {
        const r = await api.post('/admin/finance/reconcile', undefined, { signal });
        if (!alive()) return;
        const synced = Number(r?.synced_orders) || 0;
        if (r?.ok) ctx.ui.toast(`Đối soát xong: bù ${synced} đơn · KHỚP`);
        else ctx.ui.toast(`Đối soát xong: bù ${synced} đơn · LỆCH (${Number(r?.mismatched_wallets) || 0} ví lệch)`, 'err');
        await Promise.all([loadSummary({ quiet: true }), loadLedger()]);
        ctx.refreshWork();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Đối soát thất bại', 'err');
      } finally {
        if (alive()) setBusy(false);
      }
    }

    const go = (patch) => ctx.navigate('ledger', { type: f.type, order: f.order, from: f.from, to: f.to, page: f.page, ...patch });

    delegate(root, 'submit', '[data-role="filter"]', (e, form) => {
      e.preventDefault();
      const v = (name) => String(form.elements[name]?.value ?? '').trim();
      const note = form.querySelector('[data-role="range-error"]');
      if (v('from') && v('to') && v('from') > v('to')) { note.textContent = RANGE_ERROR; return; }
      note.textContent = '';
      go({ type: v('type'), order: v('order'), from: v('from'), to: v('to'), page: '' });
    });
    delegate(root, 'click', '[data-act="clear"]', () => ctx.navigate('ledger', {}));
    delegate(root, 'click', '[data-act="prev"]', () => { if (f.page > 1) go({ page: f.page - 1 > 1 ? f.page - 1 : '' }); });
    delegate(root, 'click', '[data-act="next"]', () => go({ page: f.page + 1 }));
    delegate(root, 'click', '[data-act="reconcile"]', () => reconcile());

    await Promise.all([loadSummary(), loadLedger()]);
  },

  destroy() {},
};
