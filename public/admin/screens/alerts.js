// Màn "Cảnh báo gian lận": 5 ô lọc (bấm lại để bỏ lọc), bảng cảnh báo, Xử lý / Bỏ qua (ghi chú tùy chọn).
// Bộ lọc lưu trong hash (#/alerts?f=...) bằng replaceState nên đổi lọc không tải lại dữ liệu. Poll 120 giây.
import { dt } from '../core/format.js';
import { buildHash } from '../core/router.js';
import { badge } from '../core/vi.js';

const REFRESH_MS = 120000;
const FILTERS = ['all', 'open', 'high', 'medium', 'low'];
const CHIPS = [
  { key: 'all', label: 'Tổng' },
  { key: 'open', label: 'Đang mở' },
  { key: 'high', label: 'Cao' },
  { key: 'medium', label: 'Trung bình' },
  { key: 'low', label: 'Thấp' },
];
const NOTE_MAX = 300;

export default {
  id: 'alerts',
  title: 'Cảnh báo gian lận',
  group: 'CẦN QUYẾT ĐỊNH',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div data-screen="alerts"><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    let filter = FILTERS.includes(ctx.params?.f) ? ctx.params.f : 'all';
    let data = null; // { alerts, not_detected }
    const busy = new Set(); // key đang xử lý (chặn bấm 2 lần)

    const isOpen = (a) => a.status === 'open';
    // Ô Cao / Trung bình / Thấp chỉ đếm cảnh báo đang mở (khớp số dòng khi lọc).
    const counts = () => {
      const all = data.alerts, open = all.filter(isOpen);
      return {
        all: all.length, open: open.length,
        high: open.filter((a) => a.severity === 'high').length,
        medium: open.filter((a) => a.severity === 'medium').length,
        low: open.filter((a) => a.severity === 'low').length,
      };
    };
    const visible = () => data.alerts.filter((a) => (filter === 'all' ? true : filter === 'open' ? isOpen(a) : isOpen(a) && a.severity === filter));

    function subjectCell(a) {
      if (a.subject_type === 'customer' && a.subject_id) {
        return html`<b>${a.subject_name}</b><br><a data-role="open-profile" href="${buildHash('customers', { id: a.subject_id })}">Mở hồ sơ</a>`;
      }
      return html`<b>${a.subject_name}</b>`;
    }
    function actionCell(a) {
      if (isOpen(a)) {
        const off = busy.has(a.key) ? raw(' disabled') : '';
        return html`<button type="button" class="bt bt-s bt-p" data-act="handled" data-key="${a.key}"${off}>Xử lý</button>
          <button type="button" class="bt bt-s" data-act="dismissed" data-key="${a.key}"${off}>Bỏ qua</button>`;
      }
      return html`<small style="color:var(--t3)">${dt(a.handled_at)}${a.note ? ` · ${a.note}` : ''}</small>`;
    }

    function drawBody() {
      const c = counts();
      const chips = CHIPS.map((x) => html`<button type="button" class="bt${raw(filter === x.key ? ' bt-p' : '')}" data-act="filter" data-filter="${x.key}" aria-pressed="${filter === x.key ? 'true' : 'false'}">${x.label} (${c[x.key]})</button>`).join('');
      const rows = visible().map((a) => html`<tr data-key="${a.key}"><td>${raw(badge('fraud', a.type))}</td><td>${raw(subjectCell(a))}</td><td>${a.description}</td>
        <td>${raw(badge('severity', a.severity))}</td><td>${raw(badge('fraudStatus', a.status))}</td><td>${raw(actionCell(a))}</td></tr>`).join('')
        || html`<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:18px">Không có cảnh báo trong mục này.</td></tr>`;
      const missing = (data.not_detected || []).map((t) => html`<li>${t}</li>`).join('');
      body.innerHTML = html`<p class="v2note" style="margin:0 0 12px"><b>Cảnh báo tự tính từ dữ liệu có sẵn</b> (đơn 60 ngày, nhật ký đăng nhập 7 ngày). "Xử lý" ghi trạng thái và người xử lý vào Nhật ký; không tự khóa ai. Muốn hạn chế khách hãy dùng mục Người mua.</p>
        <div data-role="chips" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${raw(chips)}</div>
        <section class="P"><div class="P-h"><span class="P-t">Cảnh báo gian lận</span></div>
          <div class="W"><table class="tbl" data-role="alerts-table"><thead><tr><th>Loại</th><th>Đối tượng</th><th>Mô tả</th><th>Mức</th><th>Trạng thái</th><th></th></tr></thead><tbody>${raw(rows)}</tbody></table></div></section>
        <section class="P" style="margin-top:16px" data-role="not-detected"><div class="P-h"><span class="P-t">Không phát hiện được</span></div>
          <ul style="padding:10px 14px 10px 32px;margin:0;font-size:.78rem;color:var(--t2)">${raw(missing)}</ul></section>`;
    }

    let seq = 0;
    async function draw({ quiet = false } = {}) {
      const mine = ++seq;
      if (!quiet || !data) loading(body);
      try {
        const res = await api.get('/admin/fraud-alerts', { signal });
        if (!alive() || mine !== seq) return;
        data = { alerts: Array.isArray(res?.alerts) ? res.alerts : [], not_detected: Array.isArray(res?.not_detected) ? res.not_detected : [] };
        drawBody();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet && data) { console.warn('[MIO] Không làm mới được cảnh báo gian lận:', err); return; }
        error(body, err, () => draw());
      }
    }

    async function handle(key, status) {
      if (busy.has(key) || !data) return;
      const item = data.alerts.find((a) => a.key === key);
      if (!item) return;
      const done = status === 'handled';
      const res = await ctx.ui.confirm({
        title: done ? `Đánh dấu đã xử lý cảnh báo của ${item.subject_name}?` : `Bỏ qua cảnh báo của ${item.subject_name}?`,
        body: done ? 'Cảnh báo chuyển sang Đã xử lý và được ghi vào Nhật ký; hệ thống không tự khóa ai.' : 'Cảnh báo chuyển sang Đã bỏ qua và không còn tính là đang mở.',
        reasonOptional: true, reasonMax: NOTE_MAX, reasonLabel: 'Ghi chú (không bắt buộc)',
        confirmText: done ? 'Xử lý' : 'Bỏ qua',
      });
      if (!res.ok || !alive()) return;
      const payload = { key, status };
      if (res.reason) payload.note = res.reason;
      busy.add(key);
      seq += 1; // hủy lần tải (poll) đang bay để không ghi đè trạng thái mới
      drawBody();
      try {
        await api.post('/admin/fraud-alerts/handle', payload, { signal });
        if (!alive()) return;
        seq += 1; // GET bắt đầu trong lúc POST có thể mang dữ liệu cũ
        // `data` có thể đã bị poll thay trong lúc mở hộp xác nhận: tìm lại phần tử hiện hành
        const current = data?.alerts.find((a) => a.key === key);
        if (current) {
          current.status = status;
          current.handled_at = new Date().toISOString();
          current.note = payload.note ?? null;
        }
        ctx.ui.toast(done ? 'Đã ghi nhận xử lý' : 'Đã bỏ qua cảnh báo');
        ctx.refreshWork();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Không xử lý được', 'err');
      } finally {
        busy.delete(key);
        if (alive() && data) drawBody();
      }
    }

    delegate(root, 'click', '[data-act="filter"]', (_e, el) => {
      filter = el.dataset.filter === filter ? 'all' : el.dataset.filter;
      history.replaceState(null, '', buildHash('alerts', { f: filter === 'all' ? '' : filter }));
      if (data) drawBody();
    });
    delegate(root, 'click', '[data-act="handled"]', (_e, el) => handle(el.dataset.key, 'handled'));
    delegate(root, 'click', '[data-act="dismissed"]', (_e, el) => handle(el.dataset.key, 'dismissed'));

    ctx.poll.add('screen:alerts', () => draw({ quiet: true }), { everyMs: REFRESH_MS });
    await draw();
  },

  destroy() {},
};
