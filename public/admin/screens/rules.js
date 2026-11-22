// Màn "Quy tắc & tự động": 2 tab (Quy tắc đơn hàng chỉnh được, Tác vụ tự động), tab lưu trong hash (#/rules?tab=...).
// Kiểm tra phía client khớp policyConfigService.validatePolicy (server vẫn là nơi quyết định cuối cùng).
// Poll 60 giây CHỈ ở tab Tự động.
import { stamp } from '../core/format.js';
import { badge } from '../core/vi.js';

const REFRESH_MS = 60000;
const TABS = [
  { key: 'policy', title: 'Quy tắc đơn hàng' },
  { key: 'automation', title: 'Tác vụ tự động' },
];
const LABELS = [
  { key: 'green', name: 'Xanh', meaning: 'Còn hạn dài' },
  { key: 'yellow', name: 'Vàng', meaning: 'Cận hạn' },
  { key: 'red', name: 'Đỏ', meaning: 'Sắp hết hạn' },
];
// Trường theo nhãn: [khóa API, mã ô, nhãn tiếng Việt, đơn vị, min, max]
const LABEL_FIELDS = [
  ['payMinutes', 'pay', 'Hạn thanh toán', 'phút', 1, 60],
  ['pickupMinutes', 'pick', 'Hạn lấy hàng', 'phút', 15, 1440],
  ['cancelFreeBeforePickupMinutes', 'free', 'Hủy miễn phí trước hạn lấy', 'phút', 1, 1440],
  ['finalReminderMinutes', 'rem', 'Nhắc cuối còn', 'phút', 1, 1440],
];
const GENERAL_FIELDS = [
  ['grace_cancel_minutes', 'Hủy miễn phí cực ngắn sau thanh toán', 'phút', 0, 30],
  ['min_pickup_window_minutes', 'Còn tối thiểu tới hạn sử dụng mới cho đặt', 'phút', 5, 240],
  ['no_show_ban_count', 'Số lần vắng mặt để khóa nhãn đỏ', 'lần', 2, 10],
  ['no_show_window_days', 'Trong khoảng', 'ngày', 7, 365],
  ['red_ban_days', 'Khóa nhãn đỏ', 'ngày', 1, 365],
];

const list = (v) => (Array.isArray(v) ? v : v?.items || []);
const isInt = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

// Nhận cấu hình từ form (số hoặc NaN), trả danh sách lỗi tiếng Việt.
export function policyErrors(c) {
  const e = [];
  for (const l of LABELS) {
    const p = c.labels[l.key];
    for (const [key, , label, , min, max] of LABEL_FIELDS) {
      if (!isInt(p[key], min, max)) e.push(`Nhãn ${l.name}: ${label.toLowerCase()} phải là số nguyên từ ${min} đến ${max} phút`);
    }
    if (isInt(p.pickupMinutes, 15, 1440) && isInt(p.cancelFreeBeforePickupMinutes, 1, 1440) && p.cancelFreeBeforePickupMinutes >= p.pickupMinutes) {
      e.push(`Nhãn ${l.name}: thời gian hủy miễn phí (${p.cancelFreeBeforePickupMinutes}) phải nhỏ hơn hạn lấy hàng (${p.pickupMinutes})`);
    }
    if (isInt(p.pickupMinutes, 15, 1440) && isInt(p.finalReminderMinutes, 1, 1440) && p.finalReminderMinutes >= p.pickupMinutes) {
      e.push(`Nhãn ${l.name}: mốc nhắc cuối (${p.finalReminderMinutes}) phải nhỏ hơn hạn lấy hàng (${p.pickupMinutes})`);
    }
  }
  for (const [key, label, unit, min, max] of GENERAL_FIELDS) {
    if (!isInt(c[key], min, max)) e.push(`${label} phải là số nguyên từ ${min} đến ${max} ${unit}`);
  }
  if (isInt(c.grace_cancel_minutes, 0, 30)) {
    for (const l of LABELS) {
      const pick = c.labels[l.key].pickupMinutes;
      if (isInt(pick, 15, 1440) && c.grace_cancel_minutes >= pick) {
        e.push(`Hủy miễn phí cực ngắn (${c.grace_cancel_minutes}) phải nhỏ hơn hạn lấy hàng của nhãn ${l.name}`);
      }
    }
  }
  return e;
}

