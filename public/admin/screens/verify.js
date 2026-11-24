// Màn "Duyệt hồ sơ": 3 tab (Cửa hàng, Tổ chức, Tài khoản nhận tiền) + lịch sử duyệt 30 dòng.
// Tab lưu trong hash (#/verify?tab=...). Poll 60 giây. Không bao giờ hiện số tài khoản đầy đủ (API chỉ trả 4 số cuối).
import { dt } from '../core/format.js';
import { actionLabel, badge } from '../core/vi.js';

const REFRESH_MS = 60000;
const TABS = [
  { key: 'stores', title: 'Cửa hàng' },
  { key: 'charities', title: 'Tổ chức' },
  { key: 'accounts', title: 'Tài khoản nhận tiền' },
];
const TARGETS = { store: 'Cửa hàng', charity: 'Tổ chức' };

const list = (v) => (Array.isArray(v) ? v : v?.items || []);

// Câu hậu quả khi xác minh tài khoản nhận tiền, theo loại cảnh báo (có cảnh báo → bắt buộc ghi chú)
const VERIFY_BODY = {
  name_mismatch: 'Tên chủ tài khoản không khớp tên đăng ký kinh doanh nên cần ghi chú lý do vẫn xác minh; cửa hàng sẽ rút tiền về tài khoản này.',
  no_registered_name: 'Cửa hàng chưa có tên đăng ký kinh doanh để đối chiếu với tên chủ tài khoản nên cần ghi chú lý do vẫn xác minh; cửa hàng sẽ rút tiền về tài khoản này.',
};
export function verifyBody(warning) {
  if (!warning) return 'Cửa hàng sẽ được rút tiền về tài khoản này.';
  return Object.prototype.hasOwnProperty.call(VERIFY_BODY, warning)
    ? VERIFY_BODY[warning]
    : 'Tài khoản có cảnh báo cần kiểm tra nên cần ghi chú lý do vẫn xác minh; cửa hàng sẽ rút tiền về tài khoản này.';
}

