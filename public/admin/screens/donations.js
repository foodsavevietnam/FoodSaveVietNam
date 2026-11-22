// Màn "Lô tặng & ghép đơn" (chỉ xem): tab Lô tặng (GET /donations, ảnh /donations/:id/photos, báo cáo /donations/:id/report)
// và tab Nhu cầu ghép đơn (GET /matching/needs). Tab, lọc, trang lưu trong hash (#/donations?tab=...&status=...&page=...).
// Không bao giờ hiện pickup_code. Chỉ render <img> khi URL bắt đầu https://. Poll 60 giây. Không có hành động ghi.
import { stamp, left, maskPhone } from '../core/format.js';
import { badge } from '../core/vi.js';
import { drawer } from '../core/ui.js';

const REFRESH_MS = 60000;
const LIMIT = 20;
const TABS = [{ key: 'lots', title: 'Lô tặng' }, { key: 'needs', title: 'Nhu cầu ghép đơn' }];
const LOT_STATUS = {
  open: ['Đang mời nhận', 'w'], accepted: ['Tổ chức đã nhận', 'i'], in_route: ['Đang đi lấy', 'i'],
  completed: ['Đã bàn giao', 'ok'], rejected: ['Cửa hàng từ chối', 'e'], cancelled: ['Đã hủy', 'm'],
};
const NEED_STATUS = { open: ['Đang mở', 'w'], matched: ['Đã ghép đủ', 'ok'], cancelled: ['Đã hủy', 'm'] };
const CATEGORY = { bakery: 'Bánh ngọt / bánh tươi', meal: 'Bữa ăn / cơm hộp' };
const STAGE = { pickup: 'Lúc lấy hàng', distribute: 'Lúc phát hàng' };
const PHOTO_STATUS = { pending: ['Chờ duyệt', 'w'], approved: ['Đã duyệt', 'ok'], auto_approved: ['Tự động duyệt', 'ok'], retake: ['Yêu cầu chụp lại', 'e'] };
const LEVEL = { ok: 'ok', warn: 'w', err: 'e', m: 'm' };
const SOON = ['Hủy lô', 'Duyệt ảnh thay tổ chức'];

const has = (map, key) => key != null && Object.prototype.hasOwnProperty.call(map, key);
const idShort = (id) => String(id ?? '').slice(0, 8) || '—';

