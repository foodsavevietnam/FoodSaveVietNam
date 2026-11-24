// Màn "Tổ chức & tình nguyện viên": chỉ đọc. 3 tab (#/charities?tab=active|pending|volunteers).
// Chưa có API liệt kê mọi tổ chức nên tab "Đang hoạt động" suy ra từ 100 lô tặng gần nhất (GET /donations?limit=100).
// Tab "Chờ duyệt" lấy từ GET /admin/verification (duyệt ở #/verify). Drawer tổ chức đọc GET /charity/profiles/:id/volunteers.
// Tab "TNV đang làm nhiệm vụ" đọc GET /admin/live-locations?kind=volunteer. Không có hành động ghi, không hiện pickup_code.
import { dt, maskPhone } from '../core/format.js';

const TABS = [
  { key: 'active', title: 'Đang hoạt động' },
  { key: 'pending', title: 'Chờ duyệt' },
  { key: 'volunteers', title: 'TNV đang làm nhiệm vụ' },
];
const DUTY = { pickup: 'Lấy hàng', distribute: 'Phát hàng', both: 'Lấy và phát hàng' };
const VOL_STATUS = { new: ['Mới', 'b-b'], active: ['Đang hoạt động', 'b-ok'], inactive: ['Tạm nghỉ', 'b-m'] };
const COMING = [
  'Danh sách đầy đủ mọi tổ chức (cần API liệt kê tổ chức).',
  'Tạm ngưng một tổ chức (cần API đổi trạng thái tổ chức).',
  'Vô hiệu hóa tình nguyện viên (cần API quản trị tình nguyện viên).',
];

const list = (v) => (Array.isArray(v) ? v : v?.items || []);
const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null);

