// Màn "Lô tặng & ghép đơn" (Đợt 3): tab Lô tặng qua GET /admin/donations (tìm kiếm, lọc trạng thái, phân trang),
// ngăn kéo chi tiết GET /admin/donations/:id (dự phòng sang /donations/:id/photos và /donations/:id/report nếu thiếu),
// hành động Hủy lô (POST /admin/donations/:id/cancel) và tab Nhu cầu ghép đơn (GET /matching/needs).
// Tuyệt đối không hiển thị pickup_code; chỉ render <img> khi URL bắt đầu https://. Poll 60 giây.
import { stamp, left, maskPhone } from '../core/format.js';
import { isPollFailure } from '../core/poll.js';
import { buildHash } from '../core/router.js';
import { badge } from '../core/vi.js';
import { drawer } from '../core/ui.js';

const REFRESH_MS = 60000;
const LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 250;
const TABS = [{ key: 'lots', title: 'Lô tặng' }, { key: 'needs', title: 'Nhu cầu ghép đơn' }];
const LOT_STATUS = {
  open: ['Đang mời nhận', 'w'],
  accepted: ['Tổ chức đã nhận', 'i'],
  in_route: ['Đang đi lấy', 'i'],
  completed: ['Đã bàn giao', 'ok'],
  rejected: ['Cửa hàng từ chối', 'e'],
  cancelled: ['Đã hủy', 'm'],
};
const NEED_STATUS = { open: ['Đang mở', 'w'], matched: ['Đã ghép đủ', 'ok'], cancelled: ['Đã hủy', 'm'] };
const CATEGORY = { bakery: 'Bánh ngọt / bánh tươi', meal: 'Bữa ăn / cơm hộp', produce: 'Rau củ / trái cây', dairy: 'Sữa & chế phẩm', grocery: 'Thực phẩm khô' };
const STAGE = { pickup: 'Lúc lấy hàng', distribute: 'Lúc phát hàng' };
const PHOTO_STATUS = { pending: ['Chờ duyệt', 'w'], approved: ['Đã duyệt', 'ok'], auto_approved: ['Tự động duyệt', 'ok'], retake: ['Yêu cầu chụp lại', 'e'] };
const LEVEL = { ok: 'ok', warn: 'w', err: 'e', m: 'm' };

const has = (map, key) => key != null && Object.prototype.hasOwnProperty.call(map, key);
const idShort = (id) => String(id ?? '').slice(0, 8) || '—';
const safePhone = (p) => {
  const s = String(p ?? '').trim();
  if (!s) return '';
  return s.includes('*') || s.includes('•') ? s : maskPhone(s);
};

function sanitizeLot(rawLot) {
  if (!rawLot || typeof rawLot !== 'object') return {};
  const copy = { ...rawLot };
  delete copy.pickup_code;
  if (copy.donation && typeof copy.donation === 'object') {
    copy.donation = { ...copy.donation };
    delete copy.donation.pickup_code;
  }
  return copy;
}

function normalizeLot(detail, base = {}) {
  const cleanBase = sanitizeLot(base);
  if (!detail || typeof detail !== 'object') return cleanBase;
  const cleanDetail = sanitizeLot(detail);
  const core = cleanDetail.donation && typeof cleanDetail.donation === 'object' ? cleanDetail.donation : cleanDetail;
  const merged = sanitizeLot({ ...cleanBase, ...core });
  merged.stores = cleanDetail.store ?? core.stores ?? core.store ?? cleanBase.stores ?? (merged.store_name ? { name: merged.store_name, address: merged.store_address || null } : null);
  merged.charity_profiles = cleanDetail.charity ?? core.charity_profiles ?? core.charity ?? cleanBase.charity_profiles ?? (merged.charity_name ? { name: merged.charity_name } : null);
  merged.volunteers = cleanDetail.volunteer ?? core.volunteers ?? cleanBase.volunteers ?? null;
  merged.donation_assignments = Array.isArray(cleanDetail.assignments) ? cleanDetail.assignments
    : Array.isArray(cleanDetail.donation_assignments) ? cleanDetail.donation_assignments
    : Array.isArray(core.donation_assignments) ? core.donation_assignments
    : Array.isArray(cleanBase.donation_assignments) ? cleanBase.donation_assignments : [];
  merged.inlinePhotos = Array.isArray(cleanDetail.photos) ? cleanDetail.photos
    : Array.isArray(core.photos) ? core.photos : null;
  const rawReport = cleanDetail.report && typeof cleanDetail.report === 'object' ? cleanDetail.report : null;
  if (rawReport?.donation && typeof rawReport.donation === 'object') {
    rawReport.donation = { ...rawReport.donation };
    delete rawReport.donation.pickup_code;
  }
  merged.inlineReport = rawReport || (Array.isArray(cleanDetail.timeline) ? { donation: merged, timeline: cleanDetail.timeline } : null);
  return merged;
}