export default {
  id: 'donations',
  title: 'Lô tặng & ghép đơn',
  group: 'HOẠT ĐỘNG',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div data-screen="donations"><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    const tab = TABS.some((t) => t.key === ctx.params?.tab) ? ctx.params.tab : 'lots';
    const status = tab === 'lots' && has(LOT_STATUS, ctx.params?.status) ? ctx.params.status : '';
    const pageParam = Number.parseInt(ctx.params?.page, 10);
    const page = tab === 'lots' && Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
    let data = null; // lots: { items, pagination } | needs: mảng

    const go = (next) => {
      const t = next.tab ?? tab;
      ctx.navigate('donations', {
        tab: t === 'lots' ? undefined : t,
        status: t === 'lots' ? (next.status ?? status) : undefined,
        page: t === 'lots' && (next.page ?? 1) > 1 ? next.page : undefined,
      });
    };

    const pill = (map, key, fallback = 'Không rõ') => {
      const [text, level] = has(map, key) ? map[key] : [fallback, 'm'];
      return html`<span class="b b-${raw(level)}">${text}</span>`;
    };
    const head = (cols) => cols.map((h) => html`<th>${h}</th>`).join('');

    function lotRow(d) {
      return html`<tr data-act="open" data-id="${d.id}"><td><b>${d.donation_code || idShort(d.id)}</b></td>
        <td>${d.stores?.name || '—'}</td><td>${d.charity_profiles?.name || 'Chưa có tổ chức'}</td>
        <td>${d.items || '—'}<br><small style="color:var(--t3)">${d.amount_text || (d.quantity != null ? `${d.quantity} phần` : '—')}</small></td>
        <td>${raw(has({ green: 1, yellow: 1, red: 1 }, d.urgency) ? badge('label', d.urgency) : '—')}</td>
        <td>${raw(pill(LOT_STATUS, d.status))}</td><td>${stamp(d.created_at)}</td></tr>`;
    }

    function needRow(n) {
      const cats = (Array.isArray(n.category_codes) ? n.category_codes : []).map((c) => CATEGORY[c] || 'Loại khác').join(', ');
      const l = n.status === 'open' ? left(n.needed_by) : null;
      return html`<tr data-id="${n.id}" style="cursor:default"><td>Tổ chức ·${idShort(n.charity_id)}</td>
        <td><b>${n.title || '—'}</b><br><small style="color:var(--t3)">${cats || '—'}</small></td><td>${n.quantity ?? '—'} phần</td>
        <td>${stamp(n.needed_by)}${raw(l ? html` <span class="b b-${raw(LEVEL[l.level] || 'm')}">${l.text}</span>` : '')}</td>
        <td>${raw(pill(NEED_STATUS, n.status))}</td><td>${Array.isArray(n.matched_donation_ids) ? n.matched_donation_ids.length : 0} lô</td><td>${stamp(n.created_at)}</td></tr>`;
    }

    function drawBody() {
      const tabs = TABS.map((t) => html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-tab="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title}</button>`).join('');
      let main;
      if (tab === 'lots') {
        const filters = [{ key: '', title: 'Tất cả' }, ...Object.keys(LOT_STATUS).map((k) => ({ key: k, title: LOT_STATUS[k][0] }))]
          .map((t) => html`<button type="button" class="bt${raw(status === t.key ? ' bt-p' : '')}" data-act="status" data-status="${t.key}"${raw(status === t.key ? ' aria-current="true"' : '')}>${t.title}</button>`).join('');
        const pg = data.pagination || {};
        const cur = Number(pg.page) || page;
        const rows = data.items.length
          ? data.items.map(lotRow).join('')
          : html`<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:18px;cursor:default">Không có lô tặng nào.</td></tr>`;
        main = html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${raw(filters)}</div>
          <section class="P"><div class="P-h"><span class="P-t">Lô tặng${raw(pg.total != null ? html` (${pg.total})` : '')}</span>
            <span class="P-a"><button type="button" class="bt" data-act="prev"${raw(cur <= 1 ? ' disabled' : '')}>Trước</button>
              <span style="align-self:center;font-size:.72rem;color:var(--t3)">Trang ${cur}</span>
              <button type="button" class="bt" data-act="next"${raw(pg.has_next_page ? '' : ' disabled')}>Sau</button></span></div>
            <div class="W"><table class="tbl" data-role="lots-table"><thead><tr>${raw(head(['Mã lô', 'Cửa hàng', 'Tổ chức', 'Mặt hàng / số phần', 'Mức khẩn', 'Trạng thái', 'Tạo lúc']))}</tr></thead><tbody>${raw(rows)}</tbody></table></div></section>`;
      } else {
        const rows = data.length
          ? data.map(needRow).join('')
          : html`<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:18px;cursor:default">Chưa có nhu cầu ghép đơn nào.</td></tr>`;
        main = html`<section class="P"><div class="P-h"><span class="P-t">Nhu cầu ghép đơn (${data.length})</span><span style="font-size:.72rem;color:var(--t3)">50 nhu cầu mới nhất</span></div>
          <div class="W"><table class="tbl" data-role="needs-table"><thead><tr>${raw(head(['Tổ chức', 'Nhu cầu', 'Số phần', 'Cần trước', 'Trạng thái', 'Đã ghép', 'Tạo lúc']))}</tr></thead><tbody>${raw(rows)}</tbody></table></div></section>`;
      }
      body.innerHTML = html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(tabs)}</div>${raw(main)}`;
    }

    let seq = 0;
    async function draw({ quiet = false } = {}) {
      const mine = ++seq;
      if (!quiet || !data) loading(body);
      try {
        let next;
        if (tab === 'lots') {
          const res = await api.get(`/donations?page=${page}&limit=${LIMIT}${status ? `&status=${status}` : ''}`, { signal });
          next = { items: Array.isArray(res?.items) ? res.items : [], pagination: res?.pagination || {} };
        } else {
          const res = await api.get('/matching/needs', { signal });
          next = Array.isArray(res) ? res : res?.items || [];
        }
        if (!alive() || mine !== seq) return;
        data = next;
        drawBody();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet && data) { console.warn('[MIO] Không làm mới được dữ liệu lô tặng:', err); return; }
        error(body, err, () => draw());
      }
    }

    // ---------- Ngăn kéo lô ----------
    const row = (k, v) => html`<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0"><span style="color:var(--t3)">${k}</span><span style="text-align:right">${raw(v)}</span></div>`;
    const sec = (title, inner) => html`<section style="margin-top:14px"><div style="font-weight:700;margin-bottom:6px">${title}</div>${raw(inner)}</section>`;

    function teamHtml(d) {
      const rows = Array.isArray(d.donation_assignments) ? d.donation_assignments : [];
      const line = (label, name, phone, share, doneAt) => html`<div style="padding:3px 0"><b>${label}</b> · ${name}${phone ? html` · ${maskPhone(phone)}` : ''}${share != null ? html` · ${share} phần` : ''}
        <small style="color:var(--t3)"> ${doneAt ? `xong ${stamp(doneAt)}` : 'chưa xong'}</small></div>`;
      if (rows.length) {
        return rows.map((a) => line(a.stage === 'distribute' ? 'Phát hàng' : 'Lấy hàng', a.volunteers?.full_name || 'TNV', a.volunteers?.phone, a.share, a.done_at)).join('');
      }
      if (d.volunteers?.full_name) return line('Lấy hàng', d.volunteers.full_name, d.volunteers.phone, null, null);
      return html`<span style="color:var(--t3)">Chưa giao đội tình nguyện viên.</span>`;
    }

    function lotBody(d) {
      const soon = SOON.map((t) => html`<button type="button" class="bt" data-soon="1" disabled title="Sắp có — cần API mới">${t}</button>`).join(' ');
      const offer = d.status === 'open' && d.offer_expires_at ? left(d.offer_expires_at).text : '';
      return html`<div style="padding:16px 18px;font-size:.8rem">
        <div>${raw(pill(LOT_STATUS, d.status))} ${raw(has({ green: 1, yellow: 1, red: 1 }, d.urgency) ? badge('label', d.urgency) : '')}</div>
        ${raw(row('Cửa hàng', html`${d.stores?.name || '—'}${d.stores?.address ? html`<br><small style="color:var(--t3)">${d.stores.address}</small>` : ''}`))}
        ${raw(row('Tổ chức', html`${d.charity_profiles?.name || 'Chưa có tổ chức'}`))}
        ${raw(row('Mặt hàng', html`${d.items || '—'}`))}
        ${raw(row('Số lượng', html`${d.amount_text || (d.quantity != null ? `${d.quantity} phần` : '—')}${d.weight_kg != null ? html` · ${d.weight_kg} kg` : ''}`))}
        ${raw(row('Hạn sử dụng', html`${stamp(d.expires_at)}`))}
        ${raw(row('Khung giờ lấy', html`${d.pickup_start || '—'} – ${d.pickup_end || '—'}`))}
        ${raw(offer ? row('Hạn nhận lời', html`${offer}`) : '')}
        ${raw(row('Tạo lúc', html`${stamp(d.created_at)}`))}
        ${raw(d.note ? row('Ghi chú', html`${d.note}`) : '')}
        ${raw(sec('Đội tình nguyện viên', teamHtml(d)))}
        ${raw(sec('Ảnh minh chứng', html`<div data-role="photos" data-lot="${d.id}" style="font-size:.76rem;color:var(--t2)">Đang tải…</div>`))}
        ${raw(sec('Báo cáo lô', html`<div data-role="report" data-lot="${d.id}" style="font-size:.76rem;color:var(--t2)">Đang tải…</div>`))}
        ${raw(sec('Thao tác của Admin', html`<div style="display:flex;gap:6px;flex-wrap:wrap">${raw(soon)}</div>
          <div style="font-size:.7rem;color:var(--t3);margin-top:6px">Sắp có — cần API admin có ghi nhật ký.</div>`))}
      </div>`;
    }

    const photoHtml = (p) => {
      const safe = typeof p.photo_url === 'string' && p.photo_url.startsWith('https://');
      const flag = p.gps_flag ? html`<br><span class="b b-w">Vị trí chụp xa điểm hẹn</span>` : '';
      const note = p.review_note ? html`<br><small>${p.review_note}</small>` : '';
      return html`<div style="display:inline-block;width:150px;margin:0 8px 8px 0;vertical-align:top">
        ${raw(safe ? html`<img src="${p.photo_url}" alt="Ảnh minh chứng" loading="lazy" referrerpolicy="no-referrer" style="width:150px;height:110px;object-fit:cover;border-radius:6px;border:1px solid var(--bd)">`
          : html`<div style="width:150px;height:110px;display:grid;place-items:center;color:var(--t3);border:1px dashed var(--bd);border-radius:6px">Không có ảnh hợp lệ</div>`)}
        <div><b>${STAGE[p.stage] || 'Ảnh'}</b> ${raw(pill(PHOTO_STATUS, p.status))}</div>
        <small style="color:var(--t3)">${p.volunteers?.full_name || 'TNV'} · ${stamp(p.taken_at)}${p.is_demo ? ' · ảnh mẫu' : ''}</small>${raw(flag)}${raw(note)}</div>`;
    };

    const slot = (role, id) => document.querySelector(`#drawer [data-role="${role}"][data-lot="${id}"]`);

    async function loadPhotos(id) {
      try {
        const res = await api.get(`/donations/${encodeURIComponent(id)}/photos`, { signal });
        const el = slot('photos', id);
        if (!alive() || !el) return;
        const items = Array.isArray(res) ? res : res?.items || [];
        el.innerHTML = items.length ? items.map(photoHtml).join('') : html`Chưa có ảnh minh chứng.`;
        // Ảnh hỏng: thay bằng chữ, không để lại ô trống
        el.addEventListener('error', (e) => {
          if (e.target?.tagName === 'IMG') e.target.replaceWith(Object.assign(document.createElement('span'), { textContent: 'Không tải được ảnh' }));
        }, true);
      } catch (err) {
        const el = slot('photos', id);
        if (!alive() || !el || err?.name === 'AbortError') return;
        el.innerHTML = html`Không tải được ảnh minh chứng.`;
      }
    }

    async function loadReport(id) {
      try {
        const r = await api.get(`/donations/${encodeURIComponent(id)}/report`, { signal });
        const el = slot('report', id);
        if (!alive() || !el) return;
        const timeline = (Array.isArray(r?.timeline) ? r.timeline : []).map((t) => html`<div style="padding:3px 0"><small style="color:var(--t3)">${stamp(t.at)}</small> ${t.label}</div>`).join('');
        const dn = r?.donation || {};
        const lines = [];
        if (dn.portions != null) lines.push(row('Số suất phát', html`${dn.portions}`));
        if (dn.completed_at) lines.push(row('Cửa hàng bàn giao', html`${stamp(dn.completed_at)}`));
        if (dn.distribution_done_at) lines.push(row('Hoàn tất phát hàng', html`${stamp(dn.distribution_done_at)}`));
        el.innerHTML = (lines.join('') + timeline) || html`Chưa có dữ liệu báo cáo.`;
      } catch (err) {
        const el = slot('report', id);
        if (!alive() || !el || err?.name === 'AbortError') return;
        el.innerHTML = html`Không tải được báo cáo lô.`;
      }
    }

    function openLot(id) {
      const d = Array.isArray(data?.items) ? data.items.find((x) => x.id === id) : null;
      if (!d) return;
      drawer.open(lotBody(d), { title: `Lô ${d.donation_code || idShort(d.id)}` });
      loadPhotos(id);
      loadReport(id);
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => { if (el.dataset.tab !== tab) go({ tab: el.dataset.tab, status: '', page: 1 }); });
    delegate(root, 'click', '[data-act="status"]', (_e, el) => { if (el.dataset.status !== status) go({ status: el.dataset.status, page: 1 }); });
    delegate(root, 'click', '[data-act="prev"]', () => { if (page > 1) go({ page: page - 1 }); });
    delegate(root, 'click', '[data-act="next"]', () => { if (data?.pagination?.has_next_page) go({ page: page + 1 }); });
    delegate(root, 'click', 'tr[data-act="open"]', (_e, el) => openLot(el.dataset.id));

    ctx.poll.add('screen:donations', () => draw({ quiet: true }), { everyMs: REFRESH_MS });
    await draw();
  },

  destroy() { drawer.close(); },
};
