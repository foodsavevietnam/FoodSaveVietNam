// Màn "Rút tiền & chi trả": lệnh rút của cửa hàng theo 6 tab trạng thái (#/payouts?tab=...), xử lý trong ngăn kéo.
// API lọc được requested/approved/rejected → 3 tab này gọi ?status=<tab>; processing/paid/failed tải 100 lệnh mới nhất
// (mọi trạng thái) rồi lọc phía client. Số lượng chỉ hiện ở tab đang mở (lấy từ kết quả vừa tải), không đoán số tab khác.
// Số tài khoản đầy đủ chỉ hiện sau khi xác nhận + ghi nhật ký, tự che sau REVEAL_MS và bị xóa khi đóng ngăn kéo / rời màn.
import { stamp, vnd } from '../core/format.js';
import { badge } from '../core/vi.js';

const REFRESH_MS = 60000;
const REVEAL_MS = 60000;
const NOTE_MAX = 300;
const REF_MIN = 3;
const REF_MAX = 80;
const LIST_LIMIT = 100; // backend trả tối đa 100 lệnh mới nhất
const SERVER_STATUSES = new Set(['requested', 'approved', 'rejected']);
const TABS = [
  { key: 'requested', title: 'Chờ duyệt' },
  { key: 'approved', title: 'Đã duyệt, chờ chi' },
  { key: 'processing', title: 'Đang chi' },
  { key: 'paid', title: 'Đã chi' },
  { key: 'failed', title: 'Chi thất bại' },
  { key: 'rejected', title: 'Từ chối' },
];

const list = (v) => (Array.isArray(v) ? v : v?.items || []);
const storeName = (w) => w.stores?.name || '—';

let cleanup = () => {}; // xóa số đã hiện + hủy timer + đóng ngăn kéo (gọi từ destroy)

