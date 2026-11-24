// Màn "Tổ chức & tình nguyện viên" (Đợt 2): 4 tab (#/charities?tab=active|pending|suspended|volunteers).
// Tổ chức tải từ GET /admin/charities, hồ sơ 360° từ GET /admin/charities/:id với tạm ngưng/mở lại (POST /admin/charities/:id/status).
// Tình nguyện viên toàn hệ thống từ GET /admin/volunteers với vô hiệu hóa/kích hoạt (POST /admin/volunteers/:id/status) + link Bản đồ theo dõi.
// Hỗ trợ #/charities?id=<id>. Không bao giờ hiển thị pickup_code hay dữ liệu nhạy cảm.
import { dt, maskPhone, stamp } from '../core/format.js';
import { actionLabel, badge } from '../core/vi.js';

const TABS = [
  { key: 'active', title: 'Đang hoạt động' },
  { key: 'pending', title: 'Chờ duyệt' },
  { key: 'suspended', title: 'Tạm ngưng' },
  { key: 'volunteers', title: 'Tình nguyện viên' },
];
const DUTY = { pickup: 'Lấy hàng', distribute: 'Phát hàng', both: 'Lấy và phát hàng' };
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;

const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Giữ export tương thích ngược
export function groupCharities(donations) {
  const map = new Map();
  for (const d of donations || []) {
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

let cleanup = [];

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
    let page = Math.max(1, Number(ctx.params?.page) || 1);
    let query = String(ctx.params?.q || '');
    let data = null;
    let busy = false;
    let notice = '';
    let searchTimer = null;
    let seq = 0;
    let drawerSeq = 0;
    let openDetail = null;

    const emptyRow = (cols, text) => html`<tr><td colspan="${cols}" style="text-align:center;color:var(--t3);padding:18px">${text}</td></tr>`;

    const buildPath = () => {
      const sp = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort: 'created_at.desc' });
      if (query.trim()) sp.set('q', query.trim().slice(0, 80));
      if (tab === 'volunteers') return `/admin/volunteers?${sp.toString()}`;
      sp.set('status', tab);
      return `/admin/charities?${sp.toString()}`;
    };

    function pagerHtml(total, unitLabel) {
      const totalPages = Math.max(1, Math.ceil(num(total) / PAGE_SIZE));
      if (totalPages <= 1) return '';
      const start = Math.max(1, page - 2);
      const end = Math.min(totalPages, start + 4);
      const btns = [];
      if (page > 1) btns.push(html`<button type="button" class="bt" data-act="page" data-page="${page - 1}">Trước</button>`);
      for (let p = start; p <= end; p += 1) {
        btns.push(html`<button type="button" class="bt${raw(p === page ? ' bt-p' : '')}" data-act="page" data-page="${p}"${raw(p === page ? ' aria-current="page"' : '')}>${p}</button>`);
      }
      if (page < totalPages) btns.push(html`<button type="button" class="bt" data-act="page" data-page="${page + 1}">Sau</button>`);
      return html`<nav aria-label="Phân trang" style="display:flex;gap:6px;justify-content:space-between;align-items:center;padding:8px 12px">
        <small style="color:var(--t3)">Trang ${page}/${totalPages} · ${num(total)} ${unitLabel}</small>
        <span style="display:flex;gap:6px">${raw(btns.join(''))}</span>
      </nav>`;
    }

    function charitiesMain() {
      const items = data?.items || [];
      const rows = items.map((c) => html`<tr>
        <td><button type="button" class="bt" data-act="open" data-id="${c.id}">${c.name || 'Chưa đặt tên'}</button></td>
        <td>${c.address || '—'}</td>
        <td>${c.email || '—'}${raw(c.phone ? html`<br><small style="color:var(--t3)">${maskPhone(c.phone)}</small>` : '')}</td>
        <td>${num(c.beneficiaries_count)}</td>
        <td>${raw(badge('charityStatus', c.status || tab))}</td>
        <td>${dt(c.created_at)}</td>
      </tr>`).join('') || emptyRow(6, tab === 'pending' ? 'Không có tổ chức nào chờ duyệt.' : tab === 'suspended' ? 'Không có tổ chức nào đang tạm ngưng.' : 'Chưa có tổ chức phù hợp.');

      const pendingBar = tab === 'pending'
        ? html`<div style="padding:10px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button type="button" class="bt bt-p" data-act="to-verify">Đi tới Duyệt hồ sơ</button>
            <span style="font-size:.74rem;color:var(--t3)">Duyệt hoặc từ chối tổ chức mới được thực hiện ở màn Duyệt hồ sơ.</span></div>`
        : '';

      return html`${raw(pendingBar)}
        <table class="tbl" data-role="${tab}-table"><thead><tr>
          <th>Tổ chức</th><th>Địa chỉ</th><th>Liên hệ</th><th>Người thụ hưởng</th><th>Trạng thái</th><th>Ngày tạo</th>
        </tr></thead><tbody>${raw(rows)}</tbody></table>
        ${raw(pagerHtml(data?.total, 'tổ chức'))}`;
    }

    function volunteerActionBtn(v) {
      if (v.status === 'inactive') {
        return html`<button type="button" class="bt bt-p" data-act="vol-status" data-id="${v.id}" data-name="${v.full_name || 'TNV'}" data-status="active">Kích hoạt lại</button>`;
      }
      return html`<button type="button" class="bt b-e" data-act="vol-status" data-id="${v.id}" data-name="${v.full_name || 'TNV'}" data-status="inactive">Vô hiệu hóa</button>`;
    }

    function volunteersMain() {
      const items = data?.items || [];
      const rows = items.map((v) => {
        const kg = v.kg_collected === undefined || v.kg_collected === null || v.kg_collected === '' ? '—' : `${Number(v.kg_collected)} kg`;
        return html`<tr>
          <td><b>${v.full_name || '—'}</b></td>
          <td>${v.charity_name || '—'}</td>
          <td>${v.phone ? maskPhone(v.phone) : '—'}</td>
          <td>${own(DUTY, v.duty_role) || '—'}</td>
          <td>${raw(badge('volunteerStatus', v.status || 'new'))}</td>
          <td>${num(v.runs)} · ${kg}</td>
          <td>${raw(volunteerActionBtn(v))}</td>
        </tr>`;
      }).join('') || emptyRow(7, 'Chưa có tình nguyện viên nào phù hợp.');

      return html`<div style="padding:10px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <a class="bt" href="#/tracking">Mở Bản đồ theo dõi</a>
          <span style="font-size:.74rem;color:var(--t3)">Quản lý tình nguyện viên mọi tổ chức và theo dõi vị trí trực tiếp trên bản đồ.</span></div>
        <table class="tbl" data-role="volunteers-table"><thead><tr>
          <th>Tình nguyện viên</th><th>Tổ chức</th><th>SĐT</th><th>Nhiệm vụ</th><th>Trạng thái</th><th>Chuyến · Khối lượng</th><th>Thao tác</th>
        </tr></thead><tbody>${raw(rows)}</tbody></table>
        ${raw(pagerHtml(data?.total, 'tình nguyện viên'))}`;
    }

    function drawBody() {
      const counts = data?.counts || {};
      const tabs = TABS.map((t) => {
        const hasCount = t.key !== 'volunteers' && Number.isFinite(Number(counts[t.key]));
        const suffix = hasCount ? ` (${counts[t.key]})` : '';
        return html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-tab="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title}${suffix}</button>`;
      }).join('');
      const noticeHtml = notice
        ? html`<div role="status" data-role="notice" style="margin-bottom:12px;padding:10px 14px;border:1px solid var(--warn-bd);background:var(--warn-bg);color:var(--warn);border-radius:var(--rs);font-size:.8rem">${notice}</div>`
        : '';

      const hadFocus = document.activeElement?.dataset?.role === 'search';
      body.innerHTML = html`${raw(noticeHtml)}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(tabs)}</div>
        <section class="P"><div class="P-h"><span class="P-t">${TABS.find((t) => t.key === tab)?.title || 'Tổ chức'}</span>
          <input type="search" data-role="search" aria-label="Tìm kiếm" placeholder="${tab === 'volunteers' ? 'Tìm TNV theo tên, SĐT, email' : 'Tìm tổ chức theo tên, địa chỉ, SĐT'}" maxlength="80" style="padding:6px 10px;border:1px solid var(--bd2);border-radius:var(--rs);min-width:220px"></div>
          <div class="W">${raw(tab === 'volunteers' ? volunteersMain() : charitiesMain())}</div></section>`;
      const searchEl = body.querySelector('[data-role="search"]');
      searchEl.value = query;
      if (hadFocus) { searchEl.focus(); searchEl.setSelectionRange(query.length, query.length); }
    }

    function detailHtml(d) {
      const c = d.charity || {};
      const owner = d.owner || null;
      const vols = Array.isArray(d.volunteers) ? d.volunteers : [];
      const donations = Array.isArray(d.recent_donations) ? d.recent_donations : [];
      const auditRows = Array.isArray(d.recent_audit) ? d.recent_audit : [];
      const row = (label, value) => html`<tr><th style="text-align:left;padding:6px 0;width:42%;color:var(--t3);font-weight:600">${label}</th><td style="padding:6px 0">${value}</td></tr>`;

      let statusBtn = '';
      if (c.status === 'active') {
        statusBtn = html`<button type="button" class="bt b-e" data-act="charity-status" data-status="suspended" data-id="${c.id}">Tạm ngưng</button>`;
      } else if (c.status === 'suspended') {
        statusBtn = html`<button type="button" class="bt bt-p" data-act="charity-status" data-status="active" data-id="${c.id}">Mở lại</button>`;
      }

      const volRows = vols.map((v) => {
        const kg = v.kg_collected === undefined || v.kg_collected === null || v.kg_collected === '' ? '—' : `${Number(v.kg_collected)} kg`;
        return html`<tr>
          <td><b>${v.full_name || '—'}</b></td>
          <td>${v.phone ? maskPhone(v.phone) : '—'}</td>
          <td>${own(DUTY, v.duty_role) || '—'}</td>
          <td>${raw(badge('volunteerStatus', v.status || 'new'))}</td>
          <td>${num(v.runs)} · ${kg}</td>
          <td>${raw(volunteerActionBtn(v))}</td>
        </tr>`;
      }).join('') || emptyRow(6, 'Tổ chức này chưa có tình nguyện viên.');

      const donRows = donations.map((dn) => html`<tr>
        <td>${dn.donation_code || String(dn.id || '').slice(0, 8)}</td>
        <td>${dn.items || '—'}</td>
        <td>${dn.weight_kg != null ? `${Number(dn.weight_kg)} kg` : '—'}</td>
        <td>${raw(badge('donationStatus', dn.status || 'open'))}</td>
        <td>${dt(dn.created_at)}</td>
      </tr>`).join('') || emptyRow(5, 'Chưa có lô tặng nào.');

      const auditHtml = auditRows.length
        ? auditRows.map((a) => html`<div class="DR"><div class="DR-l">${stamp(a.created_at)}</div><div class="DR-v"><b>${a.actor_name || 'Hệ thống'}</b> · ${actionLabel(a.action)}${raw(a.detail?.reason ? html`<br><small style="color:var(--t3)">Lý do: ${a.detail.reason}</small>` : '')}</div></div>`).join('')
        : html`<div style="font-size:.8rem;color:var(--t3)">Chưa có lịch sử tác động.</div>`;

      return html`<div style="padding:14px 18px" data-role="charity" data-id="${c.id}">
        <h3 style="margin:0 0 8px">${c.name || 'Tổ chức'}</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${raw(statusBtn)}</div>
        <table style="width:100%;font-size:.82rem;border-collapse:collapse"><tbody>
          ${raw(row('Trạng thái', raw(badge('charityStatus', c.status || 'pending'))))}
          ${raw(c.suspended_reason ? row('Lý do tạm ngưng', c.suspended_reason) : '')}
          ${raw(row('Địa chỉ', c.address || '—'))}
          ${raw(row('Email', c.email || '—'))}
          ${raw(row('Số điện thoại', c.phone ? maskPhone(c.phone) : '—'))}
          ${raw(row('Người thụ hưởng', num(c.beneficiaries_count)))}
          ${raw(row('Chủ hồ sơ', owner ? `${owner.full_name || '—'} · ${owner.email || '—'}` : '—'))}
          ${raw(row('Tham gia', stamp(c.created_at)))}
        </tbody></table>
        <h4 style="margin:16px 0 6px;font-size:.8rem">Tình nguyện viên (${vols.length})</h4>
        <div class="W"><table class="tbl" data-role="drawer-volunteers"><thead><tr><th>Tên</th><th>SĐT</th><th>Nhiệm vụ</th><th>Trạng thái</th><th>Chuyến</th><th></th></tr></thead><tbody>${raw(volRows)}</tbody></table></div>
        <h4 style="margin:16px 0 6px;font-size:.8rem">10 lô tặng gần nhất</h4>
        <div class="W"><table class="tbl"><thead><tr><th>Mã lô</th><th>Mặt hàng</th><th>Khối lượng</th><th>Trạng thái</th><th>Thời gian</th></tr></thead><tbody>${raw(donRows)}</tbody></table></div>
        <h4 style="margin:16px 0 6px;font-size:.8rem">Nhật ký gần đây</h4>
        <div>${raw(auditHtml)}</div>
      </div>`;
    }

    async function draw({ quiet = false } = {}) {
      const mine = ++seq;
      if (!quiet || !data) loading(body);
      try {
        const res = await api.get(buildPath(), { signal });
        if (!alive() || mine !== seq) return;
        data = {
          items: Array.isArray(res?.items) ? res.items : [],
          total: num(res?.total),
          page: num(res?.page) || page,
          limit: num(res?.limit) || PAGE_SIZE,
          counts: res?.counts || {},
        };
        drawBody();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet && data) { console.warn('[MIO] Không làm mới được dữ liệu tổ chức:', err); return; }
        error(body, err, () => draw());
      }
    }

    async function openCharity(id, { fromDeepLink = false } = {}) {
      const mine = ++drawerSeq;
      if (!fromDeepLink) {
        ctx.ui.drawer.open(html`<div style="padding:16px">Đang tải hồ sơ 360° tổ chức…</div>`, { title: 'Hồ sơ tổ chức' });
      }
      try {
        const detail = await api.get(`/admin/charities/${encodeURIComponent(id)}`, { signal });
        if (!alive() || mine !== drawerSeq) return;
        openDetail = detail;
        ctx.ui.drawer.open(detailHtml(detail), { title: detail?.charity?.name || 'Hồ sơ tổ chức' });
      } catch (err) {
        if (!alive() || mine !== drawerSeq || err?.name === 'AbortError') return;
        if (fromDeepLink && err?.status === 404) {
          notice = 'Không tìm thấy tổ chức này.';
          drawBody();
          return;
        }
        ctx.ui.drawer.open(html`<div role="alert" style="padding:16px;color:var(--err)">${err?.message || 'Không tải được hồ sơ tổ chức.'}</div>`, { title: 'Hồ sơ tổ chức' });
      }
    }

    async function changeCharityStatus(id, nextStatus) {
      if (busy) return;
      const name = openDetail?.charity?.name || 'tổ chức này';
      const suspending = nextStatus === 'suspended';
      const res = await ctx.ui.confirm({
        title: suspending ? `Tạm ngưng tổ chức ${name}?` : `Mở lại tổ chức ${name}?`,
        body: suspending
          ? 'Tổ chức tạm ngưng sẽ không thể nhận thêm lô tặng mới cho tới khi được mở lại.'
          : 'Tổ chức sẽ hoạt động và tiếp nhận lô tặng trở lại.',
        danger: suspending,
        reasonRequired: suspending,
        reasonOptional: !suspending,
        reasonLabel: suspending ? 'Lý do tạm ngưng (bắt buộc, ít nhất 3 ký tự)' : 'Ghi chú (không bắt buộc)',
        confirmText: suspending ? 'Tạm ngưng' : 'Mở lại',
      });
      if (!res.ok || !alive()) return;
      busy = true;
      try {
        const payload = { status: nextStatus, ...(res.reason ? { reason: res.reason } : {}) };
        await api.post(`/admin/charities/${encodeURIComponent(id)}/status`, payload, { signal });
        if (!alive()) return;
        ctx.ui.toast(suspending ? 'Đã tạm ngưng tổ chức' : 'Đã mở lại tổ chức');
        await draw({ quiet: true });
        await openCharity(id);
        ctx.refreshWork();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Không cập nhật được trạng thái tổ chức', 'err');
      } finally {
        busy = false;
      }
    }

    async function changeVolunteerStatus(id, nextStatus, name, reloadCharityId) {
      if (busy) return;
      const disabling = nextStatus === 'inactive';
      const res = await ctx.ui.confirm({
        title: disabling ? `Vô hiệu hóa tình nguyện viên ${name}?` : `Kích hoạt lại tình nguyện viên ${name}?`,
        body: disabling
          ? 'Tình nguyện viên này sẽ không được phân nhiệm vụ nhận hoặc phát hàng nữa.'
          : 'Tình nguyện viên sẽ có thể nhận nhiệm vụ trở lại.',
        danger: disabling,
        reasonRequired: disabling,
        reasonOptional: !disabling,
        reasonLabel: disabling ? 'Lý do vô hiệu hóa (bắt buộc, ít nhất 3 ký tự)' : 'Ghi chú (không bắt buộc)',
        confirmText: disabling ? 'Vô hiệu hóa' : 'Kích hoạt lại',
      });
      if (!res.ok || !alive()) return;
      busy = true;
      try {
        const payload = { status: nextStatus, ...(res.reason ? { reason: res.reason } : {}) };
        await api.post(`/admin/volunteers/${encodeURIComponent(id)}/status`, payload, { signal });
        if (!alive()) return;
        ctx.ui.toast(disabling ? 'Đã vô hiệu hóa tình nguyện viên' : 'Đã kích hoạt lại tình nguyện viên');
        await draw({ quiet: true });
        if (reloadCharityId) await openCharity(reloadCharityId);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Không cập nhật được trạng thái tình nguyện viên', 'err');
      } finally {
        busy = false;
      }
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => {
      if (el.dataset.tab !== tab) ctx.navigate('charities', { tab: el.dataset.tab });
    });
    delegate(root, 'click', '[data-act="open"]', (_e, el) => openCharity(el.dataset.id));
    delegate(root, 'click', '[data-act="to-verify"]', () => ctx.navigate('verify', { tab: 'charities' }));
    delegate(root, 'click', '[data-act="page"]', (_e, el) => {
      const next = Number(el.dataset.page) || 1;
      if (next !== page) { page = next; draw(); }
    });
    delegate(root, 'click', '[data-act="vol-status"]', (_e, el) => changeVolunteerStatus(el.dataset.id, el.dataset.status, el.dataset.name || 'TNV', null));
    delegate(root, 'input', '[data-role="search"]', (_e, el) => {
      query = el.value;
      page = 1;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { searchTimer = null; if (alive()) draw({ quiet: true }); }, SEARCH_DEBOUNCE_MS);
    });

    const drawerEl = typeof document !== 'undefined' ? document.getElementById('drawer') : null;
    if (drawerEl) {
      cleanup.push(delegate(drawerEl, 'click', '[data-act="charity-status"]', (_e, el) => changeCharityStatus(el.dataset.id, el.dataset.status)));
      cleanup.push(delegate(drawerEl, 'click', '[data-act="vol-status"]', (_e, el) => {
        const chId = el.closest('[data-role="charity"]')?.dataset?.id || null;
        changeVolunteerStatus(el.dataset.id, el.dataset.status, el.dataset.name || 'TNV', chId);
      }));
    }
    cleanup.push(() => { if (searchTimer) clearTimeout(searchTimer); drawerSeq += 1; });

    await draw();
    const wanted = ctx.params?.id;
    if (wanted && alive()) {
      await openCharity(wanted, { fromDeepLink: true });
    }
  },

  destroy() {
    cleanup.forEach((off) => off());
    cleanup = [];
  },
};
