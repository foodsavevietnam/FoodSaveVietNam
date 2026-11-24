// Màn "Đơn hàng" (chỉ xem): toàn đơn của sàn qua GET /orders, chi tiết GET /orders/:id, chat chỉ đọc GET /orders/:id/messages.
// Tab trạng thái và trang lưu trong hash (#/orders?status=...&page=...). Poll 60 giây. Không có hành động ghi (các nút ghi là "Sắp có").
import { vnd, stamp, left, maskPhone } from '../core/format.js';
import { VI, badge } from '../core/vi.js';
import { drawer } from '../core/ui.js';

const REFRESH_MS = 60000;
const LIMIT = 20;
const STATUSES = Object.keys(VI.order);
const WITH_DEADLINE = new Set(['pending', 'confirmed', 'ready']);
const LEVEL = { ok: 'ok', warn: 'w', err: 'e', m: 'm' };

const PAYMENT_STATUS = { pending: 'Chờ thanh toán', paid: 'Đã thanh toán', refunded: 'Đã hoàn tiền', failed: 'Thanh toán lỗi' };
const PAYMENT_METHOD = { momo: 'MoMo', zalopay: 'ZaloPay', vnpay: 'VNPay', card: 'Thẻ', vietqr: 'VietQR' };
const CANCEL_REASON = { customer_free_cancel: 'Khách hủy miễn phí', late_cancel: 'Hủy muộn', no_show: 'Khách vắng mặt', payment_provider_error: 'Lỗi cổng thanh toán', payment_timeout: 'Quá hạn thanh toán' };
const CANCELLED_BY = { customer: 'Khách hủy', store: 'Cửa hàng hủy', system: 'Hệ thống hủy', admin: 'Admin hủy' };
const SETTLEMENT = { held: 'Đang giữ tiền', released: 'Đã giải ngân cửa hàng', refunded: 'Đã hoàn khách', partially_refunded: 'Hoàn một phần' };
const SENDER = { customer: 'Khách', partner: 'Cửa hàng', admin: 'Admin', system: 'Hệ thống' };
const SOON = ['Hủy & hoàn tiền', 'Đánh dấu vắng mặt', 'Hoàn tất thay cửa hàng', 'Ghi chú'];

const label = (map, key, fallback = '—') => (key != null && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback);
const idShort = (id) => String(id ?? '').slice(0, 8) || '—';

