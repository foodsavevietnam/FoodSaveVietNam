// Màn "Hàng đang bán" (Đợt 3): 3 ô số KPI từ GET /admin/labels, bảng phân trang & lọc server từ GET /admin/products
// (?page=&limit=50&label=&visibility=&q=), chạy đổi nhãn ngay (POST /admin/automation/label-automation/run)
// và ẩn / bỏ ẩn sản phẩm vi phạm (POST /admin/products/:id/visibility). Poll 120 giây.
import { left, stamp, vnd } from '../core/format.js';
import { isPollFailure } from '../core/poll.js';
import { buildHash } from '../core/router.js';
import { VI, badge } from '../core/vi.js';

const REFRESH_MS = 120000;
const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;
const LABELS = ['green', 'yellow', 'red'];
const TABS = [{ key: 'all', title: 'Tất cả' }, ...LABELS.map((key) => ({ key, title: VI.label[key][0] }))];
const VIS_FILTERS = [
  { key: 'all', title: 'Tất cả' },
  { key: 'visible', title: 'Đang hiện' },
  { key: 'hidden', title: 'Admin đã ẩn' },
];
const KPI_NAME = { green: 'Nhãn xanh', yellow: 'Nhãn vàng', red: 'Nhãn đỏ' };
const LEFT_COLOR = { ok: 'var(--ok)', warn: 'var(--warn)', err: 'var(--err)', m: 'var(--t3)' };

