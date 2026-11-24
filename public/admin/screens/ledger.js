// Màn "Tiền & sổ cái" (Đợt 3): 2 tab (#/ledger?tab=ledger|payments).
// - Tab "Sổ cái bút toán": số dư ví hệ thống (GET /admin/finance/summary), chạy đối soát (POST /admin/finance/reconcile) và sổ cái (GET /admin/ledger).
// - Tab "Sự kiện thanh toán": tổng quan cổng/trạng thái (GET /admin/payments/summary) và bảng sự kiện phân trang (GET /admin/payments). Không poll.
import { stamp, vnd } from '../core/format.js';
import { VI } from '../core/vi.js';

const LIMIT = 25;
const TYPES = Object.keys(VI.ledger);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TABS = [
  { key: 'ledger', title: 'Sổ cái bút toán' },
  { key: 'payments', title: 'Sự kiện thanh toán' },
];
const PROVIDERS = {
  momo: 'MoMo',
  vnpay: 'VNPay',
  zalopay: 'ZaloPay',
  vietqr: 'VietQR',
  card: 'Thẻ',
  simulated: 'Mô phỏng',
};
const PE_STATUS = {
  processed: ['Đã xử lý', 'ok'],
  received: ['Đã tiếp nhận', 'i'],
  rejected: ['Bị từ chối', 'e'],
  ignored: ['Đã bỏ qua', 'm'],
};
const EXTRA_PE_STATUS = {
  paid: ['Đã thanh toán', 'ok'],
  pending: ['Chờ thanh toán', 'w'],
  refunded: ['Đã hoàn tiền', 'ok'],
  failed: ['Thanh toán lỗi', 'e'],
};

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
const own = (obj, key) => key != null && Object.prototype.hasOwnProperty.call(obj, key);
export function walletLabel(name) {
  if (name == null || name === '' || name === '—') return '—';
  const s = String(name);
  if (own(WALLETS, s)) return WALLETS[s];
  return s.startsWith('Ví ') ? s : 'Ví khác';
}

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

const providerLabel = (p) => {
  const k = String(p ?? '').toLowerCase();
  return own(PROVIDERS, k) ? PROVIDERS[k] : 'Cổng khác';
};

const RANGE_ERROR = 'Từ ngày phải trước Đến ngày.';
const money = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '—' : vnd(v));

