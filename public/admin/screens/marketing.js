// Màn "Đăng bài tự động": AI/Auto-bot đăng bài tổng hợp (nhãn đỏ/vàng) lên Fanpage trung tâm của MIO.
// 4 tab lưu trong hash (#/marketing?tab=overview|queue|history|settings); tất cả lấy từ một API /marketing/admin/overview.
// Ghi: PATCH settings (bật/tắt AI, tự đăng), POST preview (xem trước), POST run (đăng thử, có thể lên Fanpage thật).
// Poll 120 giây ở tab tổng quan và hàng chờ.
import { stamp, vnd } from '../core/format.js';

const REFRESH_MS = 120000;
const MAX_PICK = 3;
const TABS = [
  { key: 'overview', title: 'Tổng quan' },
  { key: 'queue', title: 'Hàng chờ đăng' },
  { key: 'history', title: 'Lịch sử' },
  { key: 'settings', title: 'Thiết lập' },
];

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const pick = (map, key, fallback) => (own(map, key) ? map[key] : fallback);

const LABELS = { red: ['Nhãn đỏ', 'e'], yellow: ['Nhãn vàng', 'w'] };
const TIERS = { ai: 'AI viết', template: 'Caption mẫu', direct: 'Đăng trực tiếp' };
const STATUSES = { sent: ['Đã đăng', 'ok'], posted: ['Đã đăng', 'ok'], failed: ['Lỗi', 'e'], queued: ['Đang xử lý', 'i'], ready: ['Đã tạo sẵn', 'm'] };
const MODES = { ai: 'AI viết caption (qua n8n)', template: 'Caption mẫu (qua n8n)', direct: 'Đăng trực tiếp từ máy chủ', none: 'Chưa cấu hình đăng bài' };
const PLATFORMS = [['facebook', 'Facebook', '#1877F2'], ['instagram', 'Instagram', '#DD2A7B'], ['tiktok', 'TikTok', '#111512'], ['zalo', 'Zalo OA', '#06B6D4'], ['buyers', 'Thông báo trong ứng dụng', '#1C7C45']];

const https = (url) => (typeof url === 'string' && /^https:\/\//i.test(url) ? url : '');
const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => Number(v) || 0;
const money = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : vnd(v));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isDone = (s) => s === 'sent' || s === 'posted';

function leftText(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h)) return '—';
  const m = Math.max(1, Math.round(h * 60)); // tính theo tổng phút để không ra "2 giờ 60 phút"
  if (m < 60) return `${m} phút`;
  if (m < 1440) return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
  return `${Math.round(m / 1440)} ngày`;
}

const mixOf = (p) => {
  const items = list(p.items);
  const red = p.labels ? num(p.labels.red) : items.filter((i) => i.label === 'red').length;
  const yellow = p.labels ? num(p.labels.yellow) : items.filter((i) => i.label === 'yellow').length;
  return { red, yellow, count: items.length };
};
const describe = (p) => {
  const { red, yellow, count } = mixOf(p);
  const parts = [red ? `${red} đỏ` : '', yellow ? `${yellow} vàng` : ''].filter(Boolean).join(', ');
  return `${count} món${parts ? ` (${parts})` : ''}`;
};
const storesOf = (p) => [...new Set(list(p.items).map((i) => i.store_name).filter(Boolean))];

