// Màn "Đơn hàng" (Đợt 3): danh sách toàn sàn qua GET /admin/orders (tìm mã đơn / SĐT / tên khách, lọc trạng thái, phân trang),
// ngăn kéo chi tiết GET /admin/orders/:id (món, tiền, tiến trình, payment_events, ledger_entries, complaints, messages chỉ đọc, refund_capability),
// can thiệp trực tiếp (POST /admin/orders/:id/status, POST /admin/orders/:id/note) và hỗ trợ #/orders?id=<id>. Poll 60 giây.
import { vnd, stamp, left, maskPhone } from '../core/format.js';
import { isPollFailure } from '../core/poll.js';
import { buildHash } from '../core/router.js';
import { VI, badge } from '../core/vi.js';
import { drawer } from '../core/ui.js';

const REFRESH_MS = 60000;
const LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 250;
const STATUSES = Object.keys(VI.order);
const WITH_DEADLINE = new Set(['pending', 'confirmed', 'ready']);
const LEVEL = { ok: 'ok', warn: 'w', err: 'e', m: 'm' };

const PAYMENT_STATUS = {
  pending: 'Chờ thanh toán',
  paid: 'Đã thanh toán',
  refunded: 'Đã hoàn tiền',
  partially_refunded: 'Hoàn một phần',
  failed: 'Thanh toán lỗi',
};
const PAYMENT_METHOD = {
  momo: 'MoMo',
  zalopay: 'ZaloPay',
  vnpay: 'VNPay',
  card: 'Thẻ',
  vietqr: 'VietQR',
  simulated: 'Mô phỏng',
  cod: 'Tiền mặt',
};
const PE_STATUS = {
  received: ['Đã tiếp nhận', 'i'],
  processed: ['Đã xử lý', 'ok'],
  rejected: ['Bị từ chối', 'e'],
  ignored: ['Đã bỏ qua', 'm'],
  paid: ['Đã thanh toán', 'ok'],
  pending: ['Đang chờ', 'w'],
  refunded: ['Đã hoàn tiền', 'ok'],
  failed: ['Thất bại', 'e'],
};
const CANCEL_REASON = {
  customer_free_cancel: 'Khách hủy miễn phí',
  late_cancel: 'Hủy muộn',
  no_show: 'Khách vắng mặt',
  payment_provider_error: 'Lỗi cổng thanh toán',
  payment_timeout: 'Quá hạn thanh toán',
  admin_cancel: 'Admin hủy đơn',
  store_cancel: 'Cửa hàng hủy',
};
const CANCELLED_BY = { customer: 'Khách hủy', store: 'Cửa hàng hủy', system: 'Hệ thống hủy', admin: 'Admin hủy' };
const SETTLEMENT = {
  none: 'Chưa giữ tiền',
  held: 'Đang giữ tiền',
  released: 'Đã giải ngân cửa hàng',
  forfeited: 'Giữ lại cho cửa hàng',
  refunded: 'Đã hoàn khách',
  partially_refunded: 'Hoàn một phần',
};
const SENDER = { customer: 'Khách', partner: 'Cửa hàng', admin: 'Admin', system: 'Hệ thống' };
const EVENT_LABELS = {
  admin_action: 'Can thiệp của Admin',
  admin_note: 'Ghi chú của Admin',
  note: 'Ghi chú nội bộ',
  status_change: 'Cập nhật trạng thái',
  status_changed: 'Cập nhật trạng thái',
  stock_restored: 'Đã hoàn kho',
  stock_not_restored: 'Không hoàn kho (cận hạn)',
  stock_skip: 'Không hoàn kho (cận hạn)',
  payment_paid: 'Khách đã thanh toán',
  payment_refunded: 'Đã hoàn tiền',
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

const own = (map, key) => key != null && Object.prototype.hasOwnProperty.call(map, key);
const label = (map, key, fallback = '—') => (own(map, key) ? map[key] : fallback);
const idShort = (id) => String(id ?? '').slice(0, 8) || '—';
const isRawCode = (s) => typeof s === 'string' && (/^[a-z0-9_.-]+$/.test(s) || /\bcents\b/i.test(s));
const safeCancelReason = (r) => {
  if (!r) return '';
  if (own(CANCEL_REASON, r)) return CANCEL_REASON[r];
  return isRawCode(r) ? 'Lý do khác' : String(r);
};
const walletText = (w) => {
  if (!w || w === '—') return '—';
  const s = String(w);
  if (own(WALLETS, s)) return WALLETS[s];
  return s.startsWith('Ví ') ? s : 'Ví cửa hàng';
};
const safePhone = (p) => {
  const s = String(p ?? '').trim();
  if (!s) return '';
  return s.includes('*') || s.includes('•') ? s : maskPhone(s);
};
const customerNameOf = (o) => o?.customer?.full_name || o?.customer_name || '—';
const customerPhoneOf = (o) => safePhone(o?.customer?.phone || o?.customer_phone || '');
const storeNameOf = (o) => o?.stores?.name || o?.store?.name || o?.store_name || '—';

function stripSecrets(rawOrder) {
  if (!rawOrder || typeof rawOrder !== 'object') return {};
  const copy = { ...rawOrder };
  delete copy.qr_code;
  if (copy.status !== 'completed') delete copy.pickup_code;
  return copy;
}

function normalizeDetail(detail, base = {}) {
  const cleanBase = stripSecrets(base);
  if (!detail || typeof detail !== 'object') return cleanBase;
  const core = detail.order && typeof detail.order === 'object' ? detail.order : detail;
  const merged = stripSecrets({ ...cleanBase, ...core });
  merged.customer = detail.customer ?? core.customer ?? cleanBase.customer ?? null;
  merged.store = detail.store ?? core.store ?? core.stores ?? cleanBase.stores ?? cleanBase.store ?? null;
  merged.stores = merged.store;
  merged.order_items = Array.isArray(detail.items) ? detail.items
    : Array.isArray(detail.order_items) ? detail.order_items
    : Array.isArray(core.order_items) ? core.order_items
    : Array.isArray(core.items) ? core.items
    : Array.isArray(cleanBase.order_items) ? cleanBase.order_items : [];
  merged.events = Array.isArray(detail.events) ? detail.events
    : Array.isArray(detail.order_events) ? detail.order_events
    : Array.isArray(core.events) ? core.events
    : Array.isArray(core.order_events) ? core.order_events : [];
  merged.payment_events = Array.isArray(detail.payment_events) ? detail.payment_events
    : Array.isArray(core.payment_events) ? core.payment_events : [];
  merged.ledger_entries = Array.isArray(detail.ledger_entries) ? detail.ledger_entries
    : Array.isArray(detail.ledger) ? detail.ledger
    : Array.isArray(core.ledger_entries) ? core.ledger_entries
    : Array.isArray(core.ledger) ? core.ledger : [];
  merged.complaints = Array.isArray(detail.complaints) ? detail.complaints
    : detail.complaint ? [detail.complaint]
    : Array.isArray(core.complaints) ? core.complaints
    : core.complaint ? [core.complaint] : [];
  const rawMsgs = detail.messages ?? core.messages;
  merged.messages = Array.isArray(rawMsgs) ? rawMsgs
    : Array.isArray(rawMsgs?.messages) ? rawMsgs.messages
    : Array.isArray(rawMsgs?.items) ? rawMsgs.items : [];
  merged.chat_forbidden = Boolean(detail.chat_forbidden ?? core.chat_forbidden ?? rawMsgs?.forbidden);
  merged.refund_capability = detail.refund_capability ?? core.refund_capability ?? null;
  return merged;
}

let cleanup = [];

export default {
  id: 'orders',
  title: 'Đơn hàng',
  group: 'HOẠT ĐỘNG',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;
    this.destroy();

    container.innerHTML = html`<div data-screen="orders"><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    const status = STATUSES.includes(ctx.params?.status) ? ctx.params.status : '';
    const pageParam = Number.parseInt(ctx.params?.page, 10);
    let page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
    let query = String(ctx.params?.q ?? '');
    let data = null; // { items, total, page, hasNext }
    let notice = '';
    let busy = false;
    let searchTimer = null;
    let openDetail = null;

    const go = (next) => {
      const nextStatus = next.status ?? status;
      const nextQ = (next.q ?? query).trim();
      const nextPage = next.page ?? 1;
      ctx.navigate('orders', {
        status: nextStatus || undefined,
        q: nextQ || undefined,
        page: nextPage > 1 ? nextPage : undefined,
      });
    };

    const buildListPath = () => {
      const sp = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (status) sp.set('status', status);
      if (query.trim()) sp.set('q', query.trim().slice(0, 80));
      return `/admin/orders?${sp.toString()}`;
    };

    function deadlineCell(o) {
      if (!WITH_DEADLINE.has(o.status) || !o.pickup_deadline) return '—';
      const l = left(o.pickup_deadline);
      return html`<span class="b b-${raw(LEVEL[l.level] || 'm')}">${l.text}</span>`;
    }

    function rowHtml(o) {
      const cPhone = customerPhoneOf(o);
      return html`<tr data-act="open" data-id="${o.id}"><td><b>${o.order_number ? `#${o.order_number}` : idShort(o.id)}</b></td>
        <td>${customerNameOf(o)}${raw(cPhone ? html`<br><small style="color:var(--t3)">${cPhone}</small>` : '')}</td>
        <td>${storeNameOf(o)}</td><td>${vnd(o.total_cents)}</td>
        <td>${raw(o.policy_label && own(VI.label, o.policy_label) ? badge('label', o.policy_label) : '—')}</td>
        <td>${raw(own(VI.order, o.status) ? badge('order', o.status) : html`<span class="b b-m">Khác</span>`)}</td>
        <td>${stamp(o.created_at)}</td><td>${raw(deadlineCell(o))}</td></tr>`;
    }

    function drawBody() {
      const tabs = [{ key: '', title: 'Tất cả' }, ...STATUSES.map((k) => ({ key: k, title: VI.order[k][0] }))]
        .map((t) => html`<button type="button" class="bt${raw(status === t.key ? ' bt-p' : '')}" data-act="tab" data-status="${t.key}"${raw(status === t.key ? ' aria-current="page"' : '')}>${t.title}</button>`).join('');
      const items = data?.items || [];
      const cur = data?.page || page;
      const total = data?.total;
      const hasNext = Boolean(data?.hasNext);
      const rows = items.length
        ? items.map(rowHtml).join('')
        : html`<tr><td colspan="8" style="text-align:center;color:var(--t3);padding:18px;cursor:default">Không có đơn nào${raw(status ? html` ở trạng thái "${VI.order[status][0]}"` : '')}${raw(query.trim() ? html` khớp từ khóa "${query.trim()}"` : '')}.</td></tr>`;
      const head = ['Mã đơn', 'Khách', 'Cửa hàng', 'Tổng tiền', 'Nhãn', 'Trạng thái', 'Tạo lúc', 'Hạn lấy hàng'].map((h) => html`<th>${h}</th>`).join('');
      const noticeHtml = notice
        ? html`<div role="status" data-role="notice" style="margin-bottom:12px;padding:10px 14px;border:1px solid var(--warn-bd);background:var(--warn-bg);color:var(--warn);border-radius:var(--rs);font-size:.8rem">${notice}</div>`
        : '';
      const hadFocus = document.activeElement?.dataset?.role === 'search';
      body.innerHTML = html`${raw(noticeHtml)}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(tabs)}</div>
        <section class="P"><div class="P-h"><span class="P-t">Đơn hàng${raw(total != null ? html` (${total})` : '')}</span>
          <span class="P-a" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input type="search" data-role="search" aria-label="Tìm đơn hàng" placeholder="Tìm mã đơn, SĐT, tên khách" maxlength="80" style="padding:6px 10px;border:1px solid var(--bd2);border-radius:var(--rs);min-width:220px">
            <button type="button" class="bt" data-act="prev"${raw(cur <= 1 ? ' disabled' : '')}>Trước</button>
            <span style="align-self:center;font-size:.72rem;color:var(--t3)">Trang ${cur}</span>
            <button type="button" class="bt" data-act="next"${raw(hasNext ? '' : ' disabled')}>Sau</button></span></div>
          <div class="W"><table class="tbl" data-role="orders-table"><thead><tr>${raw(head)}</tr></thead><tbody>${raw(rows)}</tbody></table></div></section>`;
      const searchEl = body.querySelector('[data-role="search"]');
      searchEl.value = query;
      if (hadFocus) {
        searchEl.focus();
        searchEl.setSelectionRange(query.length, query.length);
      }
    }

    let seq = 0;
    async function draw({ quiet = false, rethrow = quiet } = {}) {
      const mine = ++seq;
      if (!quiet || !data) loading(body);
      try {
        const res = await api.get(buildListPath(), { signal });
        if (!alive() || mine !== seq) return;
        const items = (Array.isArray(res?.items) ? res.items : []).map(stripSecrets);
        const pg = res?.pagination || {};
        const total = Number.isFinite(Number(res?.total)) ? Number(res.total) : (Number.isFinite(Number(pg.total)) ? Number(pg.total) : null);
        const curPage = Number(res?.page || pg.page) || page;
        const curLimit = Number(res?.limit || pg.limit) || LIMIT;
        const hasNext = typeof pg.has_next_page === 'boolean'
          ? pg.has_next_page
          : (total != null ? curPage * curLimit < total : items.length >= curLimit);
        data = { items, total, page: curPage, hasNext };
        drawBody();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet) {
          if (data) console.warn('[MIO] Không làm mới được danh sách đơn:', err);
          else error(body, err, () => draw());
          if (rethrow && isPollFailure(err)) throw err;
          return;
        }
        error(body, err, () => draw());
      }
    }

    // ---------- Ngăn kéo chi tiết ----------
    const row = (k, v) => html`<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0"><span style="color:var(--t3)">${k}</span><span style="text-align:right">${raw(v)}</span></div>`;
    const sec = (title, inner) => html`<section style="margin-top:14px"><div style="font-weight:700;margin-bottom:6px">${title}</div>${raw(inner)}</section>`;
    const peBadge = (st) => {
      const [text, lv] = own(PE_STATUS, st) ? PE_STATUS[st] : ['Khác', 'm'];
      return html`<span class="b b-${raw(lv)}">${text}</span>`;
    };

    function timeline(o) {
      const reasonStr = safeCancelReason(o.cancel_reason);
      const steps = [
        [o.created_at, 'Tạo đơn'],
        [o.paid_at, 'Đã thanh toán'],
        [o.completed_at, 'Hoàn thành'],
        [o.no_show_at, 'Khách vắng mặt'],
        [o.cancelled_at, `Đã hủy${o.cancelled_by ? ` · ${label(CANCELLED_BY, o.cancelled_by, '')}` : ''}${reasonStr ? ` · ${reasonStr}` : ''}`],
      ].filter(([at]) => at).sort((a, b) => new Date(a[0]) - new Date(b[0]));

      for (const ev of o.events || []) {
        const title = label(EVENT_LABELS, ev.event_type, 'Ghi nhận hệ thống');
        const noteText = ev.detail?.note || ev.detail?.reason || ev.metadata?.note || ev.metadata?.reason || ev.note || '';
        const cleanNote = noteText && !isRawCode(String(noteText)) ? ` — ${String(noteText)}` : '';
        if (ev.created_at) steps.push([ev.created_at, `${title}${cleanNote}`]);
      }
      steps.sort((a, b) => new Date(a[0]) - new Date(b[0]));
      if (o.pickup_deadline) steps.push([o.pickup_deadline, 'Hạn lấy hàng']);
      return steps.length
        ? steps.map(([at, text]) => html`<div style="padding:3px 0"><small style="color:var(--t3)">${stamp(at)}</small> ${text}</div>`).join('')
        : html`<span style="color:var(--t3)">Chưa có mốc thời gian.</span>`;
    }

    function refundCapabilityText(o) {
      const rc = o.refund_capability;
      const amt = Number(rc?.refundable_cents ?? rc?.max_refund_cents ?? rc?.amount_cents);
      const rcReason = rc?.reason && !isRawCode(String(rc.reason)) ? String(rc.reason) : '';
      if (rc?.can_cancel_refund) {
        return html`<span class="b b-ok">Có thể hủy & hoàn tiền${Number.isFinite(amt) && amt > 0 ? ` (${vnd(amt)})` : ''}</span>${raw(rcReason ? html`<br><small style="color:var(--t3)">${rcReason}</small>` : '')}`;
      }
      if (rc?.via_complaint_only || o.status === 'completed') {
        return html`<span class="b b-w">Đơn đã hoàn thành — chỉ hoàn tiền qua Khiếu nại</span>`;
      }
      if (rcReason) {
        return html`<span class="b b-m">${rcReason}</span>`;
      }
      if (o.status === 'cancelled' && o.payment_status === 'refunded') {
        return html`<span class="b b-m">Đã hoàn tiền cho khách</span>`;
      }
      return html`<span class="b b-m">Không áp dụng hoàn tiền trực tiếp</span>`;
    }

    function paymentEventsHtml(list) {
      if (!list?.length) return html`<span style="color:var(--t3)">Chưa có sự kiện thanh toán.</span>`;
      return list.map((pe) => {
        const prov = label(PAYMENT_METHOD, String(pe.provider || '').toLowerCase(), 'Cổng khác');
        const amt = pe.amount_cents != null ? vnd(pe.amount_cents) : (pe.amount != null ? vnd(pe.amount) : '—');
        return html`<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid var(--bg3)">
          <span><b>${prov}</b> · <small style="color:var(--t3)">${pe.provider_txn_id || '—'}</small><br><small style="color:var(--t3)">${stamp(pe.processed_at || pe.created_at)}</small></span>
          <span style="text-align:right"><b>${amt}</b><br>${raw(peBadge(pe.status))}</span>
        </div>`;
      }).join('');
    }

    function ledgerEntriesHtml(list) {
      if (!list?.length) return html`<span style="color:var(--t3)">Chưa có bút toán sổ cái.</span>`;
      return list.map((le) => {
        const tKey = le.type || le.entry_type;
        const tLabel = own(VI.ledger, tKey) ? VI.ledger[tKey] : 'Bút toán khác';
        const fromW = walletText(le.from || le.from_wallet_label || le.from_wallet);
        const toW = walletText(le.to || le.to_wallet_label || le.to_wallet);
        const amt = vnd(le.amount ?? le.amount_cents ?? 0);
        return html`<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid var(--bg3)">
          <span><b>${tLabel}</b><br><small style="color:var(--t3)">${fromW} → ${toW} · ${stamp(le.created_at)}</small></span>
          <b style="white-space:nowrap">${amt}</b>
        </div>`;
      }).join('');
    }

    function complaintsHtml(list) {
      if (!list?.length) return html`<span style="color:var(--t3)">Không có khiếu nại.</span>`;
      return list.map((c) => {
        const stBadge = own(VI.complaint, c.status) ? badge('complaint', c.status) : html`<span class="b b-m">Khác</span>`;
        const rsn = own(VI.complaintReason, c.reason_code) ? VI.complaintReason[c.reason_code] : 'Khiếu nại';
        const rf = Number(c.refund_cents) > 0 ? html` · hoàn ${vnd(c.refund_cents)}` : '';
        return html`<div style="padding:4px 0;border-bottom:1px solid var(--bg3)">
          <div>${raw(stBadge)} <b>${rsn}</b>${raw(rf)}</div>
          ${raw(c.issue ? html`<div style="color:var(--t2);margin-top:2px">${c.issue}</div>` : '')}
        </div>`;
      }).join('');
    }

    function messagesHtml(o) {
      if (o.chat_forbidden) return html`Chỉ xem được chat khi đơn có khiếu nại`;
      const msgs = Array.isArray(o.messages) ? o.messages : [];
      if (!msgs.length) return html`Không có tin nhắn.`;
      return msgs.map((m) => html`<div style="margin:3px 0"><strong>${label(SENDER, m.sender_role, 'Hệ thống')}</strong> <small style="color:var(--t3)">${stamp(m.created_at)}</small><br>${m.body || m.content || ''}</div>`).join('');
    }

    function actionsHtml(o) {
      const rc = o.refund_capability || {};
      const canCancel = Boolean(rc.can_cancel_refund || rc.can_cancel || ['pending', 'confirmed', 'ready'].includes(o.status));
      const canNoShow = Boolean(rc.can_mark_no_show || o.can_mark_no_show || ['confirmed', 'ready'].includes(o.status));
      const canComplete = Boolean(rc.can_complete || o.can_complete || ['confirmed', 'ready'].includes(o.status));
      const btns = [];
      if (canCancel) btns.push(html`<button type="button" class="bt b-e" data-act="order-status" data-status="cancelled" data-id="${o.id}">Hủy & hoàn tiền</button>`);
      if (canNoShow) btns.push(html`<button type="button" class="bt b-e" data-act="order-status" data-status="no_show" data-id="${o.id}">Đánh dấu vắng mặt</button>`);
      if (canComplete) btns.push(html`<button type="button" class="bt bt-p" data-act="order-status" data-status="completed" data-id="${o.id}">Hoàn tất thay cửa hàng</button>`);
      btns.push(html`<button type="button" class="bt" data-act="order-note" data-id="${o.id}">Thêm ghi chú</button>`);
      return html`<div style="display:flex;gap:6px;flex-wrap:wrap" data-role="admin-actions">${raw(btns.join(' '))}</div>`;
    }

    function orderBody(o, warnNote) {
      const items = (Array.isArray(o.order_items) ? o.order_items : []).map((i) => html`<tr style="cursor:default"><td>${i.product_name || i.name || '—'}</td><td>× ${i.quantity ?? '—'}</td><td>${vnd(i.unit_price_cents ?? i.price_cents ?? 0)}</td></tr>`).join('');
      const money = [row('Tạm tính', vnd(o.subtotal_cents)), row('Giảm giá', vnd(o.discount_cents))];
      if (Number(o.donation_cents) > 0) money.push(row('Quyên góp thêm', vnd(o.donation_cents)));
      if (Number(o.platform_fee_cents) > 0) money.push(row('Phí nền tảng', vnd(o.platform_fee_cents)));
      money.push(html`<div style="border-top:1px solid var(--bd);margin-top:4px;padding-top:4px;font-weight:700">${raw(row('Tổng', vnd(o.total_cents)))}</div>`);
      const pay = [
        row('Trạng thái', html`${label(PAYMENT_STATUS, o.payment_status)}`),
        row('Phương thức', html`${label(PAYMENT_METHOD, String(o.payment_method || '').toLowerCase())}`),
      ];
      if (label(SETTLEMENT, o.settlement_status, '')) pay.push(row('Đối soát', html`${label(SETTLEMENT, o.settlement_status)}`));
      pay.push(row('Hoàn tiền', refundCapabilityText(o)));
      const cPhone = customerPhoneOf(o);
      return html`<div data-order="${o.id}" data-role="order-detail" style="padding:16px 18px;font-size:.8rem">
        ${raw(warnNote ? html`<p style="color:var(--warn)">${warnNote}</p>` : '')}
        <div>${raw(own(VI.order, o.status) ? badge('order', o.status) : html`<span class="b b-m">Khác</span>`)} ${raw(o.policy_label && own(VI.label, o.policy_label) ? badge('label', o.policy_label) : '')}</div>
        ${raw(row('Khách', html`${customerNameOf(o)}${cPhone ? html` · ${cPhone}` : ''}`))}
        ${raw(row('Cửa hàng', html`${storeNameOf(o)}`))}
        ${raw(row('Tạo lúc', html`${stamp(o.created_at)}`))}
        ${raw(sec('Món đã đặt', html`<table data-role="items"><tbody>${raw(items || html`<tr><td>—</td></tr>`)}</tbody></table>`))}
        ${raw(sec('Tiền', money.join('')))}
        ${raw(sec('Tiến trình', timeline(o)))}
        ${raw(sec('Thanh toán & khả năng hoàn', pay.join('')))}
        ${raw(sec('Sự kiện thanh toán', html`<div data-role="payment-events">${raw(paymentEventsHtml(o.payment_events))}</div>`))}
        ${raw(sec('Bút toán sổ cái', html`<div data-role="ledger-entries">${raw(ledgerEntriesHtml(o.ledger_entries))}</div>`))}
        ${raw(sec('Khiếu nại', html`<div data-role="complaints">${raw(complaintsHtml(o.complaints))}</div>`))}
        ${raw(sec('Chat với cửa hàng (chỉ xem)', html`<div data-role="chat" data-order="${o.id}" style="font-size:.76rem;color:var(--t2)">${raw(messagesHtml(o))}</div>`))}
        ${raw(sec('Thao tác của Admin', actionsHtml(o)))}
      </div>`;
    }

    let drawerSeq = 0;
    async function openOrder(id, { fromDeepLink = false, refresh = false } = {}) {
      if (!id) return;
      const base = data?.items.find((o) => o.id === id) || (openDetail?.id === id ? openDetail : null);
      const mine = ++drawerSeq;
      const initialTitle = base?.order_number ? `Đơn #${base.order_number}` : `Đơn ${idShort(id)}`;
      if (!fromDeepLink && !refresh) {
        drawer.open(html`<div data-order="${id}" style="padding:16px 18px"><div aria-busy="true" class="skeleton" style="height:14px"></div></div>`, { title: initialTitle });
      }
      let order = base ? normalizeDetail(null, base) : null;
      let warnNote = '';
      try {
        const detail = await api.get(`/admin/orders/${encodeURIComponent(id)}`, { signal });
        order = normalizeDetail(detail, base || { id });
      } catch (err) {
        if (!alive() || mine !== drawerSeq || err?.name === 'AbortError') return;
        if (fromDeepLink && err?.status === 404) {
          notice = 'Không tìm thấy đơn hàng này.';
          drawBody();
          return;
        }
        if (!order) {
          drawer.open(html`<div role="alert" style="padding:16px;color:var(--err)">${err?.message || 'Không tải được chi tiết đơn hàng.'}</div>`, { title: initialTitle });
          return;
        }
        warnNote = 'Không tải được chi tiết mới nhất, đang hiện dữ liệu từ danh sách.';
      }
      if (!alive() || mine !== drawerSeq) return;
      if (!fromDeepLink) {
        const el = document.getElementById('drawer');
        if (!el?.classList.contains('open') || !el.querySelector(`[data-order="${id}"]`)) return;
      }
      openDetail = order;
      const finalTitle = order.order_number ? `Đơn #${order.order_number}` : initialTitle;
      drawer.open(orderBody(order, warnNote), { title: finalTitle });
    }

    const STATUS_META = {
      cancelled: {
        title: 'Hủy đơn & hoàn tiền?',
        body: 'Đơn hàng sẽ bị hủy bởi Admin, hoàn tiền về cho khách (nếu đã thanh toán) và ghi vào Nhật ký.',
        danger: true,
        reasonLabel: 'Lý do hủy đơn (bắt buộc, ít nhất 3 ký tự)',
        confirmText: 'Hủy & hoàn tiền',
        toast: 'Đã hủy đơn và xử lý hoàn tiền',
      },
      no_show: {
        title: 'Đánh dấu khách vắng mặt?',
        body: 'Đơn chuyển sang Khách vắng mặt, giải ngân theo quy tắc và tính vào lịch sử vắng mặt của khách.',
        danger: true,
        reasonLabel: 'Lý do đánh dấu vắng mặt (bắt buộc, ít nhất 3 ký tự)',
        confirmText: 'Đánh dấu vắng mặt',
        toast: 'Đã đánh dấu khách vắng mặt',
      },
      completed: {
        title: 'Hoàn tất đơn thay cửa hàng?',
        body: 'Đơn chuyển sang Hoàn thành và giải ngân tiền giữ chờ cho cửa hàng. Chỉ thực hiện khi đã xác nhận khách nhận hàng.',
        danger: false,
        reasonLabel: 'Lý do hoàn tất thay (bắt buộc, ít nhất 3 ký tự)',
        confirmText: 'Hoàn tất đơn',
        toast: 'Đã hoàn tất đơn hàng',
      },
    };

    async function interveneStatus(id, nextStatus) {
      if (busy || !own(STATUS_META, nextStatus)) return;
      const meta = STATUS_META[nextStatus];
      const res = await ctx.ui.confirm({
        title: meta.title,
        body: meta.body,
        danger: meta.danger,
        reasonRequired: true,
        reasonLabel: meta.reasonLabel,
        confirmText: meta.confirmText,
      });
      if (!res.ok || !alive()) return;
      busy = true;
      try {
        await api.post(`/admin/orders/${encodeURIComponent(id)}/status`, { status: nextStatus, reason: res.reason }, { signal });
        if (!alive()) return;
        ctx.ui.toast(meta.toast);
        await draw({ quiet: true, rethrow: false });
        await openOrder(id, { refresh: true });
        ctx.refreshWork();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Không cập nhật được trạng thái đơn', 'err');
      } finally {
        busy = false;
      }
    }

    async function addOrderNote(id) {
      if (busy) return;
      const res = await ctx.ui.confirm({
        title: 'Thêm ghi chú nội bộ cho đơn?',
        body: 'Ghi chú được lưu vào tiến trình đơn hàng và Nhật ký quản trị.',
        danger: false,
        reasonRequired: true,
        reasonLabel: 'Nội dung ghi chú (bắt buộc, ít nhất 3 ký tự)',
        confirmText: 'Lưu ghi chú',
      });
      if (!res.ok || !alive()) return;
      busy = true;
      try {
        await api.post(`/admin/orders/${encodeURIComponent(id)}/note`, { note: res.reason }, { signal });
        if (!alive()) return;
        ctx.ui.toast('Đã thêm ghi chú cho đơn hàng');
        await draw({ quiet: true, rethrow: false });
        await openOrder(id, { refresh: true });
        ctx.refreshWork();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Không lưu được ghi chú', 'err');
      } finally {
        busy = false;
      }
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => { if (el.dataset.status !== status) go({ status: el.dataset.status, page: 1 }); });
    delegate(root, 'click', '[data-act="prev"]', () => { if (page > 1) go({ page: page - 1 }); });
    delegate(root, 'click', '[data-act="next"]', () => { if (data?.hasNext) go({ page: page + 1 }); });
    delegate(root, 'click', 'tr[data-act="open"]', (_e, el) => openOrder(el.dataset.id));
    delegate(root, 'input', '[data-role="search"]', (_e, el) => {
      query = el.value;
      page = 1;
      history.replaceState(null, '', buildHash('orders', { status: status || '', q: query.trim() || '' }));
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { searchTimer = null; if (alive()) draw({ quiet: true, rethrow: false }); }, SEARCH_DEBOUNCE_MS);
    });

    const drawerEl = typeof document !== 'undefined' ? document.getElementById('drawer') : null;
    if (drawerEl) {
      cleanup.push(delegate(drawerEl, 'click', '[data-act="order-status"]', (_e, el) => interveneStatus(el.dataset.id, el.dataset.status)));
      cleanup.push(delegate(drawerEl, 'click', '[data-act="order-note"]', (_e, el) => addOrderNote(el.dataset.id)));
    }
    cleanup.push(() => { if (searchTimer) clearTimeout(searchTimer); drawerSeq += 1; });

    ctx.poll.add('screen:orders', () => draw({ quiet: true }), { everyMs: REFRESH_MS });
    await draw();

    const wanted = ctx.params?.id;
    if (wanted && alive()) {
      await openOrder(wanted, { fromDeepLink: true });
    }
  },

  destroy() {
    cleanup.forEach((off) => off());
    cleanup = [];
    drawer.close();
  },
};