function readLedgerFilters(params = {}) {
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

function readPaymentFilters(params = {}) {
  const prov = String(params.provider ?? '').toLowerCase();
  const st = String(params.status ?? '').toLowerCase();
  const page = Math.min(100000, Math.max(1, Number.parseInt(params.page, 10) || 1));
  return {
    provider: own(PROVIDERS, prov) ? prov : '',
    status: own(PE_STATUS, st) ? st : '',
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

function paymentsPath(pf) {
  const q = new URLSearchParams({ page: String(pf.page), limit: String(LIMIT) });
  if (pf.provider) q.set('provider', pf.provider);
  if (pf.status) q.set('status', pf.status);
  return `/admin/payments?${q}`;
}

function normalizePaySummary(rawSummary) {
  const s = rawSummary && typeof rawSummary === 'object' ? rawSummary : {};
  const statusSrc = s.by_status || s.statuses || s.status_counts || s.counts || s;
  const countOf = (obj, k) => {
    const v = obj?.[k];
    if (v && typeof v === 'object') return Number(v.count ?? v.total) || 0;
    return Number(v) || 0;
  };
  const amountOf = (obj, k) => {
    const v = obj?.[k];
    if (v && typeof v === 'object' && v.amount_cents != null) return Number(v.amount_cents) || 0;
    return null;
  };
  const byStatus = {
    processed: countOf(statusSrc, 'processed'),
    received: countOf(statusSrc, 'received'),
    rejected: countOf(statusSrc, 'rejected'),
    ignored: countOf(statusSrc, 'ignored'),
  };
  const sumStatus = byStatus.processed + byStatus.received + byStatus.rejected + byStatus.ignored;
  const total = Number.isFinite(Number(s.total)) ? Number(s.total)
    : (Number.isFinite(Number(s.total_events)) ? Number(s.total_events) : sumStatus);
  const processedAmount = s.processed_amount_cents ?? s.total_amount_cents ?? s.amount_cents ?? amountOf(statusSrc, 'processed');

  const provRaw = s.by_provider ?? s.providers ?? [];
  const providers = [];
  if (Array.isArray(provRaw)) {
    for (const item of provRaw) {
      if (!item || typeof item !== 'object') continue;
      providers.push({
        provider: item.provider || item.name || '',
        count: Number(item.count ?? item.total) || 0,
        amount: item.amount_cents ?? item.total_cents ?? item.amount ?? null,
      });
    }
  } else if (provRaw && typeof provRaw === 'object') {
    for (const [k, v] of Object.entries(provRaw)) {
      if (v && typeof v === 'object') {
        providers.push({ provider: k, count: Number(v.count ?? v.total) || 0, amount: v.amount_cents ?? v.total_cents ?? v.amount ?? null });
      } else {
        providers.push({ provider: k, count: Number(v) || 0, amount: null });
      }
    }
  }
  return { total, processedAmount, byStatus, providers };
}

export default {
  id: 'ledger',
  title: 'Tiền & sổ cái',
  group: 'HOẠT ĐỘNG',

  async render(container, ctx) {
    const { html, raw, delegate, loading, empty, error } = ctx.ui;
    const { api, signal } = ctx;
    const tab = ctx.params?.tab === 'payments' ? 'payments' : 'ledger';
    const f = readLedgerFilters(ctx.params);
    const pf = readPaymentFilters(ctx.params);

    const tabsHtml = TABS.map((t) =>
      html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-tab="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title}</button>`
    ).join('');

    const kpi = (key, labelText, value, note, color) => html`<div class="K" data-kpi="${key}">
      <div class="K-l">${labelText}</div><div class="K-v"${raw(color ? ` style="color:${color}"` : '')}>${value}</div><div class="K-n">${note}</div></div>`;

    if (tab === 'ledger') {
      const typeOptions = [html`<option value="">Tất cả loại</option>`]
        .concat(TYPES.map((t) => html`<option value="${t}"${raw(f.type === t ? ' selected' : '')}>${VI.ledger[t]}</option>`)).join('');

      container.innerHTML = html`<div data-screen="ledger">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(tabsHtml)}</div>
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
    } else {
      const providerOptions = [html`<option value="">Tất cả cổng</option>`]
        .concat(Object.keys(PROVIDERS).map((p) => html`<option value="${p}"${raw(pf.provider === p ? ' selected' : '')}>${PROVIDERS[p]}</option>`)).join('');
      const statusOptions = [html`<option value="">Tất cả trạng thái</option>`]
        .concat(Object.keys(PE_STATUS).map((s) => html`<option value="${s}"${raw(pf.status === s ? ' selected' : '')}>${PE_STATUS[s][0]}</option>`)).join('');

      container.innerHTML = html`<div data-screen="ledger">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(tabsHtml)}</div>
        <section class="P" aria-label="Tổng quan thanh toán">
          <div class="P-h"><span class="P-t">TỔNG QUAN SỰ KIỆN THANH TOÁN</span></div>
          <div data-role="payments-summary" style="padding:14px 16px"></div>
        </section>
        <section class="P" aria-label="Sự kiện thanh toán">
          <div class="P-h"><span class="P-t">SỰ KIỆN THANH TOÁN</span></div>
          <form data-role="payments-filter" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 16px">
            <select name="provider" aria-label="Cổng thanh toán">${raw(providerOptions)}</select>
            <select name="status" aria-label="Trạng thái sự kiện">${raw(statusOptions)}</select>
            <button type="submit" class="bt bt-p" data-act="pay-filter">Lọc</button>
            <button type="button" class="bt" data-act="pay-clear">Xóa lọc</button>
          </form>
          <div data-role="payments-body"></div>
        </section>
      </div>`;
    }

    const root = container.firstElementChild;
    const alive = () => !signal.aborted && root.isConnected;

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => {
      const next = el.dataset.tab === 'payments' ? 'payments' : 'ledger';
      if (next === tab) return;
      ctx.navigate('ledger', next === 'payments' ? { tab: 'payments' } : {});
    });

    if (tab === 'ledger') {
      const summaryBody = root.querySelector('[data-role="summary-body"]');
      const ledgerBody = root.querySelector('[data-role="ledger-body"]');
      const reconcileBtn = root.querySelector('[data-act="reconcile"]');
      let busy = false;
      let summaryTotals = null;

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
        if (!items.length) {
          empty(ledgerBody, 'Không có bút toán phù hợp.', f.page > 1 ? 'Trang này không còn dữ liệu, thử quay lại trang trước.' : 'Thử bỏ bớt bộ lọc.');
        } else {
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
        if (f.from && f.to && f.from > f.to) { empty(ledgerBody, RANGE_ERROR); return; }
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
      return;
    }

    // ---------- Tab: Sự kiện thanh toán ----------
    const paySummaryBox = root.querySelector('[data-role="payments-summary"]');
    const paymentsBody = root.querySelector('[data-role="payments-body"]');

    const peStatusBadge = (st) => {
      const k = String(st ?? '').toLowerCase();
      const [text, lv] = own(PE_STATUS, k) ? PE_STATUS[k] : (own(EXTRA_PE_STATUS, k) ? EXTRA_PE_STATUS[k] : ['Khác', 'm']);
      return html`<span class="b b-${raw(lv)}">${text}</span>`;
    };

    function drawPaySummary(rawData) {
      const s = normalizePaySummary(rawData);
      const grid = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px';
      const provHtml = s.providers.length
        ? html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px" data-role="provider-chips">${raw(
          s.providers.map((p) => html`<span class="b b-i">${providerLabel(p.provider)}: ${p.count} giao dịch${p.amount != null ? ` · ${money(p.amount)}` : ''}</span>`).join('')
        )}</div>`
        : '';
      paySummaryBox.innerHTML = html`<div style="${grid}">
          ${raw(kpi('pay-total', 'Tổng sự kiện', String(s.total), s.processedAmount != null ? `Tổng tiền đã xử lý: ${money(s.processedAmount)}` : 'Toàn bộ thông báo từ cổng thanh toán'))}
          ${raw(kpi('pay-processed', 'Đã xử lý', String(s.byStatus.processed), 'Khớp đơn và ghi nhận hợp lệ', 'var(--ok)'))}
          ${raw(kpi('pay-received', 'Đã tiếp nhận', String(s.byStatus.received), 'Đang chờ xử lý hoàn tất', 'var(--warn)'))}
          ${raw(kpi('pay-rejected', 'Bị từ chối', String(s.byStatus.rejected), 'Sai số tiền hoặc không khớp đơn', s.byStatus.rejected > 0 ? 'var(--err)' : ''))}
        </div>${raw(provHtml)}`;
    }

    let paySumSeq = 0;
    async function loadPaySummary() {
      const mine = ++paySumSeq;
      loading(paySummaryBox);
      try {
        const data = await api.get('/admin/payments/summary', { signal });
        if (!alive() || mine !== paySumSeq) return;
        drawPaySummary(data);
      } catch (err) {
        if (!alive() || mine !== paySumSeq || err?.name === 'AbortError') return;
        error(paySummaryBox, err, () => loadPaySummary());
      }
    }

    function paymentRow(p) {
      const orderNum = p.order_number || p.orders?.order_number || p.order?.order_number || p.result?.order_number || (p.order_id ? String(p.order_id).slice(0, 8) : '—');
      const amt = p.amount_cents != null ? money(p.amount_cents) : money(p.amount);
      return html`<tr>
        <td>${stamp(p.created_at || p.processed_at)}</td>
        <td><b>${providerLabel(p.provider)}</b>${raw(p.provider_txn_id ? html`<br><small style="color:var(--t3)">${p.provider_txn_id}</small>` : '')}</td>
        <td>${orderNum}</td>
        <td style="text-align:right"><b>${amt}</b></td>
        <td>${raw(peStatusBadge(p.status))}</td>
      </tr>`;
    }

    function drawPayments(data) {
      const items = Array.isArray(data?.items) ? data.items : [];
      const pg = data?.pagination || {};
      const totalRaw = Number(data?.total ?? pg.total);
      const count = Number.isFinite(totalRaw) ? totalRaw : items.length;
      const pages = Math.max(1, Math.ceil(count / LIMIT));
      if (!items.length) {
        empty(paymentsBody, 'Không có sự kiện thanh toán phù hợp.', pf.page > 1 ? 'Trang này không còn dữ liệu, thử quay lại trang trước.' : 'Thử bỏ bớt bộ lọc.');
      } else {
        paymentsBody.innerHTML = html`<div class="W"><table class="tbl" data-role="payments-table">
          <thead><tr><th>Thời gian</th><th>Cổng thanh toán</th><th>Mã đơn</th><th style="text-align:right">Số tiền</th><th>Trạng thái</th></tr></thead>
          <tbody>${raw(items.map(paymentRow).join(''))}</tbody></table></div>`;
      }
      paymentsBody.insertAdjacentHTML('beforeend', html`<div data-role="payments-pager" style="display:flex;gap:8px;align-items:center;padding:10px 16px">
        <button type="button" class="bt" data-act="pay-prev"${raw(pf.page <= 1 ? ' disabled' : '')}>‹ Trước</button>
        <span style="font-size:.75rem">Trang ${pf.page}/${pages} · ${count} sự kiện</span>
        <button type="button" class="bt" data-act="pay-next"${raw(pf.page >= pages ? ' disabled' : '')}>Sau ›</button></div>`);
    }

    let paySeq = 0;
    async function loadPayments() {
      const mine = ++paySeq;
      loading(paymentsBody);
      try {
        const data = await api.get(paymentsPath(pf), { signal });
        if (!alive() || mine !== paySeq) return;
        drawPayments(data);
      } catch (err) {
        if (!alive() || mine !== paySeq || err?.name === 'AbortError') return;
        error(paymentsBody, err, () => loadPayments());
      }
    }

    const goPay = (patch) => {
      const next = { tab: 'payments', provider: pf.provider, status: pf.status, page: pf.page, ...patch };
      ctx.navigate('ledger', {
        tab: 'payments',
        provider: next.provider || '',
        status: next.status || '',
        page: Number(next.page) > 1 ? next.page : '',
      });
    };

    delegate(root, 'submit', '[data-role="payments-filter"]', (e, form) => {
      e.preventDefault();
      const v = (name) => String(form.elements[name]?.value ?? '').trim();
      goPay({ provider: v('provider'), status: v('status'), page: 1 });
    });
    delegate(root, 'click', '[data-act="pay-clear"]', () => ctx.navigate('ledger', { tab: 'payments' }));
    delegate(root, 'click', '[data-act="pay-prev"]', () => { if (pf.page > 1) goPay({ page: pf.page - 1 }); });
    delegate(root, 'click', '[data-act="pay-next"]', () => goPay({ page: pf.page + 1 }));

    await Promise.all([loadPaySummary(), loadPayments()]);
  },

  destroy() {},
};
