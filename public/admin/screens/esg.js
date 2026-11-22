// Màn "Tác động ESG": chọn tháng (lưu trong hash #/esg?month=YYYY-MM), 4 ô số và bảng top cửa hàng. Không poll.
import { monthVn } from '../core/format.js';
import { buildHash } from '../core/router.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const num = (v) => nf.format(Number(v) || 0);

export function resolveMonth(value, fallback = monthVn()) {
  return MONTH_RE.test(String(value ?? '')) ? String(value) : fallback;
}

function delta(cur, prev) {
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  if (!p) return c ? 'Tháng trước: chưa có số liệu' : '';
  const pct = Math.round(((c - p) / p) * 100);
  return `So với tháng trước: ${pct >= 0 ? '+' : ''}${pct}%`;
}

export default {
  id: 'esg',
  title: 'Tác động ESG',
  group: 'TĂNG TRƯỞNG',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;

    let month = resolveMonth(ctx.params?.month);
    container.innerHTML = html`<div data-screen="esg">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <label style="font-size:.8rem">Tháng báo cáo <input id="esg_month" type="month" value="${month}" style="padding:6px"></label></div>
      <div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;
    let seq = 0;

    function draw(d) {
      const t = d?.total || {};
      const p = d?.previous || {};
      const kpi = (block, label, value, note) => html`<div class="K" data-block="${block}"><div class="K-l">${label}</div><div class="K-v">${value}</div><div class="K-n">${note}</div></div>`;
      const top = (d?.top_stores || []).map((s, i) => html`<tr><td>${i + 1}</td><td>${s.store_name || '—'}</td><td class="mn">${num(s.food_saved_kg)} kg</td><td class="mn">${num(s.meals_equivalent)}</td></tr>`).join('');
      body.innerHTML = html`${raw(d?.has_data ? '' : html`<div class="v2note">Tháng ${month} chưa có sự kiện tác động nào nên các số đều là 0.</div>`)}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px">
          ${raw(kpi('esg-food', 'Thực phẩm được cứu', `${num(t.food_saved_kg)} kg`, delta(t.food_saved_kg, p.food_saved_kg)))}
          ${raw(kpi('esg-co2', 'CO₂ tránh phát thải', `${num(t.co2_avoided_kg)} kg`, delta(t.co2_avoided_kg, p.co2_avoided_kg)))}
          ${raw(kpi('esg-meals', 'Suất ăn tương đương', num(t.meals_equivalent), delta(t.meals_equivalent, p.meals_equivalent)))}
          ${raw(kpi('esg-orders', 'Đơn hoàn tất', num(d?.orders_completed), `Lô quyên góp hoàn tất: ${num(d?.donations_delivered)}`))}
        </div>
        <section class="P"><div class="P-h"><span class="P-t">Top cửa hàng</span></div><div class="W">
          <table class="tbl"><thead><tr>${raw(['#', 'Cửa hàng', 'Thực phẩm', 'Suất ăn'].map((h) => html`<th>${h}</th>`).join(''))}</tr></thead>
          <tbody>${raw(top || html`<tr><td colspan="4" style="text-align:center;color:var(--t3);padding:18px">Chưa có dữ liệu.</td></tr>`)}</tbody></table></div></section>
        ${raw(d?.note ? html`<p class="v2note" style="margin-top:14px">${d.note}</p>` : '')}`;
    }

    async function load() {
      const mine = ++seq;
      loading(body);
      try {
        const d = await api.get(`/admin/esg?month=${encodeURIComponent(month)}`, { signal });
        if (!alive() || mine !== seq) return;
        draw(d);
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        error(body, err, () => load());
      }
    }

    delegate(root, 'change', '#esg_month', (_e, el) => {
      if (!MONTH_RE.test(el.value) || el.value === month) return;
      month = el.value;
      history.replaceState(null, '', buildHash('esg', { month }));
      load();
    });

    await load();
  },

  destroy() {},
};
