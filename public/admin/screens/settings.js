// Màn "Cài đặt": chỉ đọc, phần lớn tĩnh. 5 tab (#/settings?tab=admins|notifications|support|system|reviews).
// Quản trị viên: thẻ tài khoản đang đăng nhập + GET /admin/users (counts.admins).
// Hệ thống: phiên bản cổng, GET /health, GET /marketing/admin/overview (chỉ hiển thị). Các tab còn lại ghi "Sắp có".
import { stamp } from '../core/format.js';

const TABS = [
  { key: 'admins', title: 'Quản trị viên' },
  { key: 'notifications', title: 'Thông báo' },
  { key: 'support', title: 'Hỗ trợ' },
  { key: 'system', title: 'Hệ thống' },
  { key: 'reviews', title: 'Đánh giá' },
];
const SOON = {
  notifications: ['Thông báo', 'Gửi thông báo cho người dùng', [
    'Gửi thông báo theo vai trò hoặc theo từng người.',
    'Lịch sử các thông báo đã gửi.',
    'Thống kê thiết bị đang nhận thông báo đẩy.',
  ], 'Cần API gửi thông báo và API thống kê thiết bị.'],
  support: ['Hỗ trợ', 'Hộp thư hỗ trợ', [
    'Tin nhắn liên hệ gửi từ trang chủ.',
    'Đơn đăng ký trở thành đối tác.',
  ], 'Cần API đọc tin nhắn liên hệ và đơn đăng ký đối tác.'],
  reviews: ['Đánh giá', 'Quản lý đánh giá', [
    'Danh sách đánh giá của khách về cửa hàng.',
    'Ẩn hoặc bỏ ẩn một đánh giá.',
  ], 'Cần API liệt kê và ẩn/bỏ ẩn đánh giá.'],
};
const ENV = { production: 'Chính thức', development: 'Phát triển', test: 'Thử nghiệm', staging: 'Thử trước khi chạy thật' };
const MODE = { ai: 'AI viết bài', template: 'Mẫu bài có sẵn', direct: 'Đăng trực tiếp', none: 'Chưa cấu hình' };

const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null);