export default {
  id: 'verify',
  title: 'Duyệt hồ sơ',
  group: 'CẦN QUYẾT ĐỊNH',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div data-screen="verify"><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    const tab = TABS.some((t) => t.key === ctx.params?.tab) ? ctx.params.tab : 'stores';
    let data = null; // { stores, charities, history, accounts }
    const busy = new Set(); // id đang xử lý (chặn bấm 2 lần)

    const empty = (cols, text) => html`<tr><td colspan="${cols}" style="text-align:center;color:var(--t3);padding:18px">${text}</td></tr>`;
    const btns = (acts, id, kind, labels) => {
      const off = busy.has(id) ? raw(' disabled') : '';
      const k = kind ? raw(` data-kind="${kind}"`) : '';
      return html`<button type="button" class="bt bt-s bt-p" data-act="${acts[0]}" data-id="${id}"${k}${off}>${labels[0]}</button>
        <button type="button" class="bt bt-s" data-act="${acts[1]}" data-id="${id}"${k}${off}>${labels[1]}</button>`;
    };
    const table = (role, head, rows) => html`<table class="tbl" data-role="${role}"><thead><tr>${raw(head.map((h) => html`<th>${h}</th>`).join(''))}</tr></thead><tbody>${raw(rows)}</tbody></table>`;

    function storeRows() {
      return data.stores.map((s) => html`<tr><td><b>${s.name}</b></td><td>${s.address}</td>
        <td>${s.owner_name || '—'}<br><small style="color:var(--t3)">${s.phone}</small></td><td>${dt(s.created_at)}</td>
        <td>${raw(btns(['approve', 'reject'], s.id, 'store', ['Duyệt', 'Từ chối']))}</td></tr>`).join('')
        || empty(5, 'Không có cửa hàng nào chờ duyệt.');
    }
    function charityRows() {
      return data.charities.map((c) => html`<tr><td><b>${c.name}</b></td><td>${c.address}</td>
        <td>${c.email}<br><small style="color:var(--t3)">${c.phone}</small></td><td>${dt(c.created_at)}</td>
        <td>${raw(btns(['approve', 'reject'], c.id, 'charity', ['Duyệt', 'Từ chối']))}</td></tr>`).join('')
        || empty(5, 'Không có tổ chức nào chờ duyệt.');
    }
    function accountRows() {
      return data.accounts.map((a) => {
        const warn = a.warning ? badge('payoutWarning', a.warning) : html`<span class="b b-ok">Tên khớp</span>`;
        return html`<tr><td>${a.store_name || '—'}</td><td>${a.bank_name} ••••${a.account_last4}</td>
          <td>${a.account_holder_name}</td><td>${a.registered_name || '—'}</td>
          <td>${raw(warn)} ${raw(badge('payoutAccount', a.status))}</td>
          <td>${raw(btns(['verify', 'reject-account'], a.id, '', ['Xác minh', 'Từ chối']))}</td></tr>`;
      }).join('') || empty(6, 'Không có tài khoản nào chờ xác minh.');
    }
    function historyRows() {
      return data.history.slice(0, 30).map((h) => {
        const approved = String(h.action).endsWith('.approve');
        const result = html`<span class="b b-${raw(approved ? 'ok' : 'e')}">${actionLabel(h.action)}</span>`;
        return html`<tr><td>${dt(h.created_at)}</td><td>${h.actor_name || '—'}</td><td>${raw(result)}</td>
          <td>${TARGETS[h.target_type] || '—'} ${h.detail?.name || ''}</td><td>${h.detail?.reason || ''}</td></tr>`;
      }).join('') || empty(5, 'Chưa có lần duyệt nào.');
    }

    function drawBody() {
      const counts = { stores: data.stores.length, charities: data.charities.length, accounts: data.accounts.length };
      const tabs = TABS.map((t) => html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-tab="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title} (${counts[t.key]})</button>`).join('');
      let main;
      if (tab === 'stores') main = table('stores-table', ['Cửa hàng', 'Địa chỉ', 'Chủ cửa hàng', 'Gửi lúc', ''], storeRows());
      else if (tab === 'charities') main = table('charities-table', ['Tổ chức', 'Địa chỉ', 'Liên hệ', 'Gửi lúc', ''], charityRows());
      else main = html`${raw(table('accounts-table', ['Cửa hàng', 'Tài khoản', 'Tên chủ tài khoản', 'Tên đăng ký kinh doanh', 'Đối chiếu', ''], accountRows()))}
        <p style="font-size:.72rem;color:var(--t3);padding:8px 16px">Chỉ hiện 4 số cuối. Số đầy đủ được mã hóa.</p>`;
      body.innerHTML = html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(tabs)}</div>
        <section class="P"><div class="P-h"><span class="P-t">${TABS.find((t) => t.key === tab).title} chờ duyệt (${counts[tab]})</span></div>
          <div class="W">${raw(main)}</div></section>
        <section class="P" style="margin-top:16px"><div class="P-h"><span class="P-t">Lịch sử duyệt gần đây</span></div>
          <div class="W" data-role="history">${raw(table('history-table', ['Thời gian', 'Người duyệt', 'Kết quả', 'Hồ sơ', 'Lý do'], historyRows()))}</div></section>`;
    }

    let seq = 0;
    async function draw({ quiet = false } = {}) {
      const mine = ++seq;
      if (!quiet || !data) loading(body);
      try {
        const [queue, accounts] = await Promise.all([
          api.get('/admin/verification', { signal }),
          api.get('/admin/payout-accounts?status=pending_verification', { signal }),
        ]);
        if (!alive() || mine !== seq) return;
        data = {
          stores: list(queue?.stores), charities: list(queue?.charities), history: list(queue?.history),
          accounts: list(accounts).filter((a) => a.status === 'pending_verification'),
        };
        drawBody();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet && data) { console.warn('[MIO] Không làm mới được danh sách duyệt hồ sơ:', err); return; }
        error(body, err, () => draw());
      }
    }

    // Chạy một hành động cho một dòng: khóa nút của dòng đến khi tải lại xong.
    async function run(id, call, okText) {
      if (busy.has(id)) return;
      busy.add(id);
      if (data) drawBody();
      try {
        await call();
        if (!alive()) return;
        ctx.ui.toast(okText);
        await draw({ quiet: true });
        ctx.refreshWork();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Không xử lý được', 'err');
      } finally {
        busy.delete(id);
        if (alive() && data) drawBody();
      }
    }

    async function decide(kind, id, approve) {
      if (busy.has(id)) return;
      const found = (kind === 'store' ? data.stores : data.charities).find((r) => r.id === id);
      const what = kind === 'store' ? 'cửa hàng' : 'tổ chức';
      const res = approve
        ? await ctx.ui.confirm({ title: `Duyệt ${what} ${found?.name || ''}?`, body: 'Chủ hồ sơ được báo đã duyệt và có thể bắt đầu hoạt động.', confirmText: 'Duyệt' })
        : await ctx.ui.confirm({ title: `Từ chối ${what} ${found?.name || ''}?`, body: 'Lý do từ chối sẽ được gửi cho chủ hồ sơ.', danger: true, reasonRequired: true, reasonLabel: 'Lý do từ chối', confirmText: 'Từ chối' });
      if (!res.ok || !alive()) return;
      const payload = approve ? { decision: 'approve' } : { decision: 'reject', reason: res.reason };
      await run(id, () => api.post(`/admin/verification/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/decision`, payload, { signal }), approve ? 'Đã duyệt' : 'Đã từ chối');
    }

    async function decideAccount(id, verify) {
      if (busy.has(id)) return;
      const a = data.accounts.find((r) => r.id === id);
      const who = `${a?.bank_name || ''} ••••${a?.account_last4 || ''}`.trim();
      let res;
      if (verify) {
        const mismatch = Boolean(a?.warning);
        res = await ctx.ui.confirm({
          title: `Xác minh tài khoản ${who}?`,
          body: verifyBody(a?.warning),
          reasonRequired: mismatch, reasonLabel: 'Ghi chú xác minh', confirmText: 'Xác minh',
        });
      } else {
        res = await ctx.ui.confirm({ title: `Từ chối tài khoản ${who}?`, body: 'Cửa hàng phải thêm tài khoản khác để rút tiền.', danger: true, reasonRequired: true, reasonLabel: 'Lý do từ chối', confirmText: 'Từ chối' });
      }
      if (!res.ok || !alive()) return;
      const payload = { decision: verify ? 'verify' : 'reject' };
      if (res.reason) payload.note = res.reason;
      await run(id, () => api.patch(`/admin/payout-accounts/${encodeURIComponent(id)}`, payload, { signal }), verify ? 'Đã xác minh tài khoản' : 'Đã từ chối tài khoản');
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => { if (el.dataset.tab !== tab) ctx.navigate('verify', { tab: el.dataset.tab }); });
    delegate(root, 'click', '[data-act="approve"]', (_e, el) => decide(el.dataset.kind, el.dataset.id, true));
    delegate(root, 'click', '[data-act="reject"]', (_e, el) => decide(el.dataset.kind, el.dataset.id, false));
    delegate(root, 'click', '[data-act="verify"]', (_e, el) => decideAccount(el.dataset.id, true));
    delegate(root, 'click', '[data-act="reject-account"]', (_e, el) => decideAccount(el.dataset.id, false));

    ctx.poll.add('screen:verify', () => draw({ quiet: true }), { everyMs: REFRESH_MS });
    await draw();
  },

  destroy() {},
};