const own = (map, key) => key != null && Object.prototype.hasOwnProperty.call(map, key);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isHiddenProduct = (p) => Boolean(p?.admin_hidden_at || p?.admin_hidden || p?.visibility === 'hidden');

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
    let visibility = VIS_FILTERS.some((v) => v.key === ctx.params?.visibility) ? ctx.params.visibility : 'all';
    let query = String(ctx.params?.q ?? '');
    const pageParam = Number.parseInt(ctx.params?.page, 10);
    let page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;

    let data = null; // { counts, labelTotal, items, total, page, limit }
    let running = false;
    let busy = false;
    let searchTimer = null;

    const syncHash = () => {
      history.replaceState(null, '', buildHash('inventory', {
        label: tab === 'all' ? '' : tab,
        visibility: visibility === 'all' ? '' : visibility,
        q: query.trim() || '',
        page: page > 1 ? page : '',
      }));
    };

    const buildProductsPath = () => {
      const sp = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (tab !== 'all') sp.set('label', tab);
      if (visibility !== 'all') sp.set('visibility', visibility);
      if (query.trim()) sp.set('q', query.trim().slice(0, 80));
      return `/admin/products?${sp.toString()}`;
    };

    function labelBadge(code) {
      return own(VI.label, code) ? badge('label', code) : html`<span class="b b-m">Chưa rõ</span>`;
    }
    function deadline(l) {
      const d = left(l.effective_deadline_at || l.expires_at);
      return html`<span style="color:${LEFT_COLOR[d.level] || LEFT_COLOR.m};font-weight:600">${d.text}</span>`;
    }

    function rowHtml(p) {
      const hidden = isHiddenProduct(p);
      const storeName = p.store_name || p.stores?.name || p.store?.name || '—';
      const hiddenInfo = hidden
        ? html`<div style="margin-top:3px"><span class="b b-e">Admin ẩn</span>${raw(p.admin_hidden_reason ? html` <small style="color:var(--t3)">${p.admin_hidden_reason}</small>` : '')}</div>`
        : (p.is_active === false ? html`<div style="margin-top:3px"><span class="b b-m">Ngưng bán</span></div>` : '');
      const actBtn = hidden
        ? html`<button type="button" class="bt bt-p" data-act="visibility" data-action="unhide" data-id="${p.id}" data-name="${p.name || ''}"${raw(busy ? ' disabled' : '')}>Bỏ ẩn</button>`
        : html`<button type="button" class="bt b-e" data-act="visibility" data-action="hide" data-id="${p.id}" data-name="${p.name || ''}"${raw(busy ? ' disabled' : '')}>Ẩn</button>`;

      return html`<tr data-id="${p.id}">
        <td><b>${p.name || '—'}</b>${raw(hiddenInfo)}</td>
        <td>${storeName}</td>
        <td>${raw(labelBadge(p.label))}</td>
        <td>${p.stock_quantity ?? '—'}</td>
        <td><s style="color:var(--t3)">${vnd(p.original_price_cents)}</s> → <b>${vnd(p.price_cents)}</b></td>
        <td>${raw(deadline(p))}</td>
        <td>${p.label_changed_at ? stamp(p.label_changed_at) : '—'}</td>
        <td>${raw(actBtn)}</td>
      </tr>`;
    }

    function renderTable() {
      const items = data?.items || [];
      if (!items.length) {
        return html`<div style="padding:24px;text-align:center;color:var(--t3)">Không có sản phẩm nào khớp.</div>`;
      }
      const total = num(data?.total);
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const curPage = Math.min(Math.max(1, page), totalPages);
      let pager = '';
      if (totalPages > 1) {
        const start = Math.max(1, curPage - 2);
        const end = Math.min(totalPages, start + 4);
        const btns = [];
        if (curPage > 1) btns.push(html`<button type="button" class="bt" data-act="page" data-page="${curPage - 1}">Trước</button>`);
        for (let p = start; p <= end; p += 1) {
          btns.push(html`<button type="button" class="bt${raw(p === curPage ? ' bt-p' : '')}" data-act="page" data-page="${p}"${raw(p === curPage ? ' aria-current="page"' : '')}>${p}</button>`);
        }
        if (curPage < totalPages) btns.push(html`<button type="button" class="bt" data-act="page" data-page="${curPage + 1}">Sau</button>`);
        pager = html`<nav aria-label="Phân trang" style="display:flex;gap:6px;justify-content:space-between;align-items:center;padding:8px 12px">
          <small style="color:var(--t3)">Trang ${curPage}/${totalPages} · ${total} sản phẩm</small>
          <span style="display:flex;gap:6px">${raw(btns.join(''))}</span>
        </nav>`;
      }
      const head = ['Sản phẩm', 'Cửa hàng', 'Nhãn', 'Tồn', 'Giá gốc → giá bán', 'Hạn', 'Đổi nhãn lúc', 'Thao tác']
        .map((h) => html`<th>${h}</th>`).join('');
      return html`<table class="tbl" data-role="products-table"><thead><tr>${raw(head)}</tr></thead><tbody>${raw(items.map(rowHtml).join(''))}</tbody></table>${raw(pager)}`;
    }

    function drawTable() {
      const holder = body.querySelector('[data-role="table"]');
      if (!holder) return;
      holder.innerHTML = renderTable();
      const note = body.querySelector('[data-role="count-note"]');
      if (note) note.textContent = `${num(data?.total)} sản phẩm`;
    }

    function drawTabs() {
      const el = body.querySelector('[data-role="tabs"]');
      if (el) {
        const count = (key) => (key === 'all' ? data.labelTotal : data.counts?.[key] ?? 0);
        el.innerHTML = TABS.map((t) => html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-label="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title} (${count(t.key)})</button>`).join('');
      }
      const visEl = body.querySelector('[data-role="vis-filters"]');
      if (visEl) {
        visEl.innerHTML = VIS_FILTERS.map((v) => html`<button type="button" class="bt${raw(visibility === v.key ? ' bt-p' : '')}" data-act="vis" data-visibility="${v.key}"${raw(visibility === v.key ? ' aria-current="true"' : '')}>${v.title}</button>`).join('');
      }
    }

    function drawRun() {
      const btn = body.querySelector('[data-act="run-labels"]');
      if (btn) btn.disabled = running;
    }

    function drawBody() {
      const hadFocus = document.activeElement?.dataset?.role === 'inv-search';
      const kpis = LABELS.map((key) => html`<div class="K" data-role="kpi-${key}"><div class="K-l">${KPI_NAME[key]}</div>
        <div class="K-v">${data.counts?.[key] ?? 0}</div><div class="K-n">${raw(badge('label', key))}</div></div>`).join('');
      body.innerHTML = html`<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:12px">${raw(kpis)}</div>
        <section class="P"><div class="P-h"><span class="P-t">Hàng đang bán</span>
          <span class="P-a"><button type="button" class="bt bt-p" data-act="run-labels">Cập nhật nhãn ngay</button></span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 16px;border-bottom:1px solid var(--bd)">
            <span data-role="tabs" style="display:flex;gap:8px;flex-wrap:wrap" role="tablist"></span>
            <span data-role="vis-filters" style="display:flex;gap:6px;flex-wrap:wrap;padding-left:8px;border-left:1px solid var(--bd)" aria-label="Lọc hiển thị"></span>
            <input type="search" data-role="inv-search" placeholder="Tìm tên sản phẩm hoặc cửa hàng" aria-label="Tìm theo tên sản phẩm hoặc cửa hàng" maxlength="80" style="margin-left:auto;min-width:220px">
            <small data-role="count-note" style="color:var(--t3)"></small></div>
          <div class="W" data-role="table"></div></section>`;
      const searchEl = body.querySelector('[data-role="inv-search"]');
      searchEl.value = query;
      if (hadFocus) {
        searchEl.focus();
        searchEl.setSelectionRange(query.length, query.length);
      }
      drawTabs();
      drawTable();
      drawRun();
    }

    let seq = 0;
    async function draw({ quiet = false, rethrow = quiet } = {}) {
      const mine = ++seq;
      if (!quiet || !data) loading(body);
      try {
        const [labelsRes, productsRes] = await Promise.all([
          api.get('/admin/labels', { signal }),
          api.get(buildProductsPath(), { signal }),
        ]);
        if (!alive() || mine !== seq) return;
        const items = Array.isArray(productsRes?.items) ? productsRes.items : [];
        const pg = productsRes?.pagination || {};
        const total = Number.isFinite(Number(productsRes?.total)) ? Number(productsRes.total)
          : (Number.isFinite(Number(pg.total)) ? Number(pg.total) : items.length);
        const counts = labelsRes?.counts || productsRes?.counts?.by_label || productsRes?.counts || {};
        const labelTotal = Number.isFinite(Number(labelsRes?.total)) ? Number(labelsRes.total)
          : (num(counts.green) + num(counts.yellow) + num(counts.red));
        data = {
          counts,
          labelTotal,
          items,
          total,
          page: Number(productsRes?.page || pg.page) || page,
          limit: Number(productsRes?.limit || pg.limit) || PAGE_SIZE,
        };
        if (quiet && body.querySelector('[data-role="table"]')) {
          body.querySelectorAll('[data-role^="kpi-"]').forEach((el) => {
            const key = el.dataset.role.slice(4);
            el.querySelector('.K-v').textContent = String(data.counts?.[key] ?? 0);
          });
          drawTabs();
          drawTable();
        } else {
          drawBody();
        }
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet) {
          if (data) console.warn('[MIO] Không làm mới được hàng đang bán:', err);
          else error(body, err, () => draw());
          if (rethrow && isPollFailure(err)) throw err;
          return;
        }
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
        await draw({ quiet: true, rethrow: false });
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Không cập nhật được nhãn', 'err');
      } finally {
        running = false;
        if (alive()) drawRun();
      }
    }

    async function changeVisibility(id, action, productName) {
      if (busy || !id || (action !== 'hide' && action !== 'unhide')) return;
      const hiding = action === 'hide';
      const titleName = productName || 'sản phẩm này';
      const res = await ctx.ui.confirm({
        title: hiding ? `Ẩn sản phẩm "${titleName}"?` : `Bỏ ẩn sản phẩm "${titleName}"?`,
        body: hiding
          ? 'Sản phẩm bị gỡ khỏi danh mục người mua ngay lập tức và cửa hàng không thể tự bật lại cho tới khi Admin bỏ ẩn.'
          : 'Gỡ cờ ẩn của Admin và tính lại nhãn giá theo hạn sử dụng hiện tại.',
        danger: hiding,
        reasonRequired: hiding,
        reasonOptional: !hiding,
        reasonLabel: hiding ? 'Lý do ẩn sản phẩm (bắt buộc, ít nhất 3 ký tự)' : 'Ghi chú (không bắt buộc)',
        confirmText: hiding ? 'Ẩn sản phẩm' : 'Bỏ ẩn',
      });
      if (!res.ok || !alive()) return;
      busy = true;
      drawTable();
      try {
        const payload = { action, ...(res.reason ? { reason: res.reason } : {}) };
        await api.post(`/admin/products/${encodeURIComponent(id)}/visibility`, payload, { signal });
        if (!alive()) return;
        ctx.ui.toast(hiding ? 'Đã ẩn sản phẩm' : 'Đã bỏ ẩn sản phẩm');
        await draw({ quiet: true, rethrow: false });
        ctx.refreshWork();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Không cập nhật được hiển thị sản phẩm', 'err');
      } finally {
        busy = false;
        if (alive()) drawTable();
      }
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => {
      if (!data || el.dataset.label === tab) return;
      tab = el.dataset.label;
      page = 1;
      syncHash();
      draw({ quiet: true, rethrow: false });
    });
    delegate(root, 'click', '[data-act="vis"]', (_e, el) => {
      if (!data || el.dataset.visibility === visibility) return;
      visibility = el.dataset.visibility;
      page = 1;
      syncHash();
      draw({ quiet: true, rethrow: false });
    });
    delegate(root, 'input', '[data-role="inv-search"]', (_e, el) => {
      query = el.value;
      page = 1;
      syncHash();
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { searchTimer = null; if (alive()) draw({ quiet: true, rethrow: false }); }, SEARCH_DEBOUNCE_MS);
    });
    delegate(root, 'click', '[data-act="page"]', (_e, el) => {
      const next = Number(el.dataset.page) || 1;
      if (next !== page) {
        page = next;
        syncHash();
        draw({ quiet: true, rethrow: false });
      }
    });
    delegate(root, 'click', '[data-act="run-labels"]', () => runLabels());
    delegate(root, 'click', '[data-act="visibility"]', (_e, el) => changeVisibility(el.dataset.id, el.dataset.action, el.dataset.name));

    ctx.poll.add('screen:inventory', () => draw({ quiet: true }), { everyMs: REFRESH_MS });
    await draw();
  },

  destroy() {},
};