export default {
  id: 'payouts',
  title: 'Rút tiền & chi trả',
  group: 'CẦN QUYẾT ĐỊNH',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div data-screen="payouts"><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    const tab = TABS.some((t) => t.key === ctx.params?.tab) ? ctx.params.tab : 'requested';
    let rows = null;
    let busy = false; // chống gửi đôi khi đang chờ API
    const byId = (id) => (rows || []).find((w) => w.id === id);

    // ---- Ngăn kéo: số tài khoản đầy đủ chỉ nằm trong DOM của ngăn kéo, không lưu vào rows ----
    let timer = null;
    let observer = null;
    let panelRef = null;

    function maskedHtml(w) {
      return html`<span data-role="account">${w?.bank_name || ''} ••••${w?.account_last4 || ''}</span>
        <button type="button" class="bt bt-s" data-act="reveal">Hiện số đầy đủ (ghi nhật ký)</button>`;
    }
    let openedW = null; // bản lệnh rút lúc mở ngăn kéo, dự phòng khi lệnh rơi khỏi rows sau poll
    // Che lại: hủy timer, khôi phục ô che, GIỮ tham chiếu panel để lần hiện sau vẫn che được
    function remask() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (panelRef?.isConnected) {
        const box = panelRef.querySelector('[data-role="reveal"]');
        if (box) box.innerHTML = maskedHtml(byId(panelRef.dataset.id) || openedW);
      }
    }
    // Dọn hẳn (đóng ngăn kéo / rời màn / mở lệnh khác): che + ngắt observer + bỏ tham chiếu
    function clearReveal() {
      remask();
      if (observer) { observer.disconnect(); observer = null; }
      panelRef = null;
      openedW = null;
    }
    cleanup = () => {
      clearReveal();
      ctx.ui.drawer.close();
    };

    // ---- Danh sách ----
    const emptyRow = (text) => html`<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:18px">${text}</td></tr>`;
    function rowHtml(w) {
      return html`<tr><td>${stamp(w.requested_at)}</td><td><b>${storeName(w)}</b></td>
        <td>${w.bank_name} ••••${w.account_last4}</td><td class="mn">${vnd(w.amount_cents)}</td>
        <td>${raw(badge('withdrawal', w.status))}</td>
        <td><button type="button" class="bt bt-s bt-p" data-act="open" data-id="${w.id}">Xem và xử lý</button></td></tr>`;
    }
    function drawBody() {
      const current = TABS.find((t) => t.key === tab);
      // Lọc lại phía client cả khi server đã lọc (chế độ xem thử trả mọi trạng thái)
      const shown = rows.filter((w) => w.status === tab);
      // Tab lọc ở server: đủ 100 dòng nghĩa là có thể còn nữa; tab lọc phía client: chỉ đếm trong 100 lệnh đã tải
      const count = serverSide && rows.length >= LIST_LIMIT ? `${LIST_LIMIT}+` : String(shown.length);
      const tabs = TABS.map((t) => html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-tab="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title}${tab === t.key ? ` (${count})` : ''}</button>`).join('');
      const head = ['Gửi lúc', 'Cửa hàng', 'Tài khoản', 'Số tiền', 'Trạng thái', ''].map((h) => html`<th>${h}</th>`).join('');
      const scope = serverSide
        ? `Hiện tối đa ${LIST_LIMIT} lệnh mới nhất ở trạng thái này.`
        : `Chỉ tính trong ${LIST_LIMIT} lệnh rút mới nhất (mọi trạng thái); lệnh cũ hơn không hiện ở tab này.`;
      body.innerHTML = html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(tabs)}</div>
        <section class="P"><div class="P-h"><span class="P-t">${current.title} (${count})</span></div>
          <div class="W"><table class="tbl" data-role="withdrawals-table"><thead><tr>${raw(head)}</tr></thead>
            <tbody>${raw(shown.map(rowHtml).join('') || emptyRow('Không có lệnh rút nào ở trạng thái này.'))}</tbody></table></div></section>
        <p style="font-size:.72rem;color:var(--t3);padding:8px 4px">${scope} Chỉ hiện 4 số cuối tài khoản; số đầy đủ phải xem trong từng lệnh và được ghi nhật ký.</p>`;
    }

    const serverSide = SERVER_STATUSES.has(tab);
    const listPath = serverSide ? `/admin/withdrawals?status=${encodeURIComponent(tab)}` : '/admin/withdrawals';
    let seq = 0;
    async function draw({ quiet = false } = {}) {
      const mine = ++seq;
      if (!quiet || !rows) loading(body);
      try {
        const data = await api.get(listPath, { signal });
        if (!alive() || mine !== seq) return;
        rows = list(data);
        drawBody();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet && rows) { console.warn('[MIO] Không làm mới được danh sách lệnh rút:', err); return; }
        error(body, err, () => draw());
      }
    }

    // ---- Nút theo trạng thái ----
    function actionsHtml(w) {
      if (w.status === 'requested') {
        return html`<button type="button" class="bt bt-p" data-act="approve">Duyệt</button> <button type="button" class="bt" data-act="reject">Từ chối</button>`;
      }
      const refBox = html`<label style="display:block;font-size:.75rem;font-weight:700;margin-bottom:6px">Mã giao dịch ngân hàng (bắt buộc)
            <input name="bank_txn_ref" maxlength="${REF_MAX}" autocomplete="off" style="display:block;width:100%;padding:8px;margin-top:4px" placeholder="Ví dụ FT123456"></label>`;
      if (w.status === 'approved') {
        return html`<button type="button" class="bt bt-p" data-act="start">Bắt đầu chi</button>
          <div style="margin-top:12px">${raw(refBox)}<button type="button" class="bt bt-p" data-act="pay" disabled>Đã chi</button> <button type="button" class="bt" data-act="reject">Hủy lệnh</button></div>`;
      }
      if (w.status === 'processing') {
        return html`${raw(refBox)}<button type="button" class="bt bt-p" data-act="pay" disabled>Đã chi</button> <button type="button" class="bt b-e" data-act="fail">Thất bại</button>`;
      }
      return '';
    }

    function openDrawer(w) {
      clearReveal();
      openedW = w;
      const canReveal = w.status === 'approved' || w.status === 'processing';
      const extra = w.failure_reason || w.admin_note || w.bank_txn_ref
        ? html`<p class="v2note">${w.failure_reason || w.admin_note || ''}${raw(w.bank_txn_ref ? html`<br>Mã giao dịch: <b>${w.bank_txn_ref}</b>` : '')}</p>` : '';
      ctx.ui.drawer.open(html`<div data-role="payout-drawer" data-id="${w.id}" style="padding:14px 18px">
        <p><strong>${storeName(w)}</strong><br>Số tiền: <b>${vnd(w.amount_cents)}</b><br>Gửi lúc: ${stamp(w.requested_at)}<br>${raw(badge('withdrawal', w.status))}</p>
        <p>Tài khoản nhận: <span data-role="reveal">${raw(canReveal ? maskedHtml(w) : html`${w.bank_name} ••••${w.account_last4}`)}</span></p>
        ${raw(extra)}
        <div data-role="actions" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--bd)">${raw(actionsHtml(w))}</div></div>`,
      { title: 'Lệnh rút tiền' });

      const panel = document.querySelector('#drawer [data-role="payout-drawer"]');
      if (!panel) return;
      panelRef = panel;
      // Đóng ngăn kéo (nút Đóng) làm panel rời DOM: xóa số đã hiện và hủy timer ngay
      observer = new MutationObserver(() => { if (!panel.isConnected) clearReveal(); });
      observer.observe(document.getElementById('drawer'), { childList: true });
      wire(panel, w);
    }

    const refValue = (panel) => (panel.querySelector('[name="bank_txn_ref"]')?.value || '').trim();
    function syncPay(panel) {
      const pay = panel.querySelector('[data-act="pay"]');
      if (!pay) return;
      const n = refValue(panel).length;
      pay.disabled = busy || n < REF_MIN || n > REF_MAX;
    }

    async function perform(w, payload, okText, panel) {
      if (busy) return;
      busy = true;
      panel.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        await api.patch(`/admin/withdrawals/${encodeURIComponent(w.id)}`, payload, { signal });
        if (!alive()) return;
        ctx.ui.toast(okText);
        clearReveal();
        ctx.ui.drawer.close();
        draw({ quiet: true });
        ctx.refreshWork();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Không xử lý được lệnh rút', 'err');
      } finally {
        busy = false;
        if (panel.isConnected) {
          panel.querySelectorAll('button').forEach((b) => { b.disabled = false; });
          syncPay(panel);
        }
      }
    }

    async function reasonOf(opts) {
      const res = await ctx.ui.confirm({ ...opts, reasonRequired: true, danger: true });
      if (!res.ok) return null;
      if (res.reason.length > NOTE_MAX) { ctx.ui.toast(`Lý do tối đa ${NOTE_MAX} ký tự`, 'err'); return null; }
      return res.reason;
    }

    function wire(panel, w) {
      const label = `${storeName(w)} · ${vnd(w.amount_cents)}`;
      const on = (act, fn) => delegate(panel, 'click', `[data-act="${act}"]`, () => { if (!busy) fn(); });
      panel.addEventListener('input', () => syncPay(panel));

      on('approve', async () => {
        const res = await ctx.ui.confirm({ title: `Duyệt lệnh rút ${label}?`, body: 'Cửa hàng được báo lệnh rút đã duyệt và sẽ được chi sớm.', confirmText: 'Duyệt' });
        if (res.ok && alive()) await perform(w, { decision: 'approve' }, 'Đã duyệt lệnh rút', panel);
      });
      on('reject', async () => {
        const note = await reasonOf({ title: `Từ chối lệnh rút ${label}?`, body: 'Số tiền được trả lại vào số dư khả dụng của cửa hàng; lý do được gửi cho cửa hàng.', reasonLabel: 'Lý do từ chối', confirmText: 'Từ chối' });
        if (note && alive()) await perform(w, { decision: 'reject', note }, 'Đã từ chối lệnh rút', panel);
      });
      on('start', async () => {
        const res = await ctx.ui.confirm({ title: `Bắt đầu chi ${label}?`, body: 'Lệnh rút chuyển sang "Đang chi". Sau đó xem số tài khoản, chuyển khoản rồi nhập mã giao dịch.', confirmText: 'Bắt đầu chi' });
        if (res.ok && alive()) await perform(w, { decision: 'start' }, 'Đã bắt đầu chi', panel);
      });
      on('pay', async () => {
        const ref = refValue(panel);
        if (ref.length < REF_MIN || ref.length > REF_MAX) return;
        const res = await ctx.ui.confirm({ title: `Xác nhận đã chi ${label}?`, body: `Mã giao dịch ${ref}. Số tiền sẽ bị trừ khỏi ví cửa hàng và không thể hoàn tác.`, danger: true, confirmText: 'Đã chi' });
        if (res.ok && alive()) await perform(w, { decision: 'pay', bank_txn_ref: ref }, 'Đã ghi nhận chi tiền', panel);
      });
      on('fail', async () => {
        const note = await reasonOf({ title: `Đánh dấu chi thất bại ${label}?`, body: 'Số tiền vẫn nằm trong ví cửa hàng; lý do được gửi cho cửa hàng.', reasonLabel: 'Lý do thất bại', confirmText: 'Thất bại' });
        if (note && alive()) await perform(w, { decision: 'fail', note }, 'Đã đánh dấu chi thất bại', panel);
      });
      on('reveal', async () => {
        const res = await ctx.ui.confirm({ title: 'Xem số tài khoản đầy đủ?', body: 'Hành động được ghi nhật ký (tên bạn, thời gian, lệnh rút). Số hiện 60 giây rồi tự che; đừng lưu hoặc chia sẻ số này.', confirmText: 'Hiện số' });
        if (!res.ok || !alive() || !panel.isConnected) return;
        busy = true;
        let acc;
        try {
          acc = await api.post(`/admin/withdrawals/${encodeURIComponent(w.id)}/reveal-account`, {}, { signal });
        } catch (err) {
          if (err?.name !== 'AbortError') ctx.ui.toast(err?.message || 'Không xem được số tài khoản', 'err');
          return;
        } finally { busy = false; }
        if (!alive() || !panel.isConnected) return;
        panel.querySelector('[data-role="reveal"]').innerHTML = html`<span data-role="account-full"><b>${acc.bank_name}</b> · ${acc.account_holder_name}<br><b style="font-size:1.05rem;letter-spacing:.04em">${acc.account_number}</b></span>
          <br><small style="color:var(--t3)">Tự che sau 60 giây. Đã ghi nhật ký truy cập.</small>`;
        acc = null;
        if (timer) clearTimeout(timer);
        panelRef = panel;
        timer = setTimeout(() => { timer = null; remask(); }, REVEAL_MS);
      });
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => { if (el.dataset.tab !== tab) ctx.navigate('payouts', { tab: el.dataset.tab }); });
    delegate(root, 'click', '[data-act="open"]', (_e, el) => { const w = byId(el.dataset.id); if (w) openDrawer(w); });

    ctx.poll.add('screen:payouts', () => draw({ quiet: true }), { everyMs: REFRESH_MS });
    await draw();
  },

  destroy() { cleanup(); cleanup = () => {}; },
};