export default {
  id: 'rules',
  title: 'Quy tắc & tự động',
  group: 'HỆ THỐNG',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div data-screen="rules"><div data-role="tabs"></div><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    const tab = TABS.some((t) => t.key === ctx.params?.tab) ? ctx.params.tab : 'policy';
    root.querySelector('[data-role="tabs"]').innerHTML = html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(
      TABS.map((t) => html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-tab="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title}</button>`).join(''),
    )}</div>`;

    let busy = false; // đang lưu / khôi phục
    const running = new Set(); // job đang chạy tay
    let seq = 0;

    // ---------- Tab Quy tắc ----------
    let policy = null;
    let baseline = ''; // JSON cấu hình đã tải, để biết có thay đổi hay không
    let serverError = '';

    const num = (id) => {
      const el = body.querySelector(`#${id}`);
      const v = el ? String(el.value).trim() : '';
      return v === '' ? NaN : Number(v);
    };
    function readForm() {
      const labels = {};
      for (const l of LABELS) {
        labels[l.key] = {};
        for (const [key, code] of LABEL_FIELDS) labels[l.key][key] = num(`pf_${l.key}_${code}`);
      }
      const cfg = { labels };
      for (const [key] of GENERAL_FIELDS) cfg[key] = num(`pf_${key}`);
      return cfg;
    }
    const snapshot = (cfg) => JSON.stringify(cfg);
    const fromPolicy = (d) => {
      const cfg = { labels: {} };
      for (const l of LABELS) {
        cfg.labels[l.key] = {};
        for (const [key] of LABEL_FIELDS) cfg.labels[l.key][key] = Number(d.labels?.[l.key]?.[key]);
      }
      for (const [key] of GENERAL_FIELDS) cfg[key] = Number(d[key]);
      return cfg;
    };

    function syncForm() {
      if (!body.querySelector('[data-act="save"]')) return;
      const cfg = readForm();
      const errs = policyErrors(cfg);
      const box = body.querySelector('[data-role="errors"]');
      const items = [...errs];
      if (serverError) items.push(serverError);
      box.hidden = items.length === 0;
      box.innerHTML = items.length ? html`<ul style="margin:0;padding-left:18px">${raw(items.map((m) => html`<li>${m}</li>`).join(''))}</ul>` : '';
      body.querySelector('[data-act="save"]').disabled = busy || errs.length > 0 || snapshot(cfg) === baseline;
      body.querySelector('[data-act="reset"]').disabled = busy;
    }

    const input = (id, v, min, max) => html`<input id="${id}" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${v}" style="width:84px;padding:6px">`;

    function drawPolicy() {
      const d = policy;
      const scale = d.time_scale !== undefined && d.time_scale !== 1
        ? html`<div class="v2note" data-role="time-scale" style="border-color:#e6c76a;background:#fdf8e8"><b>Đang bật chế độ rút ngắn thời gian ×${d.time_scale}</b> (chế độ thử nghiệm). Mọi hạn được nhân hệ số này. Môi trường thật luôn là 1.</div>` : '';
      const who = d.stored
        ? `Cập nhật lần cuối ${stamp(d.updated_at)}.`
        : 'Chưa từng lưu: đang dùng giá trị mặc định của hệ thống.';
      const rows = LABELS.map((l) => html`<tr data-label="${l.key}"><td>${raw(badge('label', l.key))}</td><td>${l.meaning}</td>${raw(
        LABEL_FIELDS.map(([key, code, , , min, max]) => html`<td>${raw(input(`pf_${l.key}_${code}`, d.labels[l.key][key], min, max))}</td>`).join(''),
      )}</tr>`).join('');
      const general = GENERAL_FIELDS.map(([key, label, unit, min, max]) => html`<label>${label} (${unit})<br>${raw(input(`pf_${key}`, d[key], min, max))}</label>`).join('');
      const rep = d.reputation;
      let repPanel = '';
      if (rep) {
        const pts = [
          ['Người mua nhận hàng thành công', `+${rep.pickupSuccessDelta}`], ['Người mua vắng mặt', String(rep.noShowDelta)],
          ['Hủy muộn', String(rep.lateCancelDelta)], ['Khiếu nại sai sự thật', String(rep.falseComplaintDelta)],
          ['Cửa hàng giao thành công', '+5'], ['Cửa hàng hủy / hết hàng ảo', '−15'], ['Khiếu nại đúng (cửa hàng)', '−15'],
        ];
        repPanel = html`<section class="P" style="margin-top:16px" data-role="reputation"><div class="P-h"><span class="P-t">Điểm uy tín (chỉ đọc)</span></div><div class="W">
          <table class="tbl"><thead><tr><th>Hành vi</th><th>Điểm</th></tr></thead><tbody>${raw(pts.map((p) => html`<tr><td>${p[0]}</td><td class="mn" style="color:${p[1].startsWith('+') ? 'var(--ok)' : 'var(--err)'}">${p[1]}</td></tr>`).join(''))}</tbody></table>
          <p style="font-size:.78rem;padding:8px 16px;color:var(--t2)">Điểm dưới ${rep.blockedBelow}: chặn đặt hàng. ${d.no_show_ban_count} lần vắng mặt trong ${d.no_show_window_days} ngày: khóa mua nhãn đỏ ${d.red_ban_days} ngày.</p></div></section>`;
      }
      const head = ['Nhãn', 'Ý nghĩa', ...LABEL_FIELDS.map((f) => `${f[2]} (${f[3]})`)];
      body.innerHTML = html`<div class="v2note">Chỉnh được. ${who} Đơn đã tạo giữ nguyên hạn cũ; chỉ đơn mới áp dụng giá trị mới. Mọi lần lưu được ghi vào Nhật ký.</div>
        ${raw(scale)}
        <section class="P"><div class="P-h"><span class="P-t">Thời hạn theo nhãn</span></div><div class="W">
          <table class="tbl" data-role="policy-table"><thead><tr>${raw(head.map((h) => html`<th>${h}</th>`).join(''))}</tr></thead><tbody>${raw(rows)}</tbody></table></div></section>
        <section class="P" style="margin-top:16px"><div class="P-h"><span class="P-t">Quy tắc chung</span></div>
          <div style="display:flex;gap:18px;flex-wrap:wrap;padding:12px 14px;font-size:.82rem">${raw(general)}</div></section>
        <div data-role="errors" class="v2note" role="alert" style="border-color:#f1b0ab;background:#fdf1f0;margin-top:12px" hidden></div>
        <div style="padding:12px 0"><button type="button" class="bt bt-p" data-act="save">Lưu cấu hình</button>
          <button type="button" class="bt" data-act="reset">Khôi phục mặc định</button>
          <small style="color:var(--t3)">Phí nền tảng: ${Number(d.platform_fee).toLocaleString('vi-VN')}đ/đơn (cố định trong hệ thống)</small></div>
        ${raw(repPanel)}`;
      syncForm();
    }

    async function loadPolicy() {
      const mine = ++seq;
      loading(body);
      try {
        const d = await api.get('/admin/order-policy', { signal });
        if (!alive() || mine !== seq) return;
        policy = d;
        baseline = snapshot(fromPolicy(d));
        serverError = '';
        drawPolicy();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        error(body, err, () => loadPolicy());
      }
    }

    async function savePolicy() {
      if (busy) return;
      const cfg = readForm();
      if (policyErrors(cfg).length || snapshot(cfg) === baseline) { syncForm(); return; }
      const res = await ctx.ui.confirm({ title: 'Lưu cấu hình?', body: 'Đơn đã tạo giữ nguyên hạn cũ; chỉ đơn MỚI áp dụng giá trị mới.', confirmText: 'Lưu cấu hình' });
      if (!res.ok || !alive()) return;
      busy = true; serverError = ''; syncForm();
      try {
        await api.put('/admin/order-policy', cfg, { signal });
        if (!alive()) return;
        busy = false;
        ctx.ui.toast('Đã lưu cấu hình');
        await loadPolicy();
        ctx.refreshWork();
      } catch (err) {
        if (err?.name === 'AbortError' || !alive()) return;
        serverError = err?.message || 'Không lưu được cấu hình';
        if (err?.code !== 'VALIDATION_ERROR') ctx.ui.toast(serverError, 'err');
      } finally {
        busy = false;
        if (alive() && policy) syncForm(); // giữ nguyên dữ liệu đã nhập khi lỗi
      }
    }

    async function resetPolicy() {
      if (busy) return;
      const res = await ctx.ui.confirm({ title: 'Khôi phục mặc định?', body: 'Khôi phục toàn bộ về giá trị mặc định của hệ thống. Đơn đã tạo giữ nguyên hạn cũ.', danger: true, confirmText: 'Khôi phục' });
      if (!res.ok || !alive()) return;
      busy = true; syncForm();
      try {
        await api.post('/admin/order-policy/reset', {}, { signal });
        if (!alive()) return;
        busy = false;
        ctx.ui.toast('Đã khôi phục mặc định');
        await loadPolicy();
        ctx.refreshWork();
      } catch (err) {
        if (err?.name === 'AbortError' || !alive()) return;
        ctx.ui.toast(err?.message || 'Không khôi phục được', 'err');
      } finally {
        busy = false;
        if (alive() && policy) syncForm();
      }
    }

    // ---------- Tab Tự động ----------
    let jobs = null;

    function drawAutomationBody() {
      const rows = jobs.map((j) => {
        const l = j.last_run;
        const result = !l ? html`<span class="b b-m">Chưa có lần chạy</span>` : l.ok ? html`<span class="b b-ok">OK</span>` : html`<span class="b b-e">Lỗi</span>`;
        const fail = j.last_failure ? html`<small style="color:var(--err)">${stamp(j.last_failure.started_at)}: ${j.last_failure.error}</small>` : '—';
        const lock = running.has(j.job);
        const off = lock ? raw(' disabled') : '';
        return html`<tr data-job="${j.job}"><td><b>${j.name}</b></td><td>${j.schedule}</td>
          <td>${l ? stamp(l.started_at) : '—'} ${raw(result)}</td><td>${raw(fail)}</td>
          <td>${j.runs_7d} lần / ${j.failures_7d} lỗi</td>
          <td><button type="button" class="bt bt-s bt-p" data-act="run" data-id="${j.job}"${off}>${lock ? 'Đang chạy…' : 'Chạy ngay'}</button></td></tr>`;
      }).join('');
      body.innerHTML = html`<div class="v2note">Các tác vụ tự chạy theo lịch. Bảng lấy từ nhật ký chạy thật trong 7 ngày; "Chạy ngay" dùng khi thử nghiệm hoặc cần xử lý gấp.</div>
        <section class="P"><div class="P-h"><span class="P-t">Tác vụ tự động</span></div><div class="W">
          <table class="tbl" data-role="automation-table"><thead><tr>${raw(['Tác vụ', 'Lịch', 'Lần chạy gần nhất', 'Lỗi gần nhất', '7 ngày qua', ''].map((h) => html`<th>${h}</th>`).join(''))}</tr></thead>
          <tbody>${raw(rows || html`<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:18px">Chưa có tác vụ nào.</td></tr>`)}</tbody></table></div></section>`;
    }

    async function drawAutomation({ quiet = false } = {}) {
      const mine = ++seq;
      if (!quiet || !jobs) loading(body);
      try {
        const d = await api.get('/admin/automation', { signal });
        if (!alive() || mine !== seq) return;
        jobs = list(d);
        drawAutomationBody();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet && jobs) { console.warn('[MIO] Không làm mới được tác vụ tự động:', err); return; }
        error(body, err, () => drawAutomation());
      }
    }

    async function runJob(job) {
      if (running.has(job)) return;
      const found = jobs?.find((j) => j.job === job);
      const res = await ctx.ui.confirm({ title: `Chạy ngay "${found?.name || 'tác vụ'}"?`, body: 'Tác vụ chạy một lần ngay bây giờ, ngoài lịch tự động.', confirmText: 'Chạy ngay' });
      if (!res.ok || !alive()) return;
      running.add(job);
      if (jobs) drawAutomationBody();
      try {
        await api.post(`/admin/automation/${encodeURIComponent(job)}/run`, {}, { signal });
        if (!alive()) return;
        ctx.ui.toast('Đã chạy xong');
      } catch (err) {
        if (err?.name === 'AbortError' || !alive()) return;
        ctx.ui.toast(err?.message || 'Chạy thất bại', 'err');
      } finally {
        running.delete(job);
      }
      if (!alive()) return;
      await drawAutomation({ quiet: true });
      ctx.refreshWork();
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => { if (el.dataset.tab !== tab) ctx.navigate('rules', { tab: el.dataset.tab }); });
    delegate(root, 'click', '[data-act="save"]', () => savePolicy());
    delegate(root, 'click', '[data-act="reset"]', () => resetPolicy());
    delegate(root, 'click', '[data-act="run"]', (_e, el) => runJob(el.dataset.id));
    delegate(root, 'input', 'input[type="number"]', () => { if (policy) { serverError = ''; syncForm(); } });

    if (tab === 'automation') {
      ctx.poll.add('screen:rules', () => drawAutomation({ quiet: true }), { everyMs: REFRESH_MS });
      await drawAutomation();
    } else {
      ctx.poll.remove('screen:rules');
      await loadPolicy();
    }
  },

  destroy() {},
};
