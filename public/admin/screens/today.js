// Màn "Hôm nay": việc cần làm theo mức khẩn (Đỏ/Vàng/Xám) và 4 ô số.
// Số việc lấy từ state.work do app tự làm mới (không gọi lại /admin/dashboard/work ở đây).
import { vnd, stamp, monthVn } from '../core/format.js';
import { VI } from '../core/vi.js';

const REFRESH_MS = 120000;

// Mỗi dòng: số lấy từ khóa `key` của dashboard/work, bấm → màn `screen`.
const LEVELS = [
  { level: 'e', title: 'Đỏ — cần xử lý ngay', rows: [
    { key: 'complaints_waiting_admin', screen: 'complaints', text: 'khiếu nại chờ Admin quyết định' },
    { key: 'withdrawals_requested', screen: 'payouts', text: 'lệnh rút tiền chờ duyệt' },
  ] },
  { level: 'w', title: 'Vàng — nên xử lý trong ngày', rows: [
    { key: 'verification_pending', screen: 'verify', text: 'hồ sơ chờ duyệt' },
    { key: 'payout_accounts_pending', screen: 'verify', text: 'tài khoản nhận tiền chờ xác minh' },
    { key: 'fraud_open', screen: 'alerts', text: 'cảnh báo gian lận đang mở' },
  ] },
  { level: 'm', title: 'Xám — theo dõi', rows: [
    { key: 'customers_locked', screen: 'customers', text: 'khách đang bị khóa nhãn đỏ' },
    { key: 'automation_failed', screen: 'rules', text: 'tác vụ tự động bị lỗi' },
    { key: 'ledger_unbalanced', screen: 'ledger', text: 'sổ cái đang lệch' },
  ] },
];

const num = (v) => Number(v) || 0;
const fmtNum = (v) => num(v).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const ago = (iso) => (iso ? stamp(iso) : 'chưa chạy');

let off = null; // hủy đăng ký state của lần vẽ hiện tại

