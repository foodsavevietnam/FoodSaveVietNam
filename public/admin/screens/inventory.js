// Màn "Hàng đang bán": các lô đang bán (tối đa 500) theo nhãn xanh/vàng/đỏ, từ GET /admin/labels.
// Tab nhãn lưu trong hash (#/inventory?label=...). Poll 120 giây. Hành động ghi duy nhất: chạy đổi nhãn ngay.
import { left, stamp, vnd } from '../core/format.js';
import { buildHash } from '../core/router.js';
import { dataTable } from '../core/table.js';
import { VI, badge } from '../core/vi.js';

const REFRESH_MS = 120000;
const PAGE_SIZE = 50;
const LABELS = ['green', 'yellow', 'red'];
const TABS = [{ key: 'all', title: 'Tất cả' }, ...LABELS.map((key) => ({ key, title: VI.label[key][0] }))];
const KPI_NAME = { green: 'Nhãn xanh', yellow: 'Nhãn vàng', red: 'Nhãn đỏ' };
const LEFT_COLOR = { ok: 'var(--ok)', warn: 'var(--warn)', err: 'var(--err)', m: 'var(--t3)' };

const norm = (s) => String(s ?? '').toLocaleLowerCase('vi');

export default {
  id: 'inventory',
  title: 'Hàng đang bán',
  group: 'HOẠT ĐỘNG',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div data-screen="inventory"><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    let tab = TABS.some((t) => t.key === ctx.params?.label) ? ctx.params.label : 'all';
    let query = '';
    let data = null; // { counts, total, lots }
    let table = null;
    let running = false;

    const lotsInTab = () => data.lots.filter((l) => (tab === 'all' || l.label === tab)
      && (!query || norm(l.name).includes(query) || norm(l.store_name).includes(query)));

    function labelBadge(code) {
      return Object.prototype.hasOwnProperty.call(VI.label, code) ? badge('label', code) : html`<span class="b b-m">Chưa rõ</span>`;
    }
    function deadline(l) {
      const d = left(l.effective_deadline_at || l.expires_at);
      return html`<span style="color:${LEFT_COLOR[d.level] || LEFT_COLOR.m};font-weight:600">${d.text}</span>`;
    }

    const columns = [
      { key: 'name', label: 'Sản phẩm', render: (l) => html`<b>${l.name || '—'}</b>` },
      { key: 'store_name', label: 'Cửa hàng', render: (l) => html`${l.store_name || '—'}` },
      { key: 'label', label: 'Nhãn', render: (l) => labelBadge(l.label) },
      { key: 'stock_quantity', label: 'Tồn', render: (l) => html`${l.stock_quantity ?? '—'}` },
      { key: 'price_cents', label: 'Giá gốc → giá bán', render: (l) => html`<s style="color:var(--t3)">${vnd(l.original_price_cents)}</s> → <b>${vnd(l.price_cents)}</b>` },
      { key: 'expires_at', label: 'Hạn', render: deadline },
      { key: 'label_changed_at', label: 'Đổi nhãn lúc', render: (l) => html`${l.label_changed_at ? stamp(l.label_changed_at) : '—'}` },
    ];

    function drawTable(keepPage = 1) {
      const holder = body.querySelector('[data-role="table"]');
      if (!holder) return;
      table = dataTable({ columns, rows: lotsInTab(), pageSize: PAGE_SIZE, emptyText: 'Không có sản phẩm nào khớp.' });
      table.state.page = Math.min(keepPage, table.state.pages);
      holder.innerHTML = table.html();
      const note = body.querySelector('[data-role="count-note"]');
      if (note) note.textContent = `${table.state.source.length} sản phẩm`;
    }

    function drawTabs() {
      const el = body.querySelector('[data-role="tabs"]');
      if (!el) return;
      const count = (key) => (key === 'all' ? data.total : data.counts?.[key] ?? 0);
      el.innerHTML = TABS.map((t) => html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-label="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title} (${count(t.key)})</button>`).join('');
    }

    function drawRun() {
      const btn = body.querySelector('[data-act="run-labels"]');
      if (btn) btn.disabled = running;
    }

    function drawBody() {
      const kpis = LABELS.map((key) => html`<div class="K" data-role="kpi-${key}"><div class="K-l">${KPI_NAME[key]}</div>
        <div class="K-v">${data.counts?.[key] ?? 0}</div><div class="K-n">${raw(badge('label', key))}</div></div>`).join('');
      body.innerHTML = html`<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:12px">${raw(kpis)}</div>
        <section class="P"><div class="P-h"><span class="P-t">Hàng đang bán</span>
          <span class="P-a"><button type="button" class="bt" data-role="soon-hide" disabled title="Sắp có — cần API mới">Ẩn sản phẩm vi phạm (Sắp có)</button>
          <button type="button" class="bt bt-p" data-act="run-labels">Cập nhật nhãn ngay</button></span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 16px;border-bottom:1px solid var(--bd)">
            <span data-role="tabs" style="display:flex;gap:8px;flex-wrap:wrap" role="tablist"></span>
            <input type="search" data-role="inv-search" placeholder="Tìm tên sản phẩm hoặc cửa hàng" aria-label="Tìm theo tên sản phẩm hoặc cửa hàng" value="${query}" style="margin-left:auto;min-width:220px">
            <small data-role="count-note" style="color:var(--t3)"></small></div>
          <p style="font-size:.72rem;color:var(--t3);padding:8px 16px;margin:0">Sắp có: ẩn sản phẩm vi phạm cần API mới. Danh sách hiện tối đa 500 lô đang bán, xếp theo nhãn rồi hạn gần nhất.</p>
          <div class="W" data-role="table"></div></section>`;
      drawTabs();
      drawTable();
      drawRun();
    }

    let seq = 0;
    async function draw({ quiet = false } = {}) {
      const mine = ++seq;
      if (!quiet || !data) loading(body);
      try {
        const res = await api.get('/admin/labels', { signal });
        if (!alive() || mine !== seq) return;
        const keepPage = table?.state.page || 1;
        data = { counts: res?.counts || {}, total: Number(res?.total) || 0, lots: Array.isArray(res?.lots) ? res.lots : [] };
        if (quiet && body.querySelector('[data-role="table"]')) {
          // Làm mới nền: giữ ô tìm kiếm và trang đang xem
          body.querySelectorAll('[data-role^="kpi-"]').forEach((el) => {
            const key = el.dataset.role.slice(4);
            el.querySelector('.K-v').textContent = String(data.counts?.[key] ?? 0);
          });
          drawTabs();
          drawTable(keepPage);
        } else drawBody();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet && data) { console.warn('[MIO] Không làm mới được hàng đang bán:', err); return; }
        error(body, err, () => draw());
      }
    }

    async function runLabels() {
      if (running || !data) return;
      const res = await ctx.ui.confirm({
        title: 'Cập nhật nhãn ngay?',
        body: 'Hệ thống đổi nhãn xanh/vàng/đỏ, giá giảm và gửi thông báo theo hạn dùng hiện tại, thay vì chờ lượt chạy định kỳ. Thao tác được ghi vào Nhật ký.',
        confirmText: 'Cập nhật nhãn',
      });
      if (!res.ok || !alive()) return;
      running = true;
      drawRun();
      try {
        await api.post('/admin/automation/label-automation/run', undefined, { signal });
        if (!alive()) return;
        ctx.ui.toast('Đã cập nhật nhãn và giá');
        await draw({ quiet: true });
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Không cập nhật được nhãn', 'err');
      } finally {
        running = false;
        if (alive()) drawRun();
      }
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => {
      if (!data || el.dataset.label === tab) return;
      tab = el.dataset.label;
      history.replaceState(null, '', buildHash('inventory', { label: tab === 'all' ? '' : tab }));
      drawTabs();
      drawTable();
    });
    delegate(root, 'input', '[data-role="inv-search"]', (_e, el) => {
      if (!data) return;
      query = norm(el.value.trim());
      drawTable();
    });
    delegate(root, 'click', '[data-act="page"]', (_e, el) => {
      if (!table) return;
      table.state.page = Number(el.dataset.page) || 1;
      body.querySelector('[data-role="table"]').innerHTML = table.html();
    });
    delegate(root, 'click', '[data-act="run-labels"]', () => runLabels());

    ctx.poll.add('screen:inventory', () => draw({ quiet: true }), { everyMs: REFRESH_MS });
    await draw();
  },

  destroy() {},
};