export default {
  id: 'marketing',
  title: 'Đăng bài tự động',
  group: 'TĂNG TRƯỞNG',

  async render(container, ctx) {
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div data-screen="marketing"><div data-role="tabs"></div><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const tabsBox = root.querySelector('[data-role="tabs"]');
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    const tab = TABS.some((t) => t.key === ctx.params?.tab) ? ctx.params.tab : 'overview';
    let data = null;
    let picks = null; // null = chưa khởi tạo
    let busy = false;
    const hf = { q: '', status: '', label: '' };

    const badgeOf = (map, key, fallback) => {
      const [text, level] = pick(map, key, [fallback, 'm']);
      return html`<span class="b b-${raw(level)}">${text}</span>`;
    };
    const labelBadge = (l) => badgeOf(LABELS, l, '—');
    const statusBadge = (s) => badgeOf(STATUSES, s, 'Khác');
    const tierText = (t) => pick(TIERS, t, 'Chờ n8n');
    const mixBadges = (p) => {
      const { red, yellow } = mixOf(p);
      return [red ? labelBadge('red') : '', yellow ? labelBadge('yellow') : ''].filter(Boolean).join(' ') || html`<span class="b b-m">—</span>`;
    };

    const queue = () => list(data?.queue);
    const waiting = () => queue().filter((q) => !q.recently_posted);
    const aiOn = () => data?.integrations?.ai_enabled === true;
    const autoOn = () => data?.auto_enabled === true;

    // ───── Tab 1: Tổng quan
    function overview() {
      const k = data.kpi || {};
      const w = waiting();
      const red = w.filter((q) => q.label === 'red').length;
      const days = list(data.days);
      const max = Math.max(1, ...days.map((d) => num(d.red) + num(d.yellow)));
      const bars = days.map((d) => {
        const total = num(d.red) + num(d.yellow);
        return html`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end">
          <b style="font-size:.7rem">${total}</b>
          <div style="width:100%;max-width:38px;height:${Math.round((total / max) * 110)}px;display:flex;flex-direction:column-reverse;border-radius:6px 6px 0 0;overflow:hidden;background:var(--bg3)">
            <span style="flex:${num(d.red)};background:var(--err)"></span><span style="flex:${num(d.yellow)};background:var(--warn)"></span></div>
          <small style="font-size:.66rem;color:var(--t3)">${d.label || ''}</small></div>`;
      }).join('');
      const pf = k.platforms_7d || {};
      const platforms = PLATFORMS.map(([key, label, color]) => html`<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:.78rem">
        <span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;background:${color}"></i>${label}</span><b>${num(pf[key])}</b></div>`).join('');
      const events = list(data.posts).slice(0, 6).map((p) => html`<div style="padding:6px 0;border-bottom:1px solid var(--bg3);font-size:.78rem">
        ${p.status === 'failed' ? `Đăng bài ${describe(p)} bị lỗi` : `Bài ${describe(p)}`} ${raw(statusBadge(p.status))}
        <small style="display:block;color:var(--t3)">${stamp(p.created_at)}${p.tier ? ` · ${tierText(p.tier)}` : ''}</small></div>`).join('');
      const kpi = (key, label, value, note, color) => html`<div class="K" data-kpi="${key}"><div class="K-l">${label}</div>
        <div class="K-v"${raw(color ? ` style="color:${color}"` : '')}>${value}</div><div class="K-n">${note}</div></div>`;
      const rate = k.success_rate == null ? '—' : `${num(k.success_rate)}%`;
      return html`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-bottom:16px">
          ${raw(kpi('ai', 'Trợ lý AI', aiOn() ? 'Bật' : 'Tắt', pick(MODES, data.mode, 'Chưa rõ'), aiOn() ? 'var(--ok)' : 'var(--t3)'))}
          ${raw(kpi('auto', 'Tự đăng bài', autoOn() ? 'Bật' : 'Tắt', `Fanpage ${data.central?.name || '—'}`, autoOn() ? 'var(--ok)' : 'var(--t3)'))}
          ${raw(kpi('queue', 'Bài chờ đăng', w.length, `${red} nhãn đỏ · ${w.length - red} nhãn vàng`))}
          ${raw(kpi('today', 'Đã đăng hôm nay', num(k.today), `tối đa ${num(data.limits?.per_day)} bài mỗi ngày, ${num(data.limits?.per_run)} bài mỗi lượt`))}
          ${raw(kpi('rate', 'Đăng thành công 7 ngày', rate, `${num(k.ok_7d)} / ${num(k.tried_7d)} bài${num(k.failed_7d) ? ` · ${num(k.failed_7d)} lỗi` : ''}`))}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">
          <section class="P"><div class="P-h"><span class="P-t">Món đưa vào bài (7 ngày)</span></div>
            <div style="padding:14px 16px"><div style="display:flex;align-items:flex-end;gap:12px;height:150px">${raw(bars)}</div>
            <div style="font-size:.7rem;color:var(--t3);margin-top:10px"><span style="color:var(--err)">■</span> Nhãn đỏ &nbsp; <span style="color:var(--warn)">■</span> Nhãn vàng</div></div></section>
          <section class="P"><div class="P-h"><span class="P-t">Nơi đã đăng (7 ngày)</span></div><div style="padding:8px 16px">${raw(platforms)}</div></section>
        </div>
        <section class="P"><div class="P-h"><span class="P-t">Hoạt động gần đây</span>
          <div class="P-a"><button type="button" class="bt" data-act="tab" data-tab="history">Xem tất cả</button></div></div>
          <div style="padding:6px 16px 10px">${raw(events || html`<div style="padding:16px;color:var(--t3);text-align:center">Chưa có bài tổng hợp nào được đăng.</div>`)}</div></section>`;
    }

    // ───── Tab 2: Hàng chờ đăng
    function queueTab() {
      const rows = queue().map((q) => html`<tr data-id="${q.product_id}">
        <td style="width:34px"><input type="checkbox" data-act="pick" data-id="${q.product_id}"${raw(picks.includes(q.product_id) ? ' checked' : '')} aria-label="Chọn ${q.name}"></td>
        <td><b>${q.emoji || ''} ${q.name}</b>${raw(q.recently_posted ? ' <span class="b b-m">Vừa đăng</span>' : '')}<small style="display:block;color:var(--t3)">${q.store_name || '—'}</small></td>
        <td>${raw(labelBadge(q.label))}</td><td>${leftText(q.hours_left)}</td><td>${money(q.price_vnd)}</td></tr>`).join('');
      if (!queue().length) return html`<section class="P"><div style="padding:32px 16px;text-align:center;color:var(--t3)"><b>Chưa có hàng nhãn đỏ/vàng nào còn bán.</b><div style="font-size:.78rem;margin-top:4px">Bài tổng hợp chỉ gom hàng nhãn đỏ và nhãn vàng còn bán.</div></div></section>`;
      return html`<section class="P"><div class="P-h"><span class="P-t">Hàng chờ đăng · chọn tối đa ${MAX_PICK} món cho một bài</span>
          <div class="P-a"><button type="button" class="bt" data-act="pick-top">Chọn theo ưu tiên</button>
            <button type="button" class="bt" data-act="preview">Xem trước</button>
            <button type="button" class="bt b-e" data-act="run">Chạy thử ngay</button></div></div>
        <div class="W"><table class="tbl" data-role="queue-table"><thead><tr><th></th><th>Sản phẩm</th><th>Nhãn</th><th>Còn lại</th><th>Giá</th></tr></thead><tbody>${raw(rows)}</tbody></table></div>
        <p style="font-size:.72rem;color:var(--t3);padding:8px 16px">"Xem trước" chỉ dựng bài, không đăng. "Chạy thử ngay" có thể đăng lên Fanpage thật.</p></section>`;
    }

    function syncButtons() {
      for (const act of ['preview', 'run']) {
        const btn = root.querySelector(`[data-act="${act}"]`);
        if (btn) btn.disabled = busy || picks.length === 0;
      }
    }

    // ───── Tab 3: Lịch sử
    function filtered() {
      const q = hf.q.trim().toLowerCase();
      return list(data.posts).filter((p) => {
        const text = `${list(p.items).map((i) => `${i.name} ${i.store_name}`).join(' ')} ${p.content || ''}`.toLowerCase();
        const mix = mixOf(p);
        return (!q || text.includes(q))
          && (!hf.label || (hf.label === 'red' ? mix.red > 0 : mix.yellow > 0))
          && (!hf.status || (hf.status === 'ok' ? isDone(p.status) : p.status === hf.status));
      });
    }
    function historyRows() {
      const rows = filtered();
      if (!rows.length) return html`<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:24px">${list(data.posts).length ? 'Không có bài nào phù hợp bộ lọc.' : 'Chưa có bài tổng hợp nào.'}</td></tr>`;
      return rows.map((p) => html`<tr data-act="open-post" data-id="${p.id}"><td>${stamp(p.created_at)}</td>
        <td><b>${describe(p)}</b><small style="display:block;color:var(--t3)">${storesOf(p).length} cửa hàng</small></td>
        <td>${raw(mixBadges(p))}</td><td>${tierText(p.tier)}</td><td>${raw(statusBadge(p.status))}</td></tr>`).join('');
    }
    function historyTab() {
      const opt = (v, text, cur) => html`<option value="${v}"${raw(cur === v ? ' selected' : '')}>${text}</option>`;
      return html`<section class="P"><div class="P-h"><div style="display:flex;gap:8px;flex-wrap:wrap" data-role="history-filter">
          <input name="q" placeholder="Tìm món, cửa hàng…" value="${hf.q}" aria-label="Tìm bài" style="min-width:200px">
          <select name="label" aria-label="Lọc theo nhãn">${raw(opt('', 'Mọi nhãn', hf.label) + opt('red', 'Có hàng đỏ', hf.label) + opt('yellow', 'Có hàng vàng', hf.label))}</select>
          <select name="status" aria-label="Lọc theo trạng thái">${raw(opt('', 'Mọi trạng thái', hf.status) + opt('ok', 'Đã đăng', hf.status) + opt('failed', 'Lỗi', hf.status) + opt('queued', 'Đang xử lý', hf.status))}</select></div></div>
        <div class="W"><table class="tbl" data-role="history-table"><thead><tr><th>Thời gian</th><th>Nội dung bài</th><th>Nhãn</th><th>Cách đăng</th><th>Trạng thái</th></tr></thead>
          <tbody>${raw(historyRows())}</tbody></table></div></section>`;
    }

    function openPost(id) {
      const p = list(data?.posts).find((x) => x.id === id);
      if (!p) return;
      const link = https(p.external_url);
      const items = list(p.items).map((i) => html`<div class="DR"><div class="DR-l">${i.store_name || '—'}</div>
        <div class="DR-v">${i.emoji || ''} ${i.name} · ${raw(labelBadge(i.label))} · ${money(i.price_vnd)}</div></div>`).join('');
      ctx.ui.drawer.open(html`<div>
        <div class="DR"><div class="DR-l">Thời gian</div><div class="DR-v">${stamp(p.created_at)}</div></div>
        <div class="DR"><div class="DR-l">Trạng thái</div><div class="DR-v">${raw(statusBadge(p.status))}</div></div>
        <div class="DR"><div class="DR-l">Cách đăng</div><div class="DR-v">${tierText(p.tier)}</div></div>
        ${raw(p.status === 'failed' || p.error ? html`<div class="DR"><div class="DR-l">Đăng lỗi</div><div class="DR-v" style="color:var(--err)">${p.error ? raw(html`<small style="display:block;color:var(--t3)">Lỗi gốc từ hệ thống đăng:</small>${p.error}`) : 'Không có chi tiết lỗi.'}</div></div>` : '')}
        ${raw(link ? html`<div class="DR"><div class="DR-l">Bài trên Fanpage</div><div class="DR-v"><a class="lk" href="${link}" target="_blank" rel="noopener noreferrer">Mở bài</a></div></div>` : '')}
        <div style="padding:10px 18px;font-size:.72rem;font-weight:600;color:var(--t3)">Món trong bài</div>${raw(items || html`<div class="DR"><div class="DR-v">—</div></div>`)}
        <div style="padding:10px 18px;font-size:.72rem;font-weight:600;color:var(--t3)">Nội dung</div>
        <div style="padding:0 18px 18px;white-space:pre-line;font-size:.8rem">${p.content || '—'}</div></div>`, { title: 'Chi tiết bài đăng' });
    }

    // ───── Tab 4: Thiết lập
    function settingsTab() {
      const i = data.integrations || {};
      const row = (title, sub, good, text) => html`<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--bg3);font-size:.78rem">
        <div style="flex:1;min-width:0"><b>${title}</b><small style="display:block;color:var(--t3)">${sub}</small></div>
        <span class="b b-${raw(good === true ? 'ok' : good === false ? 'e' : 'm')}">${text}</span></div>`;
      const toggle = (key, title, sub, on, onText, offText) => html`<div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--bd)">
        <div style="flex:1"><b>${title}</b><small style="display:block;color:var(--t3);margin-top:2px">${sub}</small></div>
        <span class="b b-${raw(on ? 'ok' : 'm')}">${on ? 'Đang bật' : 'Đang tắt'}</span>
        <button type="button" class="bt${raw(on ? '' : ' bt-p')}" data-act="toggle" data-key="${key}"${raw(busy ? ' disabled' : '')}>${on ? offText : onText}</button></div>`;
      return html`<section class="P"><div class="P-h"><span class="P-t">Công tắc</span></div>
          ${raw(toggle('auto_enabled', 'Tự đăng bài', 'Hàng nhãn đỏ/vàng của mọi cửa hàng được gom thành bài tổng hợp và tự đăng lên Fanpage.', autoOn(), 'Bật tự đăng', 'Tắt tự đăng'))}
          ${raw(toggle('ai_enabled', 'Trợ lý AI viết caption', 'Khi tắt, hệ thống dùng caption mẫu. Giá, giờ nhận và tên cửa hàng luôn do hệ thống chèn.', aiOn(), 'Bật AI', 'Tắt AI'))}</section>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">
          <section class="P"><div class="P-h"><span class="P-t">Kết nối Facebook</span></div><div style="padding:4px 16px 10px">
            ${raw(row('Fanpage trung tâm', data.central?.name || '—', Boolean(data.central?.id), data.central?.id ? 'Đã cấu hình' : 'Thiếu'))}
            ${raw(row('n8n', 'Nhận lệnh đăng bài', i.n8n_configured === true, i.n8n_configured ? 'Đã cấu hình' : 'Chưa cấu hình'))}
            ${raw(row('Đăng trực tiếp (dự phòng)', 'Dùng khi n8n không gọi được', i.direct_fallback === true, i.direct_fallback ? 'Có' : 'Chưa có'))}
            ${raw(row('Cách đăng hiện tại', 'Theo cấu hình ở trên', null, pick(MODES, data.mode, 'Chưa rõ')))}</div></section>
          <section class="P"><div class="P-h"><span class="P-t">Giới hạn và nền tảng khác</span></div><div style="padding:4px 16px 10px">
            ${raw(row('Giới hạn đăng', 'Cố định để tránh spam', null, `${num(data.limits?.per_run)} bài/lượt · ${num(data.limits?.per_day)} bài/ngày`))}
            ${raw(['Instagram', 'TikTok', 'Zalo OA'].map((n) => row(n, 'Tạo sẵn nội dung để đăng thủ công', null, 'Sắp có tự đăng')).join(''))}</div></section>
        </div>`;
    }

    function drawTabs() {
      tabsBox.innerHTML = html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(TABS.map((t) => {
        const count = t.key === 'queue' && data ? ` (${waiting().length})` : '';
        return html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-tab="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title}${count}</button>`;
      }).join(''))}</div>`;
    }

    function drawBody() {
      if (picks === null) picks = waiting().slice(0, MAX_PICK).map((q) => q.product_id);
      picks = picks.filter((id) => queue().some((q) => q.product_id === id));
      drawTabs();
      body.innerHTML = tab === 'queue' ? queueTab() : tab === 'history' ? historyTab() : tab === 'settings' ? settingsTab() : overview();
      syncButtons();
    }

    let seq = 0;
    async function draw({ quiet = false } = {}) {
      const mine = ++seq;
      if (!quiet || !data) loading(body);
      try {
        const res = await api.get('/marketing/admin/overview', { signal });
        if (!alive() || mine !== seq) return;
        data = res || {};
        drawBody();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        if (quiet && data) { console.warn('[MIO] Không làm mới được màn đăng bài tự động:', err); return; }
        error(body, err, () => draw());
      }
    }

    // Chạy một việc ghi: khóa nút, báo kết quả bằng toast, tải lại
    async function write(job) {
      busy = true;
      syncButtons();
      try {
        await job();
        if (!alive()) return;
        await draw({ quiet: true });
        ctx.refreshWork();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        ctx.ui.toast(err?.message || 'Không xử lý được', 'err');
      } finally {
        busy = false;
        if (alive() && data) drawBody();
      }
    }

    async function preview() {
      if (busy || !picks.length) return;
      busy = true;
      syncButtons();
      try {
        const b = await api.post('/marketing/admin/preview', { product_ids: [...picks] }, { signal });
        if (!alive()) return;
        const hero = https(b?.hero_image_url);
        const items = list(b?.items).map((i) => html`<div class="DR"><div class="DR-l">${i.store_name || '—'}</div>
          <div class="DR-v">${i.emoji || ''} ${i.name} · giảm ${num(i.discount_percent)}% · ${money(i.price_vnd)} · lấy trước ${i.deadline_text || '—'}</div></div>`).join('');
        ctx.ui.drawer.open(html`<div>
          <div style="padding:14px 18px"><div data-role="preview-message" style="white-space:pre-line;font-size:.82rem;line-height:1.55;border:1px solid var(--bd);border-radius:12px;padding:12px">${b?.message || '—'}</div>
            ${raw(hero ? html`<img src="${hero}" alt="Ảnh bài đăng" style="width:100%;margin-top:12px;border-radius:12px" referrerpolicy="no-referrer">` : '')}</div>
          <div style="padding:6px 18px;font-size:.72rem;font-weight:600;color:var(--t3)">Món trong bài${num(b?.more_count) ? ` · còn ${num(b.more_count)} món khác trên sàn` : ''}</div>${raw(items)}
          <p style="padding:12px 18px;font-size:.72rem;color:var(--t3)">Bản mẫu của hệ thống, chưa đăng. Khi AI bật, caption có thể được viết lại nhưng giữ nguyên giá, giờ và tên cửa hàng.</p></div>`, { title: 'Xem trước bài đăng' });
      } catch (err) {
        if (err?.name !== 'AbortError') ctx.ui.toast(err?.message || 'Không dựng được bản xem trước', 'err');
      } finally {
        busy = false;
        if (alive()) syncButtons();
      }
    }

    async function run() {
      if (busy || !picks.length) return;
      // Chụp danh sách món NGAY bây giờ: poll có thể vẽ lại và đổi `picks` khi hộp xác nhận đang mở.
      const ids = [...picks];
      const names = ids.map((id) => queue().find((q) => q.product_id === id)?.name).filter(Boolean);
      busy = true;
      syncButtons();
      try {
        const res = await ctx.ui.confirm({
          title: 'Chạy thử ngay?',
          body: `Sẽ gửi bài tổng hợp gồm ${ids.length} món: ${names.join(', ') || '—'}. Bài có thể được đăng lên Fanpage ${data?.central?.name || ''} thật, không thu hồi được từ đây.`,
          danger: true, confirmText: 'Đăng ngay',
        });
        if (!res.ok || !alive()) return;
        // Không bao giờ gửi danh sách rỗng (máy chủ hiểu là tự chọn món và đăng thật)
        const inQueue = new Set(queue().map((q) => q.product_id));
        if (!ids.length || ids.some((id) => !UUID_RE.test(id)) || ids.some((id) => !inQueue.has(id))) {
          ctx.ui.toast('Hàng chờ vừa thay đổi nên chưa đăng. Hãy chọn lại món rồi thử lại.', 'err');
          return;
        }
        await write(async () => {
          const r = await api.post('/marketing/admin/run', { product_ids: ids }, { signal });
          if (r?.status === 'sent') ctx.ui.toast(r.via === 'direct' ? 'Đã đăng trực tiếp lên Fanpage' : 'Đã gửi lệnh đăng cho n8n');
          else ctx.ui.toast('Chưa đăng được. Mở tab Lịch sử để xem lỗi chi tiết.', 'err');
        });
      } finally {
        busy = false;
        if (alive() && data) syncButtons();
      }
    }

    async function toggleSetting(key) {
      if (busy) return;
      const on = key === 'ai_enabled' ? aiOn() : autoOn();
      const name = key === 'ai_enabled' ? 'trợ lý AI' : 'tự đăng bài';
      const res = await ctx.ui.confirm({
        title: `${on ? 'Tắt' : 'Bật'} ${name}?`,
        body: key === 'ai_enabled'
          ? (on ? 'Hệ thống sẽ dùng caption mẫu thay cho AI.' : 'AI sẽ viết caption cho các bài sắp đăng.')
          : (on ? 'Hệ thống ngừng tự đăng bài tổng hợp lên Fanpage.' : 'Hệ thống sẽ tự đăng bài tổng hợp lên Fanpage theo lịch.'),
        confirmText: on ? 'Tắt' : 'Bật',
      });
      if (!res.ok || !alive()) return;
      await write(async () => {
        await api.patch('/marketing/admin/settings', { [key]: !on }, { signal });
        ctx.ui.toast(`Đã ${on ? 'tắt' : 'bật'} ${key === 'ai_enabled' ? 'AI' : 'tự đăng'}`);
      });
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => { if (el.dataset.tab !== tab) ctx.navigate('marketing', { tab: el.dataset.tab }); });
    delegate(root, 'change', '[data-act="pick"]', (_e, el) => {
      const id = el.dataset.id;
      if (el.checked) {
        if (picks.length >= MAX_PICK) { el.checked = false; ctx.ui.toast(`Mỗi bài tổng hợp gom tối đa ${MAX_PICK} món`); return; }
        picks.push(id);
      } else picks = picks.filter((x) => x !== id);
      syncButtons();
    });
    delegate(root, 'click', '[data-act="pick-top"]', () => {
      picks = waiting().slice(0, MAX_PICK).map((q) => q.product_id);
      drawBody();
    });
    delegate(root, 'click', '[data-act="preview"]', () => preview());
    delegate(root, 'click', '[data-act="run"]', () => run());
    delegate(root, 'click', '[data-act="toggle"]', (_e, el) => toggleSetting(el.dataset.key));
    delegate(root, 'click', '[data-act="open-post"]', (_e, el) => openPost(el.dataset.id));
    const refilter = (e, el) => {
      hf[el.name] = el.value;
      const tbody = root.querySelector('[data-role="history-table"] tbody');
      if (tbody) tbody.innerHTML = historyRows();
    };
    delegate(root, 'input', '[data-role="history-filter"] input', refilter);
    delegate(root, 'change', '[data-role="history-filter"] select', refilter);

    ctx.poll.add('screen:marketing', () => (tab === 'overview' || tab === 'queue' ? draw({ quiet: true }) : undefined), { everyMs: REFRESH_MS });
    await draw();
  },

  destroy() {},
};