export default {
  id: 'today',
  title: 'Hôm nay',
  group: 'HÔM NAY',

  async render(container, ctx) {
    const { html, raw, delegate, loading, empty, error } = ctx.ui;
    const { api, state, signal } = ctx;
    this.destroy();

    container.innerHTML = html`<div data-screen="today">
      <section class="P" data-role="work" aria-label="Việc cần làm">
        <div class="P-h"><span class="P-t">VIỆC CẦN LÀM</span></div>
        <div data-role="work-body" style="padding:8px 16px 14px"></div>
      </section>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px">
        <div class="K" data-block="finance"></div>
        <div class="K" data-block="today"></div>
        <div class="K" data-block="esg"></div>
        <div class="K" data-block="labels"></div>
      </div>
      <section class="P" data-block="automation" aria-label="Tác vụ tự động"></section>
    </div>`;
    const root = container.firstElementChild;
    const q = (name) => root.querySelector(`[data-block="${name}"]`);
    const workBody = root.querySelector('[data-role="work-body"]');
    const alive = () => !signal.aborted && root.isConnected;

    // Khối nào cũng gồm: nơi vẽ, địa chỉ API, hàm vẽ. Lỗi/tải lại chỉ trong khối đó.
    const kpi = (label, value, note) => html`<div class="K-l">${label}</div><div class="K-v">${value}</div><div class="K-n">${note}</div>`;
    const blocks = {
      finance: {
        url: () => '/admin/finance/summary',
        draw: (d) => kpi('Tiền đang giữ', vnd(d?.wallets?.escrow),
          `Nền tảng ${vnd(d?.wallets?.platform)} · Ví cửa hàng ${vnd(d?.store_wallets_total)} · ${d?.reconcile?.ok === false ? 'Sổ cái đang lệch' : 'Sổ cái khớp'}`),
      },
      labels: {
        url: () => '/admin/labels',
        draw: (d) => {
          const counts = d?.counts || {};
          const line = (code) => html`<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">${raw(badgeOf(code))}<b style="font-family:var(--m)">${num(counts[code])}</b></div>`;
          return html`<div class="K-l">Hàng theo nhãn</div>${raw(['green', 'yellow', 'red'].map(line).join(''))}`;
        },
      },
      esg: {
        url: () => `/admin/esg?month=${monthVn()}`,
        draw: (d) => kpi('Tháng này', `${fmtNum(d?.total?.food_saved_kg)} kg`,
          `thực phẩm được cứu · ${fmtNum(d?.total?.meals_equivalent)} suất ăn · CO₂ ${fmtNum(d?.total?.co2_avoided_kg)} kg`),
      },
      automation: {
        url: () => '/admin/automation',
        draw: (d) => {
          const jobs = Array.isArray(d) ? d : [];
          const rows = jobs.map((j) => {
            const failed = j.last_run && j.last_run.ok === false;
            const tag = failed ? html`<span class="b b-e">Lỗi</span>` : j.last_run ? html`<span class="b b-ok">Tốt</span>` : html`<span class="b b-m">Chưa chạy</span>`;
            return html`<div class="DR"><div class="DR-v">${j.name || j.job}</div><div class="DR-l" style="width:auto;text-align:right">${raw(tag)} ${ago(j.last_run?.started_at)}</div></div>`;
          }).join('');
          return html`<div class="P-h"><span class="P-t">Tác vụ tự động</span></div>${raw(rows || html`<div style="padding:16px;color:var(--t3)">Chưa có tác vụ nào.</div>`)}`;
        },
      },
    };
    const badgeOf = (code) => html`<span class="b b-${raw(VI.label[code][1])}">${VI.label[code][0]}</span>`;

    const loaded = {}; // khối đã có dữ liệu tốt (làm mới nền thất bại thì giữ nguyên)
    async function loadBlock(name, { quiet = false } = {}) {
      const box = q(name);
      const block = blocks[name];
      if (!quiet || !loaded[name]) loading(box);
      try {
        const data = await api.get(block.url(), { signal });
        if (!alive()) return;
        loaded[name] = true;
        box.innerHTML = block.draw(data);
      } catch (err) {
        if (!alive() || err?.name === 'AbortError') return;
        if (quiet && loaded[name]) { console.warn(`[MIO] Không làm mới được khối ${name}:`, err); return; }
        error(box, err, () => loadBlock(name));
      }
    }

    function drawWork() {
      const work = state.work;
      if (!work) return;
      const sections = LEVELS.map(({ level, title, rows }) => {
        const lines = rows.filter((r) => num(work[r.key]) > 0).map((r) => html`<button type="button" class="bt" data-act="go" data-screen="${r.screen}"
          style="display:flex;width:100%;justify-content:space-between;align-items:center;text-align:left;padding:9px 12px;margin-top:6px">
          <span><b style="font-family:var(--m)">${num(work[r.key])}</b> ${r.text}</span><span aria-hidden="true">→</span></button>`);
        return lines.length
          ? html`<div data-level="${level}" style="margin-top:10px"><span class="b b-${raw(level)}">${title}</span>${raw(lines.join(''))}</div>`
          : '';
      }).join('');
      if (sections) workBody.innerHTML = sections;
      else empty(workBody, 'Hôm nay chưa có việc cần xử lý');
    }

    function drawToday() {
      const work = state.work;
      const box = q('today');
      if (!work) { loading(box); return; }
      const o = work.orders_today || {};
      box.innerHTML = kpi('Hôm nay', `${num(o.new)} đơn mới`,
        `${num(o.completed)} hoàn thành · ${num(o.no_show)} khách vắng mặt · ${num(work.donations_open)} lô tặng đang mở · ${num(work.tracking_active)} đang theo dõi`);
    }

    function drawAll() { drawWork(); drawToday(); }

    delegate(root, 'click', '[data-act="go"]', (_e, el) => ctx.navigate(el.dataset.screen));

    // Tải số việc: refreshWork của app nuốt lỗi (chỉ console.warn), nên thất bại = state.work vẫn chưa có
    async function loadWork() {
      loading(workBody);
      drawToday();
      await ctx.refreshWork();
      if (!alive()) return;
      if (state.work) { drawAll(); return; }
      const failure = { message: 'Không tải được số việc cần làm.' };
      error(workBody, failure, loadWork);
      error(q('today'), failure, loadWork);
    }

    off = state.subscribe((key) => { if (key === 'work' && alive()) drawAll(); });
    if (state.work) drawAll();
    else loadWork();

    const refreshOthers = () => Promise.all(Object.keys(blocks).map((name) => loadBlock(name, { quiet: true })));
    ctx.poll.add('screen:today', refreshOthers, { everyMs: REFRESH_MS });
    await Promise.all(Object.keys(blocks).map((name) => loadBlock(name)));
  },

  destroy() {
    off?.();
    off = null;
  },
};