let cleanup = [];

export default {
  id: 'donations',
  title: 'Lô tặng & ghép đơn',
  group: 'HOẠT ĐỘNG',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;
    this.destroy();

    container.innerHTML = html`<div data-screen="donations"><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    const tab = TABS.some((t) => t.key === ctx.params?.tab) ? ctx.params.tab : 'lots';
    const status = tab === 'lots' && has(LOT_STATUS, ctx.params?.status) ? ctx.params.status : '';
    const pageParam = Number.parseInt(ctx.params?.page, 10);
    let page = tab === 'lots' && Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
    let query = tab === 'lots' ? String(ctx.params?.q ?? '') : '';
    let data = null; // lots: { items, total, page, hasNext } | needs: mảng
    let busy = false;
    let searchTimer = null;

    const go = (next) => {
      const t = next.tab ?? tab;
      const nextStatus = t === 'lots' ? (next.status ?? status) : '';
      const nextQ = t === 'lots' ? (next.q ?? query).trim() : '';
      const nextPage = t === 'lots' ? (next.page ?? 1) : 1;
      ctx.navigate('donations', {
        tab: t === 'lots' ? undefined : t,
        status: nextStatus || undefined,
        q: nextQ || undefined,
        page: nextPage > 1 ? nextPage : undefined,
      });
    };

    const buildLotsPath = () => {
      const sp = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (status) sp.set('status', status);
      if (query.trim()) sp.set('q', query.trim().slice(0, 80));
      return `/admin/donations?${sp.toString()}`;
    };

    const pill = (map, key, fallback = 'Không rõ') => {
      const [text, level] = has(map, key) ? map[key] : [fallback, 'm'];
      return html`<span class="b b-${raw(level)}">${text}</span>`;
    };
    const head = (cols) => cols.map((h) => html`<th>${h}</th>`).join('');
    const storeNameOf = (d) => d?.stores?.name || d?.store?.name || d?.store_name || '—';
    const charityNameOf = (d) => d?.charity_profiles?.name || d?.charity?.name || d?.charity_name || 'Chưa có tổ chức';

    function lotRow(d) {
      return html`<tr data-act="open" data-id="${d.id}"><td><b>${d.donation_code || idShort(d.id)}</b></td>
        <td>${storeNameOf(d)}</td><td>${charityNameOf(d)}</td>
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
      const hadFocus = document.activeElement?.dataset?.role === 'search';
      let main;
      if (tab === 'lots') {
        const filters = [{ key: '', title: 'Tất cả' }, ...Object.keys(LOT_STATUS).map((k) => ({ key: k, title: LOT_STATUS[k][0] }))]
          .map((t) => html`<button type="button" class="bt${raw(status === t.key ? ' bt-p' : '')}" data-act="status" data-status="${t.key}"${raw(status === t.key ? ' aria-current="true"' : '')}>${t.title}</button>`).join('');
        const cur = data.page || page;
        const total = data.total;
        const hasNext = Boolean(data.hasNext);
        const rows = data.items.length
          ? data.items.map(lotRow).join('')
          : html`<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:18px;cursor:default">Không có lô tặng nào.</td></tr>`;
        main = html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${raw(filters)}</div>
          <section class="P"><div class="P-h"><span class="P-t">Lô tặng${raw(total != null ? html` (${total})` : '')}</span>
            <span class="P-a" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <input type="search" data-role="search" aria-label="Tìm lô tặng" placeholder="Tìm mã lô, cửa hàng, mặt hàng" maxlength="80" style="padding:6px 10px;border:1px solid var(--bd2);border-radius:var(--rs);min-width:210px">
              <button type="button" class="bt" data-act="prev"${raw(cur <= 1 ? ' disabled' : '')}>Trước</button>
              <span style="align-self:center;font-size:.72rem;color:var(--t3)">Trang ${cur}</span>
              <button type="button" class="bt" data-act="next"${raw(hasNext ? '' : ' disabled')}>Sau</button></span></div>
            <div class="W"><table class="tbl" data-role="lots-table"><thead><tr>${raw(head(['Mã lô', 'Cửa hàng', 'Tổ chức', 'Mặt hàng / số phần', 'Mức khẩn', 'Trạng thái', 'Tạo lúc']))}</tr></thead><tbody>${raw(rows)}</tbody></table></div></section>`;
      } else {
        const rows = data.length
          ? data.map(needRow).join('')
          : html`<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:18px;cursor:default">Chưa có nhu cầu ghép đơn nào.</td></tr>`;
        main = html`<section class="P"><div class="P-h"><span class="P-t">Nhu cầu ghép đơn (${data.length})</span><span style="font-size:.72rem;color:var(--t3)">50 nhu cầu mới nhất</span></div>
          <div class="W"><table class="tbl" data-role="needs-table"><thead><tr>${raw(head(['Tổ chức', 'Nhu cầu', 'Số phần', 'Cần trước', 'Trạng thái', 'Đã ghép', 'Tạo lúc']))}</tr></thead><tbody>${raw(rows)}</tbody></table></div></section>`;
      }
      body.innerHTML = html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(tabs)}</div>${raw(main)}`;
      const searchEl = body.querySelector('[data-role="search"]');
      if (searchEl) {
        searchEl.value = query;
        if (hadFocus) {
          searchEl.focus();
          searchEl.setSelectionRange(query.length, query.length);
        }
      }
    }

    let seq = 0;
    async function draw({ quiet = false, rethrow = quiet } = {}) {
      const mine = ++seq;
      if (!quiet || !data) loading(body);
      try {
        let next;
        if (tab === 'lots') {
          const res = await api.get(buildLotsPath(), { signal });
          const items = (Array.isArray(res?.items) ? res.items : []).map(sanitizeLot);
          const pg = res?.pagination || {};
          const total = Number.isFinite(Number(res?.total)) ? Number(res.total) : (Number.isFinite(Number(pg.total)) ? Number(pg.total) : null);
          const curPage = Number(res?.page || pg.page) || page;
          const curLimit = Number(res?.limit || pg.limit) || LIMIT;
          const hasNext = typeof pg.has_next_page === 'boolean'
            ? pg.has_next_page
            : (total != null ? curPage * curLimit < total : items.length >= curLimit);
          next = { items, total, page: curPage, hasNext };
        } else {
          const res = await api.get('/matching/needs', { signal });
          next = Array.isArray(res) ? res : res?.items || [];
        }
        if (!alive() || mine !== seq) return;
        data = next;
        drawBody();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet) {
          if (data) console.warn('[MIO] Không làm mới được dữ liệu lô tặng:', err);
          else error(body, err, () => draw());
          if (rethrow && isPollFailure(err)) throw err;
          return;
        }
        error(body, err, () => draw());
      }
    }

    // ---------- Ngăn kéo lô ----------
    const row = (k, v) => html`<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0"><span style="color:var(--t3)">${k}</span><span style="text-align:right">${raw(v)}</span></div>`;
    const sec = (title, inner) => html`<section style="margin-top:14px"><div style="font-weight:700;margin-bottom:6px">${title}</div>${raw(inner)}</section>`;

    function teamHtml(d) {
      const rows = Array.isArray(d.donation_assignments) ? d.donation_assignments : [];
      const line = (stageLabel, name, phone, share, doneAt) => {
        const masked = safePhone(phone);
        return html`<div style="padding:3px 0"><b>${stageLabel}</b> · ${name}${masked ? html` · ${masked}` : ''}${share != null ? html` · ${share} phần` : ''}
          <small style="color:var(--t3)"> ${doneAt ? `xong ${stamp(doneAt)}` : 'chưa xong'}</small></div>`;
      };
      if (rows.length) {
        return rows.map((a) => line(a.stage === 'distribute' ? 'Phát hàng' : 'Lấy hàng', a.volunteers?.full_name || a.volunteer_name || 'TNV', a.volunteers?.phone || a.volunteer_phone, a.share, a.done_at)).join('');
      }
      if (d.volunteers?.full_name) return line('Lấy hàng', d.volunteers.full_name, d.volunteers.phone, null, null);
      return html`<span style="color:var(--t3)">Chưa giao đội tình nguyện viên.</span>`;
    }

    const photoHtml = (p) => {
      const safe = typeof p.photo_url === 'string' && p.photo_url.startsWith('https://');
      const flag = p.gps_flag ? html`<br><span class="b b-w">Vị trí chụp xa điểm hẹn</span>` : '';
      const note = p.review_note ? html`<br><small>${p.review_note}</small>` : '';
      return html`<div style="display:inline-block;width:150px;margin:0 8px 8px 0;vertical-align:top">
        ${raw(safe ? html`<img src="${p.photo_url}" alt="Ảnh minh chứng" loading="lazy" referrerpolicy="no-referrer" style="width:150px;height:110px;object-fit:cover;border-radius:6px;border:1px solid var(--bd)">`
          : html`<div style="width:150px;height:110px;display:grid;place-items:center;color:var(--t3);border:1px dashed var(--bd);border-radius:6px">Không có ảnh hợp lệ</div>`)}
        <div><b>${STAGE[p.stage] || 'Ảnh'}</b> ${raw(pill(PHOTO_STATUS, p.status))}</div>
        <small style="color:var(--t3)">${p.volunteers?.full_name || p.volunteer_name || 'TNV'} · ${stamp(p.taken_at)}${p.is_demo ? ' · ảnh mẫu' : ''}</small>${raw(flag)}${raw(note)}</div>`;
    };

    function formatReportHtml(r) {
      const timeline = (Array.isArray(r?.timeline) ? r.timeline : []).map((t) => html`<div style="padding:3px 0"><small style="color:var(--t3)">${stamp(t.at)}</small> ${t.label}</div>`).join('');
      const dn = r?.donation || {};
      const lines = [];
      if (dn.portions != null) lines.push(row('Số suất phát', html`${dn.portions}`));
      if (dn.completed_at) lines.push(row('Cửa hàng bàn giao', html`${stamp(dn.completed_at)}`));
      if (dn.distribution_done_at) lines.push(row('Hoàn tất phát hàng', html`${stamp(dn.distribution_done_at)}`));
      return (lines.join('') + timeline) || html`Chưa có dữ liệu báo cáo.`;
    }

    function lotBody(d, warnNote = '') {
      const canCancel = d.status !== 'completed' && d.status !== 'cancelled';
      const actionArea = canCancel
        ? html`<button type="button" class="bt b-e" data-act="cancel-lot" data-id="${d.id}" data-code="${d.donation_code || idShort(d.id)}">Hủy lô</button>`
        : html`<span style="color:var(--t3)">Lô tặng đã kết thúc, không còn thao tác can thiệp.</span>`;
      const offer = d.status === 'open' && d.offer_expires_at ? left(d.offer_expires_at).text : '';
      const storeAddress = d.stores?.address || d.store_address || '';
      return html`<div data-lot-detail="${d.id}" style="padding:16px 18px;font-size:.8rem">
        ${raw(warnNote ? html`<p style="color:var(--warn)">${warnNote}</p>` : '')}
        <div>${raw(pill(LOT_STATUS, d.status))} ${raw(has({ green: 1, yellow: 1, red: 1 }, d.urgency) ? badge('label', d.urgency) : '')}</div>
        ${raw(row('Cửa hàng', html`${storeNameOf(d)}${storeAddress ? html`<br><small style="color:var(--t3)">${storeAddress}</small>` : ''}`))}
        ${raw(row('Tổ chức', html`${charityNameOf(d)}`))}
        ${raw(row('Mặt hàng', html`${d.items || '—'}`))}
        ${raw(row('Số lượng', html`${d.amount_text || (d.quantity != null ? `${d.quantity} phần` : '—')}${d.weight_kg != null ? html` · ${d.weight_kg} kg` : ''}`))}
        ${raw(row('Hạn sử dụng', html`${stamp(d.expires_at)}`))}
        ${raw(row('Khung giờ lấy', html`${d.pickup_start || '—'} – ${d.pickup_end || '—'}`))}
        ${raw(offer ? row('Hạn nhận lời', html`${offer}`) : '')}
        ${raw(row('Tạo lúc', html`${stamp(d.created_at)}`))}
        ${raw(d.cancel_reason ? row('Lý do hủy', html`${d.cancel_reason}`) : '')}
        ${raw(d.note ? row('Ghi chú', html`${d.note}`) : '')}
        ${raw(sec('Đội tình nguyện viên', teamHtml(d)))}
        ${raw(sec('Ảnh minh chứng', html`<div data-role="photos" data-lot="${d.id}" style="font-size:.76rem;color:var(--t2)">Đang tải…</div>`))}
        ${raw(sec('Báo cáo lô', html`<div data-role="report" data-lot="${d.id}" style="font-size:.76rem;color:var(--t2)">Đang tải…</div>`))}
        ${raw(sec('Thao tác của Admin', html`<div style="display:flex;gap:6px;flex-wrap:wrap" data-role="admin-actions">${raw(actionArea)}</div>`))}
      </div>`;
    }

    const slot = (role, id) => document.querySelector(`#drawer [data-role="${role}"][data-lot="${id}"]`);

    function attachImgErrorGuard(el) {
      el.addEventListener('error', (e) => {
        if (e.target?.tagName === 'IMG') e.target.replaceWith(Object.assign(document.createElement('span'), { textContent: 'Không tải được ảnh' }));
      }, true);
    }

    function renderPhotosSlot(id, items) {
      const el = slot('photos', id);
      if (!alive() || !el) return;
      el.innerHTML = items.length ? items.map(photoHtml).join('') : html`Chưa có ảnh minh chứng.`;
      attachImgErrorGuard(el);
    }

    async function loadPhotos(id) {
      try {
        const res = await api.get(`/donations/${encodeURIComponent(id)}/photos`, { signal });
        const items = Array.isArray(res) ? res : res?.items || [];
        renderPhotosSlot(id, items);
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
        el.innerHTML = formatReportHtml(r);
      } catch (err) {
        const el = slot('report', id);
        if (!alive() || !el || err?.name === 'AbortError') return;
        el.innerHTML = html`Không tải được báo cáo lô.`;
      }
    }

    let drawerSeq = 0;
    async function openLot(id) {
      if (!id) return;
      const base = Array.isArray(data?.items) ? data.items.find((x) => x.id === id) : null;
      const mine = ++drawerSeq;
      const initialTitle = `Lô ${base?.donation_code || idShort(id)}`;
      drawer.open(html`<div data-lot-detail="${id}" style="padding:16px 18px"><div aria-busy="true" class="skeleton" style="height:14px"></div></div>`, { title: initialTitle });

      let lot = base ? normalizeLot(null, base) : null;
      let warnNote = '';
      try {
        const detail = await api.get(`/admin/donations/${encodeURIComponent(id)}`, { signal });
        lot = normalizeLot(detail, base || { id });
      } catch (err) {
        if (!alive() || mine !== drawerSeq || err?.name === 'AbortError') return;
        if (!lot) {
          drawer.open(html`<div role="alert" style="padding:16px;color:var(--err)">${err?.message || 'Không tải được chi tiết lô tặng.'}</div>`, { title: initialTitle });
          return;
        }
        warnNote = 'Không tải được chi tiết mới nhất, đang hiện dữ liệu từ danh sách.';
      }
      if (!alive() || mine !== drawerSeq) return;
      const drawerEl = document.getElementById('drawer');
      if (!drawerEl?.classList.contains('open') || !drawerEl.querySelector(`[data-lot-detail="${id}"]`)) return;

      drawer.open(lotBody(lot, warnNote), { title: `Lô ${lot.donation_code || idShort(id)}` });

      if (Array.isArray(lot.inlinePhotos)) {
        renderPhotosSlot(id, lot.inlinePhotos);
      } else {
        loadPhotos(id);
      }
      if (lot.inlineReport) {
        const repEl = slot('report', id);
        if (repEl) repEl.innerHTML = formatReportHtml(lot.inlineReport);
      } else {
        loadReport(id);
      }
    }

    async function cancelLot(id, codeText) {
      if (busy || !id) return;
      const res = await ctx.ui.confirm({
        title: `Hủy lô tặng ${codeText || idShort(id)}?`,
        body: 'Lô tặng chuyển sang Đã hủy, thông báo cho cửa hàng / tổ chức liên quan và ghi vào Nhật ký.',
        danger: true,
        reasonRequired: true,
        reasonLabel: 'Lý do hủy lô (bắt buộc, ít nhất 3 ký tự)',
        confirmText: 'Hủy lô',
      });
      if (!res.ok || !alive()) return;
      busy = true;
      try {
        await api.post(`/admin/donations/${encodeURIComponent(id)}/cancel`, { reason: res.reason }, { signal });
        if (!alive()) return;
        ctx.ui.toast('Đã hủy lô tặng');
        drawer.close();
        await draw({ quiet: true, rethrow: false });
        ctx.refreshWork();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Không hủy được lô tặng', 'err');
      } finally {
        busy = false;
      }
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => { if (el.dataset.tab !== tab) go({ tab: el.dataset.tab, status: '', q: '', page: 1 }); });
    delegate(root, 'click', '[data-act="status"]', (_e, el) => { if (el.dataset.status !== status) go({ status: el.dataset.status, page: 1 }); });
    delegate(root, 'click', '[data-act="prev"]', () => { if (page > 1) go({ page: page - 1 }); });
    delegate(root, 'click', '[data-act="next"]', () => { if (data?.hasNext) go({ page: page + 1 }); });
    delegate(root, 'click', 'tr[data-act="open"]', (_e, el) => openLot(el.dataset.id));
    delegate(root, 'input', '[data-role="search"]', (_e, el) => {
      query = el.value;
      page = 1;
      history.replaceState(null, '', buildHash('donations', { status: status || '', q: query.trim() || '' }));
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { searchTimer = null; if (alive()) draw({ quiet: true, rethrow: false }); }, SEARCH_DEBOUNCE_MS);
    });

    const drawerEl = typeof document !== 'undefined' ? document.getElementById('drawer') : null;
    if (drawerEl) {
      cleanup.push(delegate(drawerEl, 'click', '[data-act="cancel-lot"]', (_e, el) => cancelLot(el.dataset.id, el.dataset.code)));
    }
    cleanup.push(() => { if (searchTimer) clearTimeout(searchTimer); drawerSeq += 1; });

    ctx.poll.add('screen:donations', () => draw({ quiet: true }), { everyMs: REFRESH_MS });
    await draw();
  },

  destroy() {
    cleanup.forEach((off) => off());
    cleanup = [];
    drawer.close();
  },
};