export function uptimeText(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} ngày ${h} giờ`;
  if (h > 0) return `${h} giờ ${m} phút`;
  return `${m} phút`;
}

export default {
  id: 'settings',
  title: 'Cài đặt',
  group: 'HỆ THỐNG',

  async render(container, ctx) {
    const { html, raw, delegate, loading } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div data-screen="settings"><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    const tab = TABS.some((t) => t.key === ctx.params?.tab) ? ctx.params.tab : 'admins';
    let seq = 0;

    const panel = (title, inner) => html`<section class="P"><div class="P-h"><span class="P-t">${title}</span></div><div style="padding:14px 16px;font-size:.8rem">${raw(inner)}</div></section>`;
    const row = (label, valueHtml, role) => html`<div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid var(--bd)"><span style="min-width:190px;color:var(--t3)">${label}</span><span${raw(role ? ` data-role="${role}"` : '')}>${raw(valueHtml)}</span></div>`;
    const soonBadge = html`<span class="b b-m">Sắp có</span>`;

    function adminsView(count) {
      const a = ctx.state?.admin;
      const me = [row('Tên', html`${a?.full_name || '—'}`), row('Email', html`${a?.email || '—'}`), row('Số quản trị viên', html`${count}`, 'admin-count'), count === '—' ? html`<small style="color:var(--t3)">Không đọc được số quản trị viên.</small>` : ''].join('');
      const guide = html`<ol style="margin:0;padding-left:20px;line-height:1.7">
        <li>Tạo người dùng mới trong Supabase, mục Authentication, tab Users.</li>
        <li>Chạy câu lệnh SQL cấp quyền quản trị cho hồ sơ của người đó (bảng profiles, vai trò admin).</li>
        <li>Người đó đăng nhập lại ở cổng này.</li></ol>
        <p style="font-size:.74rem;color:var(--t3);margin:8px 0 0">Không gửi mật khẩu hay khóa dịch vụ qua tin nhắn hoặc ghi vào tài liệu.</p>`;
      return html`${raw(panel('Tài khoản đang đăng nhập', me))}
        ${raw(panel('Cách thêm quản trị viên hiện nay', guide))}
        <div style="margin-bottom:16px"><button type="button" class="bt" data-role="add-admin" disabled title="Sắp có — cần API mới">Thêm quản trị viên</button>
          <span style="margin-left:8px">${raw(soonBadge)}</span> <span style="font-size:.74rem;color:var(--t3)">Cần API tạo và cấp quyền quản trị viên.</span></div>`;
    }

    function soonView(key) {
      const [, heading, items, need] = SOON[key];
      const lis = items.map((s) => html`<li>${s}</li>`).join('');
      return html`<section class="P" data-role="soon"><div class="P-h"><span class="P-t">${heading}</span>${raw(soonBadge)}</div>
        <div style="padding:14px 16px;font-size:.8rem"><ul style="margin:0;padding-left:20px;line-height:1.7">${raw(lis)}</ul>
        <p style="font-size:.74rem;color:var(--t3);margin:8px 0 0">${need}</p></div></section>`;
    }

    function systemView({ version, health, overview }) {
      const dash = '—';
      const server = health
        ? html`<b style="color:var(--ok)">Hoạt động</b> · chạy liên tục ${uptimeText(health.uptime_seconds)} · môi trường ${own(ENV, health.environment) || dash} · kiểm tra lúc ${stamp(health.checked_at)}`
        : html`${dash} <small style="color:var(--t3)">Không đọc được trạng thái máy chủ.</small>`;
      const onOff = (v) => (v === true ? 'Bật' : v === false ? 'Tắt' : dash);
      const ai = overview
        ? [row('AI viết bài', html`${onOff(overview.integrations?.ai_enabled)}`), row('Tự động đăng bài', html`${onOff(overview.auto_enabled)}`),
          row('Cách đăng đang dùng', html`${own(MODE, overview.mode) || dash}`),
          row('Giới hạn bài', html`${overview.limits ? `${overview.limits.per_run ?? dash} bài mỗi lần, ${overview.limits.per_day ?? dash} bài mỗi ngày` : dash}`)].join('')
        : html`${dash} <small style="color:var(--t3)">Không đọc được thiết lập AI Agent.</small>`;
      const links = html`<a href="#/marketing?tab=settings">Sửa thiết lập AI Agent ở màn Đăng bài tự động</a><br><a href="#/rules">Chính sách đơn hàng (màn Quy tắc đơn hàng)</a>`;
      return html`${raw(panel('Cổng quản trị', row('Phiên bản cổng', html`${version || dash}`, 'version')))}
        ${raw(panel('Máy chủ', row('Trạng thái', server, 'health')))}
        ${raw(panel('AI Agent đăng bài (chỉ xem)', html`<div data-role="ai-agent">${raw(ai)}</div>`))}
        ${raw(panel('Liên kết liên quan', links))}`;
    }

    function drawTabs() {
      return TABS.map((t) => html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-tab="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title}</button>`).join('');
    }
    function paint(content) {
      body.innerHTML = html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(drawTabs())}</div>${raw(content)}`;
    }

    // Mọi lệnh gọi ở đây chỉ hiển thị: lỗi từng phần hiện "—", không chặn cả màn.
    const safe = async (path) => {
      try { return await api.get(path, { signal }); } catch (err) { if (err?.name === 'AbortError') throw err; return null; }
    };

    async function draw() {
      const mine = ++seq;
      if (SOON[tab]) { paint(soonView(tab)); return; }
      loading(body);
      try {
        if (tab === 'admins') {
          const users = await safe('/admin/users');
          if (!alive() || mine !== seq) return;
          const n = users?.counts?.admins;
          paint(adminsView(Number.isFinite(Number(n)) && n !== null && n !== undefined ? n : '—'));
        } else {
          let version = null;
          try { version = (await import('../core/config.js')).VERSION; } catch { version = null; }
          const [health, overview] = await Promise.all([safe('/health'), safe('/marketing/admin/overview')]);
          if (!alive() || mine !== seq) return;
          paint(systemView({ version, health, overview }));
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
        throw err;
      }
    }

    delegate(root, 'click', '[data-act="tab"]', (_e, el) => { if (el.dataset.tab !== tab) ctx.navigate('settings', { tab: el.dataset.tab }); });

    await draw();
  },

  destroy() {},
};