export default {
  id: 'orders',
  title: 'Đơn hàng',
  group: 'HOẠT ĐỘNG',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div data-screen="orders"><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    const status = STATUSES.includes(ctx.params?.status) ? ctx.params.status : '';
    const pageParam = Number.parseInt(ctx.params?.page, 10);
    const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
    let data = null; // { items, pagination }

    const go = (next) => ctx.navigate('orders', { status: next.status ?? status, page: (next.page ?? 1) > 1 ? next.page : undefined });

    function deadlineCell(o) {
      if (!WITH_DEADLINE.has(o.status) || !o.pickup_deadline) return '—';
      const l = left(o.pickup_deadline);
      return html`<span class="b b-${raw(LEVEL[l.level] || 'm')}">${l.text}</span>`;
    }

    function rowHtml(o) {
      return html`<tr data-act="open" data-id="${o.id}"><td><b>${o.order_number ? `#${o.order_number}` : idShort(o.id)}</b></td>
        <td>${o.customer?.full_name || '—'}</td><td>${o.stores?.name || '—'}</td><td>${vnd(o.total_cents)}</td>
        <td>${raw(o.policy_label ? badge('label', o.policy_label) : '—')}</td>
        <td>${raw(badge('order', o.status))}</td><td>${stamp(o.created_at)}</td><td>${raw(deadlineCell(o))}</td></tr>`;
    }

    function drawBody() {
      const tabs = [{ key: '', title: 'Tất cả' }, ...STATUSES.map((k) => ({ key: k, title: VI.order[k][0] }))]
        .map((t) => html`<button type="button" class="bt${raw(status === t.key ? ' bt-p' : '')}" data-act="tab" data-status="${t.key}"${raw(status === t.key ? ' aria-current="page"' : '')}>${t.title}</button>`).join('');
      const items = data.items;
      const pg = data.pagination || {};
      const cur = Number(pg.page) || page;
      const rows = items.length
        ? items.map(rowHtml).join('')
        : html`<tr><td colspan="8" style="text-align:center;color:var(--t3);padding:18px;cursor:default">Không có đơn nào${raw(status ? html` ở trạng thái "${VI.order[status][0]}"` : '')}.</td></tr>`;
      const head = ['Mã đơn', 'Khách', 'Cửa hàng', 'Tổng tiền', 'Nhãn', 'Trạng thái', 'Tạo lúc', 'Hạn lấy hàng'].map((h) => html`<th>${h}</th>`).join('');
      body.innerHTML = html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(tabs)}</div>
        <section class="P"><div class="P-h"><span class="P-t">Đơn hàng${raw(pg.total != null ? html` (${pg.total})` : '')}</span>
          <span class="P-a"><button type="button" class="bt" data-act="prev"${raw(cur <= 1 ? ' disabled' : '')}>Trước</button>
            <span style="align-self:center;font-size:.72rem;color:var(--t3)">Trang ${cur}</span>
            <button type="button" class="bt" data-act="next"${raw(pg.has_next_page ? '' : ' disabled')}>Sau</button></span></div>
          <div class="W"><table class="tbl" data-role="orders-table"><thead><tr>${raw(head)}</tr></thead><tbody>${raw(rows)}</tbody></table></div></section>`;
    }

    let seq = 0;
    async function draw({ quiet = false } = {}) {
      const mine = ++seq;
      if (!quiet || !data) loading(body);
      try {
        const qs = `page=${page}&limit=${LIMIT}${status ? `&status=${status}` : ''}`;
        const res = await api.get(`/orders?${qs}`, { signal });
        if (!alive() || mine !== seq) return;
        data = { items: Array.isArray(res?.items) ? res.items : [], pagination: res?.pagination || {} };
        drawBody();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet && data) { console.warn('[MIO] Không làm mới được danh sách đơn:', err); return; }
        error(body, err, () => draw());
      }
    }

    // ---------- Ngăn kéo chi tiết ----------
    const row = (k, v) => html`<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0"><span style="color:var(--t3)">${k}</span><span>${raw(v)}</span></div>`;
    const sec = (title, inner) => html`<section style="margin-top:14px"><div style="font-weight:700;margin-bottom:6px">${title}</div>${raw(inner)}</section>`;

    function timeline(o) {
      const steps = [
        [o.created_at, 'Tạo đơn'],
        [o.paid_at, 'Đã thanh toán'],
        [o.completed_at, 'Hoàn thành'],
        [o.no_show_at, 'Khách vắng mặt'],
        [o.cancelled_at, `Đã hủy${o.cancelled_by ? ` · ${label(CANCELLED_BY, o.cancelled_by, '')}` : ''}${o.cancel_reason ? ` · ${label(CANCEL_REASON, o.cancel_reason, 'Lý do khác')}` : ''}`],
      ].filter(([at]) => at).sort((a, b) => new Date(a[0]) - new Date(b[0]));
      if (o.pickup_deadline) steps.push([o.pickup_deadline, 'Hạn lấy hàng']);
      return steps.map(([at, text]) => html`<div style="padding:3px 0"><small style="color:var(--t3)">${stamp(at)}</small> ${text}</div>`).join('');
    }

    function orderBody(o, note) {
      const items = (Array.isArray(o.order_items) ? o.order_items : []).map((i) => html`<tr style="cursor:default"><td>${i.product_name || '—'}</td><td>× ${i.quantity ?? '—'}</td><td>${vnd(i.unit_price_cents)}</td></tr>`).join('');
      const money = [row('Tạm tính', vnd(o.subtotal_cents)), row('Giảm giá', vnd(o.discount_cents))];
      if (Number(o.donation_cents) > 0) money.push(row('Quyên góp thêm', vnd(o.donation_cents)));
      if (Number(o.platform_fee_cents) > 0) money.push(row('Phí nền tảng', vnd(o.platform_fee_cents)));
      money.push(html`<div style="border-top:1px solid var(--bd);margin-top:4px;padding-top:4px;font-weight:700">${raw(row('Tổng', vnd(o.total_cents)))}</div>`);
      const pay = [row('Trạng thái', html`${label(PAYMENT_STATUS, o.payment_status)}`), row('Phương thức', html`${label(PAYMENT_METHOD, o.payment_method)}`)];
      if (label(SETTLEMENT, o.settlement_status, '')) pay.push(row('Đối soát', html`${label(SETTLEMENT, o.settlement_status)}`));
      const soon = SOON.map((t) => html`<button type="button" class="bt" data-soon="1" disabled title="Sắp có — cần API mới">${t}</button>`).join(' ');
      return html`<div style="padding:16px 18px;font-size:.8rem">
        ${raw(note ? html`<p style="color:var(--warn)">${note}</p>` : '')}
        <div>${raw(badge('order', o.status))} ${raw(o.policy_label ? badge('label', o.policy_label) : '')}</div>
        ${raw(row('Khách', html`${o.customer?.full_name || '—'}${o.customer?.phone ? html` · ${maskPhone(o.customer.phone)}` : ''}`))}
        ${raw(row('Cửa hàng', html`${o.stores?.name || '—'}`))}
        ${raw(row('Tạo lúc', html`${stamp(o.created_at)}`))}
        ${raw(sec('Món đã đặt', html`<table data-role="items"><tbody>${raw(items || html`<tr><td>—</td></tr>`)}</tbody></table>`))}
        ${raw(sec('Tiền', money.join('')))}
        ${raw(sec('Tiến trình', timeline(o)))}
        ${raw(sec('Thanh toán', pay.join('')))}
        ${raw(sec('Chat với cửa hàng (chỉ xem)', html`<div data-role="chat" data-order="${o.id}" style="font-size:.76rem;color:var(--t2)">Đang tải…</div>`))}
        ${raw(sec('Thao tác của Admin', html`<div style="display:flex;gap:6px;flex-wrap:wrap">${raw(soon)}</div>
          <div style="font-size:.7rem;color:var(--t3);margin-top:6px">Sắp có — cần API admin có ghi nhật ký.</div>`))}
      </div>`;
    }

    async function loadChat(order) {
      const box = () => document.querySelector(`#drawer [data-role="chat"][data-order="${order.id}"]`);
      try {
        const res = await api.get(`/orders/${encodeURIComponent(order.id)}/messages`, { signal });
        const el = box();
        if (!alive() || !el) return;
        const msgs = Array.isArray(res?.messages) ? res.messages : [];
        el.innerHTML = msgs.length
          ? msgs.map((m) => html`<div style="margin:3px 0"><strong>${label(SENDER, m.sender_role, 'Hệ thống')}</strong> <small style="color:var(--t3)">${stamp(m.created_at)}</small><br>${m.body}</div>`).join('')
          : html`Không có tin nhắn.`;
      } catch (err) {
        const el = box();
        if (!alive() || !el || err?.name === 'AbortError') return;
        el.innerHTML = html`${err?.code === 'CHAT_FORBIDDEN' ? 'Chỉ xem được chat khi đơn có khiếu nại' : err?.message || 'Không tải được chat.'}`;
      }
    }

    let drawerSeq = 0;
    async function openOrder(id) {
      const base = data?.items.find((o) => o.id === id);
      if (!base) return;
      const mine = ++drawerSeq;
      const title = base.order_number ? `Đơn #${base.order_number}` : `Đơn ${idShort(id)}`;
      drawer.open(html`<div data-order="${id}" style="padding:16px 18px"><div aria-busy="true" class="skeleton" style="height:14px"></div></div>`, { title });
      let order = base;
      let note = '';
      try {
        const detail = await api.get(`/orders/${encodeURIComponent(id)}`, { signal });
        order = { ...base, ...(detail || {}) };
      } catch (err) {
        if (err?.name === 'AbortError') return;
        note = 'Không tải được chi tiết mới nhất, đang hiện dữ liệu từ danh sách.';
      }
      if (!alive() || mine !== drawerSeq) return;
      // Người dùng đã đóng (hoặc mở đơn khác) trong lúc chờ: không mở lại drawer
      const el = document.getElementById('drawer');
      if (!el?.classList.contains('open') || !el.querySelector(`[data-order="${id}"]`)) return;
      drawer.open(orderBody(order, note), { title });
      loadChat(order);
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => { if (el.dataset.status !== status) go({ status: el.dataset.status, page: 1 }); });
    delegate(root, 'click', '[data-act="prev"]', () => { if (page > 1) go({ page: page - 1 }); });
    delegate(root, 'click', '[data-act="next"]', () => { if (data?.pagination?.has_next_page) go({ page: page + 1 }); });
    delegate(root, 'click', 'tr[data-act="open"]', (_e, el) => openOrder(el.dataset.id));

    ctx.poll.add('screen:orders', () => draw({ quiet: true }), { everyMs: REFRESH_MS });
    await draw();
  },

  destroy() { drawer.close(); },
};