// Gom các lô tặng theo tổ chức nhận: { id, name, total, done, last }
export function groupCharities(donations) {
  const map = new Map();
  for (const d of donations) {
    const id = d?.charity_id || d?.charity_profiles?.id;
    if (!id) continue;
    const row = map.get(id) || { id, name: d?.charity_profiles?.name || '—', total: 0, done: 0, last: null };
    row.total += 1;
    if (d.status === 'completed') row.done += 1;
    if (d.created_at && (!row.last || d.created_at > row.last)) row.last = d.created_at;
    map.set(id, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || String(a.name).localeCompare(String(b.name), 'vi'));
}

export default {
  id: 'charities',
  title: 'Tổ chức & tình nguyện viên',
  group: 'HỒ SƠ',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div data-screen="charities"><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    const tab = TABS.some((t) => t.key === ctx.params?.tab) ? ctx.params.tab : 'active';
    let data = null; // { pending, active } hoặc { live }
    let seq = 0;
    let drawerSeq = 0;

    const emptyRow = (cols, text) => html`<tr><td colspan="${cols}" style="text-align:center;color:var(--t3);padding:18px">${text}</td></tr>`;
    const table = (role, head, rows) => html`<table class="tbl" data-role="${role}"><thead><tr>${raw(head.map((h) => html`<th>${h}</th>`).join(''))}</tr></thead><tbody>${raw(rows)}</tbody></table>`;
    const openBtn = (id) => html`<button type="button" class="bt bt-s" data-act="open" data-id="${id}">Xem tình nguyện viên</button>`;

    function activeMain() {
      const rows = data.active.map((c) => html`<tr><td><b>${c.name}</b></td><td>${c.total}</td><td>${c.done}</td><td>${dt(c.last)}</td><td>${raw(openBtn(c.id))}</td></tr>`).join('')
        || emptyRow(5, 'Chưa có tổ chức nào nhận lô trong 100 lô gần nhất.');
      return html`<p class="v2note" style="margin:0;padding:10px 16px">Danh sách lấy từ các lô tặng gần đây (tối đa 100 lô), nên chỉ gồm tổ chức đã từng nhận lô.</p>
        ${raw(table('active-table', ['Tổ chức', 'Số lô', 'Đã bàn giao', 'Lô gần nhất', ''], rows))}`;
    }
    function pendingMain() {
      const rows = data.pending.map((c) => html`<tr><td><b>${c.name}</b></td><td>${c.address || '—'}</td>
        <td>${c.email || '—'}<br><small style="color:var(--t3)">${c.phone ? maskPhone(c.phone) : '—'}</small></td><td>${dt(c.created_at)}</td>
        <td>${raw(openBtn(c.id))}</td></tr>`).join('') || emptyRow(5, 'Không có tổ chức nào chờ duyệt.');
      return html`<div style="padding:10px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button type="button" class="bt bt-p" data-act="to-verify">Đi tới Duyệt hồ sơ</button>
          <span style="font-size:.74rem;color:var(--t3)">Duyệt hoặc từ chối tổ chức được thực hiện ở màn Duyệt hồ sơ.</span></div>
        ${raw(table('pending-table', ['Tổ chức', 'Địa chỉ', 'Liên hệ', 'Gửi lúc', ''], rows))}`;
    }
    function liveMain() {
      const rows = data.live.map((v) => {
        const url = typeof v.directions_url === 'string' && v.directions_url.startsWith('https://') ? v.directions_url : '';
        const link = url ? html`<a href="${url}" target="_blank" rel="noopener noreferrer">Chỉ đường</a>` : '—';
        return html`<tr><td><b>${v.name || '—'}</b></td><td>${v.context_code || '—'}</td><td>${dt(v.updated_at)}</td><td>${raw(link)}</td></tr>`;
      }).join('') || emptyRow(4, 'Hiện không có tình nguyện viên nào đang chia sẻ vị trí.');
      return html`<div style="padding:10px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <a class="bt" href="#/tracking">Mở Bản đồ theo dõi</a>
          <span style="font-size:.74rem;color:var(--t3)">Chỉ gồm người chia sẻ vị trí trong 30 phút gần nhất.</span></div>
        ${raw(table('live-table', ['Tình nguyện viên', 'Mã lô', 'Cập nhật lúc', 'Chỉ đường'], rows))}`;
    }

    function drawBody() {
      const count = (n) => (data && !data.live ? ` (${n})` : '');
      const tabs = TABS.map((t) => {
        const n = t.key === 'active' ? data?.active?.length : t.key === 'pending' ? data?.pending?.length : 0;
        return html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-tab="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title}${t.key === 'volunteers' ? '' : count(n)}</button>`;
      }).join('');
      const main = tab === 'active' ? activeMain() : tab === 'pending' ? pendingMain() : liveMain();
      const soon = COMING.map((s) => html`<li>${s}</li>`).join('');
      body.innerHTML = html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(tabs)}</div>
        <section class="P"><div class="P-h"><span class="P-t">${TABS.find((t) => t.key === tab).title}</span></div>
          <div class="W">${raw(main)}</div></section>
        <section class="P" data-role="soon"><div class="P-h"><span class="P-t">Sắp có</span><span class="b b-m">Cần API mới</span></div>
          <ul style="margin:0;padding:12px 16px 12px 32px;font-size:.78rem;color:var(--t2)">${raw(soon)}</ul></section>`;
    }

    async function draw() {
      const mine = ++seq;
      loading(body);
      try {
        if (tab === 'volunteers') {
          const live = await api.get('/admin/live-locations?kind=volunteer', { signal });
          if (!alive() || mine !== seq) return;
          data = { live: list(live).filter((v) => !v.actor_kind || v.actor_kind === 'volunteer') };
        } else {
          const [queue, donations] = await Promise.all([
            api.get('/admin/verification', { signal }),
            api.get('/donations?limit=100', { signal }),
          ]);
          if (!alive() || mine !== seq) return;
          data = { pending: list(queue?.charities), active: groupCharities(list(donations)) };
        }
        drawBody();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        error(body, err, () => draw());
      }
    }

    function volunteerRows(vols) {
      return vols.map((v) => {
        const st = own(VOL_STATUS, v.status) || [v.status ? 'Không rõ' : '—', 'b-m'];
        const kg = v.kg_collected === undefined || v.kg_collected === null || v.kg_collected === '' ? '—' : `${Number(v.kg_collected)} kg`;
        return html`<tr><td><b>${v.full_name || '—'}</b></td><td>${v.phone ? maskPhone(v.phone) : '—'}</td><td>${own(DUTY, v.duty_role) || '—'}</td>
          <td><span class="b ${raw(st[1])}">${st[0]}</span></td><td>${v.runs ?? '—'}</td><td>${kg}</td></tr>`;
      }).join('') || emptyRow(6, 'Tổ chức này chưa có tình nguyện viên.');
    }

    async function openCharity(id) {
      const mine = ++drawerSeq;
      const found = (data?.active || []).find((c) => c.id === id) || (data?.pending || []).find((c) => c.id === id);
      const title = found?.name || 'Tổ chức';
      ctx.ui.drawer.open(html`<div style="padding:16px">Đang tải danh sách tình nguyện viên…</div>`, { title });
      try {
        const vols = list(await api.get(`/charity/profiles/${encodeURIComponent(id)}/volunteers`, { signal }));
        if (!alive() || mine !== drawerSeq) return;
        ctx.ui.drawer.open(html`<div style="padding:16px"><div style="font-weight:700;margin-bottom:8px">Tình nguyện viên (${vols.length})</div>
          <div class="W">${raw(table('volunteers-table', ['Tên', 'SĐT', 'Vai trò', 'Trạng thái', 'Số chuyến', 'Khối lượng'], volunteerRows(vols)))}</div></div>`, { title });
      } catch (err) {
        if (!alive() || mine !== drawerSeq || err?.name === 'AbortError') return;
        ctx.ui.drawer.open(html`<div role="alert" style="padding:16px;color:var(--err)">${err?.message || 'Không tải được danh sách tình nguyện viên.'}</div>`, { title });
      }
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => { if (el.dataset.tab !== tab) ctx.navigate('charities', { tab: el.dataset.tab }); });
    delegate(root, 'click', '[data-act="open"]', (_e, el) => openCharity(el.dataset.id));
    delegate(root, 'click', '[data-act="to-verify"]', () => ctx.navigate('verify', { tab: 'charities' }));

    await draw();
  },

  destroy() {},
};
