// Màn "Cài đặt" (Đợt 4): 5 tab trực tiếp (#/settings?tab=admins|notifications|support|system|reviews).
// Mọi dữ liệu qua Backend API, escape qua tag html, xác nhận trước khi ghi, không mã trạng thái thô.
import { maskPhone, stamp } from '../core/format.js';
import { VI, badge } from '../core/vi.js';

const TABS = [
  { key: 'admins', title: 'Quản trị viên' },
  { key: 'notifications', title: 'Thông báo' },
  { key: 'support', title: 'Hỗ trợ' },
  { key: 'system', title: 'Hệ thống' },
  { key: 'reviews', title: 'Đánh giá' },
];

const ENV = { production: 'Chính thức', development: 'Phát triển', test: 'Thử nghiệm', staging: 'Thử trước khi chạy thật' };
const MODE = { ai: 'AI viết bài', template: 'Mẫu bài có sẵn', direct: 'Đăng trực tiếp', none: 'Chưa cấu hình' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYLOAD_LABELS = {
  district: 'Quận/Huyện',
  city: 'Tỉnh/TP',
  address: 'Địa chỉ',
  daily_surplus: 'Sản lượng dự kiến',
  beneficiaries: 'Người thụ hưởng',
  note: 'Ghi chú',
  website: 'Trang web',
};

const own = (map, key) => (map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const listOf = (res) => (Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : []);
const shortId = (id) => {
  const s = String(id ?? '');
  return UUID_RE.test(s) ? s.slice(0, 8) : s.slice(0, 24);
};

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
    const { html, raw, delegate, loading, error } = ctx.ui;
    const { api, signal } = ctx;

    container.innerHTML = html`<div data-screen="settings"><div data-role="tabs"></div><div data-role="body"></div></div>`;
    const root = container.firstElementChild;
    const tabsBox = root.querySelector('[data-role="tabs"]');
    const body = root.querySelector('[data-role="body"]');
    const alive = () => !signal.aborted && root.isConnected;

    const tab = TABS.some((t) => t.key === ctx.params?.tab) ? ctx.params.tab : 'admins';
    let seq = 0;
    let busy = false;
    let searchTimer = null;

    // Trạng thái cục bộ của từng tab
    let adminsState = { data: null, err: null, formMode: null, formError: '', email: '', fullName: '', identifier: '', reason: '' };
    let notifState = { list: [], total: 0, stats: null, target: 'role', role: 'customer', userId: '', title: '', body: '', push: true, formError: '' };
    let supportState = { sub: ctx.params?.sub === 'applications' ? 'applications' : 'contacts', status: '', q: '', items: [], total: 0 };
    let systemState = { version: null, health: null, overview: null, settings: null };
    let reviewsState = { visibility: 'all', q: '', items: [], total: 0 };

    const panel = (title, inner, actionsHtml = '') => html`<section class="P">
      <div class="P-h"><span class="P-t">${title}</span>${raw(actionsHtml ? `<div class="P-a">${actionsHtml}</div>` : '')}</div>
      <div style="padding:14px 16px;font-size:.8rem">${raw(inner)}</div></section>`;

    const row = (label, valueHtml, role) => html`<div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid var(--bd)">
      <span style="min-width:190px;color:var(--t3)">${label}</span>
      <span${raw(role ? ` data-role="${role}"` : '')}>${raw(valueHtml)}</span></div>`;

    const kpi = (key, label, value, note) => html`<div class="K" data-kpi="${key}">
      <div class="K-l">${label}</div><div class="K-v">${value}</div><div class="K-n">${note}</div></div>`;

    function drawTabs() {
      tabsBox.innerHTML = html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" role="tablist">${raw(
        TABS.map((t) => html`<button type="button" class="bt${raw(tab === t.key ? ' bt-p' : '')}" data-act="tab" data-tab="${t.key}"${raw(tab === t.key ? ' aria-current="page"' : '')}>${t.title}</button>`).join(''),
      )}</div>`;
    }

    const safe = async (path) => {
      try { return await api.get(path, { signal }); } catch (err) { if (err?.name === 'AbortError') throw err; return null; }
    };

    // ─────────────────────────── 1. Tab Quản trị viên ───────────────────────────
    function isSelfAdmin(item) {
      const me = ctx.state?.admin;
      if (!me || !item) return false;
      if (me.id && item.id && String(me.id) === String(item.id)) return true;
      if (me.email && item.email && String(me.email).toLowerCase() === String(item.email).toLowerCase()) return true;
      if (!me.id && !me.email && me.full_name && item.full_name === me.full_name) return true;
      return false;
    }

    function renderAdminForm() {
      if (!adminsState.formMode) return '';
      const errHtml = adminsState.formError
        ? html`<div role="alert" data-role="admin-form-error" style="margin-bottom:10px;padding:8px 12px;border:1px solid var(--err-bd);background:var(--err-bg);color:var(--err);border-radius:var(--rs)">${adminsState.formError}</div>`
        : '';
      if (adminsState.formMode === 'create') {
        return panel('Tạo quản trị viên mới', html`<form data-role="create-admin-form" novalidate style="display:grid;gap:10px;max-width:520px">
          ${raw(errHtml)}
          <label style="display:grid;gap:4px;font-weight:600">Email đăng nhập
            <input type="email" name="email" value="${adminsState.email}" maxlength="160" autocomplete="off" placeholder="quantri@mio.vn" style="padding:7px 10px;border:1px solid var(--bd2);border-radius:var(--rs)">
          </label>
          <label style="display:grid;gap:4px;font-weight:600">Họ và tên
            <input type="text" name="full_name" value="${adminsState.fullName}" maxlength="120" autocomplete="off" placeholder="Nguyễn Văn A" style="padding:7px 10px;border:1px solid var(--bd2);border-radius:var(--rs)">
          </label>
          <label style="display:grid;gap:4px;font-weight:600">Mật khẩu khởi tạo (tối thiểu 10 ký tự)
            <input type="password" name="password" maxlength="128" autocomplete="new-password" placeholder="Nhập ít nhất 10 ký tự" style="padding:7px 10px;border:1px solid var(--bd2);border-radius:var(--rs)">
          </label>
          <div style="display:flex;gap:8px;margin-top:4px">
            <button type="submit" class="bt bt-p" data-act="submit-create-admin"${raw(busy ? ' disabled' : '')}>Tạo quản trị viên</button>
            <button type="button" class="bt" data-act="close-admin-form">Đóng</button>
          </div>
        </form>`);
      }
      return panel('Cấp quyền từ tài khoản có sẵn', html`<form data-role="grant-admin-form" novalidate style="display:grid;gap:10px;max-width:520px">
        ${raw(errHtml)}
        <label style="display:grid;gap:4px;font-weight:600">Email hoặc mã định danh (ID) tài khoản
          <input type="text" name="identifier" value="${adminsState.identifier}" maxlength="160" autocomplete="off" placeholder="nguoidung@example.com hoặc UUID" style="padding:7px 10px;border:1px solid var(--bd2);border-radius:var(--rs)">
        </label>
        <label style="display:grid;gap:4px;font-weight:600">Lý do cấp quyền (tối thiểu 3 ký tự)
          <textarea name="reason" rows="2" maxlength="500" placeholder="Ví dụ: Bổ sung nhân sự vận hành ca tối" style="padding:7px 10px;border:1px solid var(--bd2);border-radius:var(--rs)">${adminsState.reason}</textarea>
        </label>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button type="submit" class="bt bt-p" data-act="submit-grant-admin"${raw(busy ? ' disabled' : '')}>Cấp quyền quản trị</button>
          <button type="button" class="bt" data-act="close-admin-form">Đóng</button>
        </div>
      </form>`);
    }

    function drawAdmins() {
      const me = ctx.state?.admin;
      const d = adminsState.data;
      const countText = d ? String(num(d.total ?? d.items?.length)) : '—';
      const activeText = d ? String(num(d.active_count ?? (d.items || []).filter((x) => x.status === 'active').length)) : '—';
      const meRows = [
        row('Tên', html`${me?.full_name || '—'}`),
        row('Email', html`${me?.email || '—'}`),
        row('Số quản trị viên', html`${countText}`, 'admin-count'),
        row('Đang hoạt động', html`${activeText}`, 'admin-active-count'),
        !d && adminsState.err ? html`<small style="color:var(--t3)">Không đọc được số quản trị viên.</small>` : '',
      ].join('');

      const actionsBar = html`<button type="button" class="bt bt-p" data-act="open-create-admin">Tạo quản trị viên mới</button>
        <button type="button" class="bt" data-act="open-grant-admin">Cấp quyền từ tài khoản có sẵn</button>`;

      let tableSection = '';
      if (adminsState.err && !d) {
        tableSection = html`<section class="P"><div class="P-h"><span class="P-t">Danh sách quản trị viên</span><div class="P-a">${raw(actionsBar)}</div></div>
          <div data-role="admins-error"></div></section>`;
      } else {
        const items = listOf(d);
        const trs = items.map((a) => {
          const self = isSelfAdmin(a);
          const loginAt = a.last_sign_in_at || a.last_login_at;
          const note = a.status === 'suspended' && a.suspended_reason
            ? html`<br><small style="color:var(--t3)">Lý do: ${a.suspended_reason}</small>`
            : '';
          let actHtml = html`<span class="b b-i">Đang đăng nhập</span>`;
          if (!self) {
            const statusBtn = a.status === 'suspended'
              ? html`<button type="button" class="bt bt-p" data-act="admin-status" data-id="${a.id}" data-status="active"${raw(busy ? ' disabled' : '')}>Mở khóa</button>`
              : html`<button type="button" class="bt b-e" data-act="admin-status" data-id="${a.id}" data-status="suspended"${raw(busy ? ' disabled' : '')}>Tạm khóa</button>`;
            const revokeBtn = html`<button type="button" class="bt" data-act="admin-revoke" data-id="${a.id}"${raw(busy ? ' disabled' : '')}>Thu hồi quyền</button>`;
            actHtml = html`<div style="display:flex;gap:6px;flex-wrap:wrap">${raw(statusBtn)}${raw(revokeBtn)}</div>`;
          }
          return html`<tr data-admin-id="${a.id}">
            <td><b>${a.full_name || 'Chưa đặt tên'}</b></td>
            <td>${a.email || '—'}</td>
            <td>${raw(badge('accountStatus', a.status || 'active'))}${raw(note)}</td>
            <td>${stamp(loginAt)}</td>
            <td>${raw(actHtml)}</td>
          </tr>`;
        }).join('');

        tableSection = html`<section class="P">
          <div class="P-h"><span class="P-t">Danh sách quản trị viên</span><div class="P-a">${raw(actionsBar)}</div></div>
          <div class="W"><table class="tbl" data-role="admins-table">
            <thead><tr><th>Họ tên</th><th>Email</th><th>Trạng thái</th><th>Đăng nhập cuối</th><th>Thao tác</th></tr></thead>
            <tbody>${raw(trs || html`<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:20px">Chưa có quản trị viên nào.</td></tr>`)}</tbody>
          </table></div>
        </section>`;
      }

      body.innerHTML = html`${raw(panel('Tài khoản đang đăng nhập', meRows))}
        ${raw(renderAdminForm())}
        ${raw(tableSection)}`;

      if (adminsState.err && !d) {
        const errBox = body.querySelector('[data-role="admins-error"]');
        if (errBox) error(errBox, adminsState.err, () => loadTab());
      }
    }

    async function submitCreateAdmin(form) {
      if (busy) return;
      const email = String(form.elements.email?.value || '').trim().toLowerCase();
      const fullName = String(form.elements.full_name?.value || '').trim();
      const password = String(form.elements.password?.value || '');
      adminsState.email = email;
      adminsState.fullName = fullName;
      if (!EMAIL_RE.test(email)) { adminsState.formError = 'Vui lòng nhập địa chỉ email hợp lệ.'; drawAdmins(); return; }
      if (fullName.length < 2 || fullName.length > 120) { adminsState.formError = 'Họ và tên phải từ 2 đến 120 ký tự.'; drawAdmins(); return; }
      if (password.length < 10) { adminsState.formError = 'Mật khẩu khởi tạo phải có ít nhất 10 ký tự.'; drawAdmins(); return; }

      const res = await ctx.ui.confirm({
        title: 'Tạo quản trị viên mới?',
        body: `Tạo tài khoản quản trị toàn quyền cho ${fullName} (${email}).`,
        confirmText: 'Tạo quản trị viên',
      });
      if (!res.ok || !alive()) return;
      busy = true;
      adminsState.formError = '';
      try {
        await api.post('/admin/admins', { email, full_name: fullName, password }, { signal });
        if (!alive()) return;
        ctx.ui.toast('Đã tạo quản trị viên mới');
        adminsState.formMode = null;
        adminsState.email = '';
        adminsState.fullName = '';
        busy = false;
        await loadTab({ quiet: true });
      } catch (err) {
        busy = false;
        if (err?.name === 'AbortError' || !alive()) return;
        adminsState.formError = err?.message || 'Không tạo được quản trị viên mới.';
        ctx.ui.toast(adminsState.formError, 'err');
        drawAdmins();
      }
    }

    async function submitGrantAdmin(form) {
      if (busy) return;
      const identifier = String(form.elements.identifier?.value || '').trim();
      const reason = String(form.elements.reason?.value || '').trim();
      adminsState.identifier = identifier;
      adminsState.reason = reason;
      if (!EMAIL_RE.test(identifier) && !UUID_RE.test(identifier)) {
        adminsState.formError = 'Nhập email hợp lệ hoặc mã UUID của tài khoản có sẵn.';
        drawAdmins();
        return;
      }
      if (reason.length < 3 || reason.length > 500) {
        adminsState.formError = 'Lý do cấp quyền phải từ 3 đến 500 ký tự.';
        drawAdmins();
        return;
      }

      const res = await ctx.ui.confirm({
        title: 'Cấp quyền quản trị viên?',
        body: `Tài khoản ${identifier} sẽ có toàn quyền quản trị hệ thống.`,
        confirmText: 'Cấp quyền',
      });
      if (!res.ok || !alive()) return;
      busy = true;
      adminsState.formError = '';
      try {
        await api.post('/admin/admins/grant', { identifier, reason }, { signal });
        if (!alive()) return;
        ctx.ui.toast('Đã cấp quyền quản trị viên');
        adminsState.formMode = null;
        adminsState.identifier = '';
        adminsState.reason = '';
        busy = false;
        await loadTab({ quiet: true });
      } catch (err) {
        busy = false;
        if (err?.name === 'AbortError' || !alive()) return;
        adminsState.formError = err?.message || 'Không cấp quyền được cho tài khoản này.';
        ctx.ui.toast(adminsState.formError, 'err');
        drawAdmins();
      }
    }

    async function updateAdminStatus(id, nextStatus) {
      if (busy) return;
      const item = listOf(adminsState.data).find((a) => String(a.id) === String(id));
      if (!item || isSelfAdmin(item)) return;
      const suspending = nextStatus === 'suspended';
      const labelName = item.full_name || item.email || 'quản trị viên này';
      const res = await ctx.ui.confirm({
        title: suspending ? `Tạm khóa ${labelName}?` : `Mở khóa ${labelName}?`,
        body: suspending
          ? 'Quản trị viên bị tạm khóa sẽ không thể sử dụng cổng quản trị cho tới khi được mở khóa lại.'
          : 'Quản trị viên này sẽ truy cập lại cổng quản trị bình thường.',
        danger: suspending,
        reasonRequired: suspending,
        reasonOptional: !suspending,
        reasonMax: 500,
        reasonLabel: suspending ? 'Lý do tạm khóa (bắt buộc, ít nhất 3 ký tự)' : 'Ghi chú (không bắt buộc)',
        confirmText: suspending ? 'Tạm khóa' : 'Mở khóa',
      });
      if (!res.ok || !alive()) return;
      busy = true;
      try {
        const payload = { status: nextStatus, ...(res.reason ? { reason: res.reason } : {}) };
        await api.post(`/admin/admins/${encodeURIComponent(id)}/status`, payload, { signal });
        if (!alive()) return;
        ctx.ui.toast(suspending ? 'Đã tạm khóa quản trị viên' : 'Đã mở khóa quản trị viên');
        busy = false;
        await loadTab({ quiet: true });
      } catch (err) {
        busy = false;
        if (err?.name === 'AbortError' || !alive()) return;
        ctx.ui.toast(err?.message || 'Không đổi được trạng thái quản trị viên', 'err');
      }
    }

    async function revokeAdmin(id) {
      if (busy) return;
      const item = listOf(adminsState.data).find((a) => String(a.id) === String(id));
      if (!item || isSelfAdmin(item)) return;
      const labelName = item.full_name || item.email || 'quản trị viên này';
      const res = await ctx.ui.confirm({
        title: `Thu hồi quyền quản trị của ${labelName}?`,
        body: 'Tài khoản sẽ chuyển về vai trò người mua và mất toàn bộ quyền truy cập cổng quản trị.',
        danger: true,
        reasonRequired: true,
        reasonMax: 500,
        reasonLabel: 'Lý do thu hồi quyền (bắt buộc, ít nhất 3 ký tự)',
        confirmText: 'Thu hồi quyền',
      });
      if (!res.ok || !alive()) return;
      busy = true;
      try {
        await api.post(`/admin/admins/${encodeURIComponent(id)}/revoke`, { reason: res.reason }, { signal });
        if (!alive()) return;
        ctx.ui.toast('Đã thu hồi quyền quản trị viên');
        busy = false;
        await loadTab({ quiet: true });
      } catch (err) {
        busy = false;
        if (err?.name === 'AbortError' || !alive()) return;
        ctx.ui.toast(err?.message || 'Không thu hồi được quyền quản trị', 'err');
      }
    }

    // ─────────────────────────── 2. Tab Thông báo ───────────────────────────
    function notifTargetLabel(n) {
      if (n.recipient_name) return n.recipient_name;
      if (n.recipient_id && !n.role_target) return `Cá nhân · ${shortId(n.recipient_id)}`;
      if (n.role_target) return own(VI.role, n.role_target) || 'Nhóm người dùng';
      return 'Toàn hệ thống';
    }

    function drawNotifications() {
      const st = notifState.stats || {};
      const byRole = st.by_role || {};
      const recentCount = Array.isArray(st.recent_broadcasts)
        ? st.recent_broadcasts.length
        : num(st.recent_broadcasts ?? notifState.total);

      const errHtml = notifState.formError
        ? html`<div role="alert" data-role="notif-form-error" style="margin-bottom:10px;padding:8px 12px;border:1px solid var(--err-bd);background:var(--err-bg);color:var(--err);border-radius:var(--rs)">${notifState.formError}</div>`
        : '';

      const targetExtra = notifState.target === 'user'
        ? html`<label style="display:grid;gap:4px;font-weight:600">Mã người nhận (UUID)
            <input type="text" name="user_id" value="${notifState.userId}" maxlength="64" placeholder="Ví dụ: d1000001-0000-4000-8000-000000000001" style="padding:7px 10px;border:1px solid var(--bd2);border-radius:var(--rs)">
          </label>`
        : html`<label style="display:grid;gap:4px;font-weight:600">Nhóm vai trò nhận
            <select name="role" style="padding:7px 10px;border:1px solid var(--bd2);border-radius:var(--rs)">
              <option value="customer"${raw(notifState.role === 'customer' ? ' selected' : '')}>Người mua</option>
              <option value="partner"${raw(notifState.role === 'partner' ? ' selected' : '')}>Cửa hàng</option>
              <option value="charity"${raw(notifState.role === 'charity' ? ' selected' : '')}>Tổ chức từ thiện</option>
            </select>
          </label>`;

      const formHtml = html`<form data-role="broadcast-form" novalidate style="display:grid;gap:10px;max-width:620px">
        ${raw(errHtml)}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
          <label style="display:grid;gap:4px;font-weight:600">Phạm vi gửi
            <select name="target" data-role="notif-target" style="padding:7px 10px;border:1px solid var(--bd2);border-radius:var(--rs)">
              <option value="role"${raw(notifState.target === 'role' ? ' selected' : '')}>Theo vai trò</option>
              <option value="user"${raw(notifState.target === 'user' ? ' selected' : '')}>Theo một người dùng</option>
            </select>
          </label>
          ${raw(targetExtra)}
        </div>
        <label style="display:grid;gap:4px;font-weight:600">Tiêu đề thông báo
          <input type="text" name="title" value="${notifState.title}" maxlength="140" placeholder="Nhập tiêu đề ngắn gọn, rõ ràng" style="padding:7px 10px;border:1px solid var(--bd2);border-radius:var(--rs)">
        </label>
        <label style="display:grid;gap:4px;font-weight:600">Nội dung chi tiết
          <textarea name="body" rows="3" maxlength="1000" placeholder="Nhập nội dung thông báo gửi tới người dùng" style="padding:7px 10px;border:1px solid var(--bd2);border-radius:var(--rs)">${notifState.body}</textarea>
        </label>
        <label style="display:flex;gap:8px;align-items:center;font-weight:600">
          <input type="checkbox" name="push"${raw(notifState.push ? ' checked' : '')}>
          Gửi kèm thông báo đẩy đến thiết bị đã đăng ký
        </label>
        <div>
          <button type="submit" class="bt bt-p" data-act="submit-broadcast"${raw(busy ? ' disabled' : '')}>Gửi thông báo</button>
        </div>
      </form>`;

      const trs = notifState.list.map((n) => html`<tr>
        <td>${stamp(n.created_at)}</td>
        <td><span class="b b-i">${notifTargetLabel(n)}</span></td>
        <td><b>${n.title || '—'}</b></td>
        <td style="white-space:normal;max-width:360px">${n.body || '—'}</td>
        <td>${num(n.push_sent) > 0 ? html`<span class="b b-ok">Đã đẩy (${num(n.push_sent)})</span>` : html`<span class="b b-m">Trong ứng dụng</span>`}</td>
      </tr>`).join('');

      body.innerHTML = html`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:16px">
          ${raw(kpi('total-subs', 'Thiết bị nhận thông báo đẩy', num(st.total_subscriptions), 'Tổng thiết bị đang đăng ký'))}
          ${raw(kpi('customer-subs', 'Thiết bị người mua', num(byRole.customer), 'Người mua bật thông báo'))}
          ${raw(kpi('volunteer-subs', 'Thiết bị tình nguyện viên', num(byRole.volunteer), 'Tình nguyện viên bật thông báo'))}
          ${raw(kpi('recent-broadcasts', 'Đợt gửi gần đây', recentCount, 'Thông báo do quản trị phát'))}
        </div>
        ${raw(panel('Gửi thông báo mới', formHtml))}
        <section class="P">
          <div class="P-h"><span class="P-t">Lịch sử thông báo đã gửi</span></div>
          <div class="W"><table class="tbl" data-role="notifications-table">
            <thead><tr><th>Thời gian</th><th>Đối tượng nhận</th><th>Tiêu đề</th><th>Nội dung</th><th>Kênh gửi</th></tr></thead>
            <tbody>${raw(trs || html`<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:20px">Chưa có thông báo quản trị nào.</td></tr>`)}</tbody>
          </table></div>
        </section>`;
    }

    async function submitBroadcast(form) {
      if (busy) return;
      const target = form.elements.target?.value === 'user' ? 'user' : 'role';
      const role = String(form.elements.role?.value || 'customer');
      const userId = String(form.elements.user_id?.value || '').trim();
      const title = String(form.elements.title?.value || '').trim();
      const content = String(form.elements.body?.value || '').trim();
      const push = Boolean(form.elements.push?.checked);

      notifState.target = target;
      notifState.role = role;
      notifState.userId = userId;
      notifState.title = title;
      notifState.body = content;
      notifState.push = push;

      if (target === 'user' && !UUID_RE.test(userId)) {
        notifState.formError = 'Mã người nhận phải đúng định dạng UUID.';
        drawNotifications();
        return;
      }
      if (title.length < 2 || title.length > 140) {
        notifState.formError = 'Tiêu đề thông báo phải từ 2 đến 140 ký tự.';
        drawNotifications();
        return;
      }
      if (content.length < 2 || content.length > 1000) {
        notifState.formError = 'Nội dung thông báo phải từ 2 đến 1000 ký tự.';
        drawNotifications();
        return;
      }

      const targetDesc = target === 'role'
        ? `nhóm ${own(VI.role, role) || 'người dùng'}`
        : `người dùng ${shortId(userId)}`;
      const res = await ctx.ui.confirm({
        title: 'Gửi thông báo hệ thống?',
        body: `Thông báo "${title}" sẽ được gửi ngay tới ${targetDesc} và không thể thu hồi sau khi phát.`,
        confirmText: 'Gửi ngay',
      });
      if (!res.ok || !alive()) return;

      const payload = target === 'role'
        ? { target: 'role', role, title, body: content, push }
        : { target: 'user', user_id: userId, title, body: content, push };

      busy = true;
      notifState.formError = '';
      try {
        await api.post('/admin/notifications', payload, { signal });
        if (!alive()) return;
        ctx.ui.toast('Đã gửi thông báo');
        notifState.title = '';
        notifState.body = '';
        notifState.userId = '';
        notifState.push = true;
        busy = false;
        await loadTab({ quiet: true });
      } catch (err) {
        busy = false;
        if (err?.name === 'AbortError' || !alive()) return;
        notifState.formError = err?.message || 'Không gửi được thông báo.';
        ctx.ui.toast(notifState.formError, 'err');
        drawNotifications();
      }
    }

    // ─────────────────────────── 3. Tab Hỗ trợ ───────────────────────────
    function formatAppPayload(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
      const parts = [];
      for (const [k, v] of Object.entries(payload)) {
        if (v == null || v === '') continue;
        const label = own(PAYLOAD_LABELS, k);
        if (label) parts.push(`${label}: ${String(v)}`);
      }
      return parts.join(' · ');
    }

    function drawSupport() {
      const isApps = supportState.sub === 'applications';
      const subTabs = html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button type="button" class="bt${raw(!isApps ? ' bt-p' : '')}" data-act="support-sub" data-sub="contacts">Tin nhắn liên hệ</button>
        <button type="button" class="bt${raw(isApps ? ' bt-p' : '')}" data-act="support-sub" data-sub="applications">Đơn đăng ký đối tác</button>
      </div>`;

      const statusOptions = isApps
        ? [['', 'Mọi trạng thái'], ['pending', 'Chờ xem xét'], ['in_review', 'Đang thẩm định'], ['approved', 'Đã chấp thuận'], ['rejected', 'Đã từ chối']]
        : [['', 'Mọi trạng thái'], ['open', 'Mới nhận'], ['in_review', 'Đang xử lý'], ['closed', 'Đã đóng']];

      const filterBar = html`<div style="display:flex;gap:8px;flex-wrap:wrap">
        <select data-role="support-status" aria-label="Lọc trạng thái hỗ trợ" style="padding:6px 10px;border:1px solid var(--bd2);border-radius:var(--rs)">
          ${raw(statusOptions.map(([val, label]) => html`<option value="${val}"${raw(supportState.status === val ? ' selected' : '')}>${label}</option>`).join(''))}
        </select>
        <input type="search" data-role="support-search" value="${supportState.q}" maxlength="80" placeholder="Tìm tên, email, nội dung…" aria-label="Tìm yêu cầu hỗ trợ" style="padding:6px 10px;border:1px solid var(--bd2);border-radius:var(--rs);min-width:210px">
      </div>`;

      let tableHtml = '';
      if (!isApps) {
        const trs = supportState.items.map((c) => {
          const done = c.status === 'closed' || c.status === 'resolved';
          return html`<tr data-contact-id="${c.id}">
            <td>${stamp(c.created_at)}</td>
            <td><b>${c.full_name || '—'}</b><br><small style="color:var(--t3)">${c.email || '—'}${c.phone ? ` · ${maskPhone(c.phone)}` : ''}</small></td>
            <td style="white-space:normal;max-width:340px"><b>${c.subject || '—'}</b><br><span>${c.message || '—'}</span></td>
            <td>${raw(badge('contactStatus', c.status || 'open'))}</td>
            <td style="white-space:normal;max-width:220px">${c.admin_note || '—'}</td>
            <td><div style="display:flex;gap:6px;flex-wrap:wrap">
              ${raw(!done ? html`<button type="button" class="bt bt-p" data-act="contact-update" data-id="${c.id}" data-status="closed"${raw(busy ? ' disabled' : '')}>Đánh dấu đã xử lý</button>` : '')}
              <button type="button" class="bt" data-act="contact-note" data-id="${c.id}" data-status="${c.status === 'open' || !c.status ? 'in_review' : c.status}"${raw(busy ? ' disabled' : '')}>Ghi chú</button>
            </div></td>
          </tr>`;
        }).join('');
        tableHtml = html`<table class="tbl" data-role="contacts-table">
          <thead><tr><th>Thời gian</th><th>Người gửi</th><th>Chủ đề & nội dung</th><th>Trạng thái</th><th>Ghi chú xử lý</th><th>Thao tác</th></tr></thead>
          <tbody>${raw(trs || html`<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:20px">Không có tin nhắn liên hệ phù hợp.</td></tr>`)}</tbody>
        </table>`;
      } else {
        const trs = supportState.items.map((a) => {
          const extra = formatAppPayload(a.payload);
          const finalized = a.status === 'approved' || a.status === 'rejected';
          return html`<tr data-app-id="${a.id}">
            <td>${stamp(a.created_at)}</td>
            <td>${raw(badge('applicationType', a.type || 'partner'))}</td>
            <td style="white-space:normal;max-width:260px"><b>${a.org_name || '—'}</b>${raw(extra ? html`<br><small style="color:var(--t3)">${extra}</small>` : '')}</td>
            <td><b>${a.contact_name || '—'}</b><br><small style="color:var(--t3)">${a.email || '—'}${a.phone ? ` · ${maskPhone(a.phone)}` : ''}</small></td>
            <td>${raw(badge('applicationStatus', a.status || 'pending'))}</td>
            <td style="white-space:normal;max-width:220px">${a.admin_note || '—'}</td>
            <td><div style="display:flex;gap:6px;flex-wrap:wrap">
              ${raw(!finalized ? html`<button type="button" class="bt bt-p" data-act="app-update" data-id="${a.id}" data-status="approved"${raw(busy ? ' disabled' : '')}>Chấp thuận</button>
                <button type="button" class="bt b-e" data-act="app-update" data-id="${a.id}" data-status="rejected"${raw(busy ? ' disabled' : '')}>Từ chối</button>` : '')}
              <button type="button" class="bt" data-act="app-note" data-id="${a.id}" data-status="${a.status === 'pending' || !a.status ? 'in_review' : a.status}"${raw(busy ? ' disabled' : '')}>Ghi chú</button>
            </div></td>
          </tr>`;
        }).join('');
        tableHtml = html`<table class="tbl" data-role="applications-table">
          <thead><tr><th>Thời gian</th><th>Loại hình</th><th>Đơn vị đăng ký</th><th>Người liên hệ</th><th>Trạng thái</th><th>Ghi chú thẩm định</th><th>Thao tác</th></tr></thead>
          <tbody>${raw(trs || html`<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:20px">Không có đơn đăng ký phù hợp.</td></tr>`)}</tbody>
        </table>`;
      }

      const hadFocus = document.activeElement?.dataset?.role === 'support-search';
      body.innerHTML = html`${raw(subTabs)}
        <section class="P">
          <div class="P-h"><span class="P-t">${isApps ? 'Đơn đăng ký đối tác & tổ chức' : 'Hộp thư liên hệ từ trang chủ'}</span>${raw(filterBar)}</div>
          <div class="W">${raw(tableHtml)}</div>
        </section>`;
      if (hadFocus) {
        const input = body.querySelector('[data-role="support-search"]');
        if (input) { input.focus(); input.setSelectionRange(supportState.q.length, supportState.q.length); }
      }
    }

    async function patchSupportItem(kind, id, nextStatus, { requireNote = false } = {}) {
      if (busy) return;
      const isApp = kind === 'app';
      const rejecting = nextStatus === 'rejected';
      const title = isApp
        ? (rejecting ? 'Từ chối đơn đăng ký này?' : requireNote ? 'Cập nhật ghi chú đơn đăng ký?' : 'Đánh dấu chấp thuận đơn đăng ký?')
        : (requireNote ? 'Lưu ghi chú xử lý liên hệ?' : 'Đánh dấu đã xử lý tin nhắn này?');
      const res = await ctx.ui.confirm({
        title,
        body: 'Trạng thái và ghi chú xử lý sẽ được lưu vào hệ thống và ghi nhật ký hoạt động.',
        danger: rejecting,
        reasonRequired: requireNote || rejecting,
        reasonOptional: !(requireNote || rejecting),
        reasonMax: 1000,
        reasonLabel: requireNote || rejecting ? 'Ghi chú xử lý (bắt buộc, ít nhất 3 ký tự)' : 'Ghi chú xử lý (không bắt buộc)',
        confirmText: rejecting ? 'Từ chối' : 'Lưu cập nhật',
      });
      if (!res.ok || !alive()) return;

      const payload = {};
      if (nextStatus) payload.status = nextStatus;
      if (res.reason) payload.admin_note = res.reason;

      busy = true;
      try {
        const endpoint = isApp
          ? `/admin/applications/${encodeURIComponent(id)}`
          : `/admin/contact-messages/${encodeURIComponent(id)}`;
        await api.patch(endpoint, payload, { signal });
        if (!alive()) return;
        ctx.ui.toast(isApp ? 'Đã cập nhật đơn đăng ký' : 'Đã cập nhật tin nhắn liên hệ');
        busy = false;
        await loadTab({ quiet: true });
      } catch (err) {
        busy = false;
        if (err?.name === 'AbortError' || !alive()) return;
        ctx.ui.toast(err?.message || 'Không lưu được cập nhật hỗ trợ', 'err');
      }
    }

    // ─────────────────────────── 4. Tab Hệ thống ───────────────────────────
    function renderSystemSettingsPanel(settingsData) {
      if (!settingsData) {
        return panel('Cấu hình hệ thống', html`<div data-role="system-settings">— <small style="color:var(--t3)">Không đọc được cấu hình hệ thống.</small></div>`);
      }
      const items = listOf(settingsData);
      if (!items.length) {
        return panel('Cấu hình hệ thống', html`<div data-role="system-settings" style="color:var(--t3)">Chưa có mục cấu hình nào được khai báo.</div>`);
      }
      const rows = items.map((s) => {
        const kind = s.type === 'boolean' || typeof s.value === 'boolean'
          ? 'boolean'
          : s.type === 'number' || typeof s.value === 'number'
            ? 'number'
            : 'string';
        let control = '';
        if (kind === 'boolean') {
          control = html`<label style="display:inline-flex;align-items:center;gap:6px;font-weight:600">
            <input type="checkbox" data-role="setting-input" data-key="${s.key}" data-kind="boolean"${raw(s.value ? ' checked' : '')}>
            <span>Bật</span>
          </label>`;
        } else if (kind === 'number') {
          control = html`<input type="number" data-role="setting-input" data-key="${s.key}" data-kind="number" value="${s.value ?? ''}" style="width:130px;padding:6px 8px;border:1px solid var(--bd2);border-radius:var(--rs)">`;
        } else {
          const textVal = typeof s.value === 'object' && s.value !== null ? JSON.stringify(s.value) : String(s.value ?? '');
          control = html`<input type="text" data-role="setting-input" data-key="${s.key}" data-kind="string" value="${textVal}" maxlength="500" style="min-width:200px;padding:6px 8px;border:1px solid var(--bd2);border-radius:var(--rs)">`;
        }
        return html`<div data-setting-row="${s.key}" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--bd)">
          <div style="flex:1;min-width:220px">
            <b>${s.label || 'Thiết lập hệ thống'}</b>
            ${raw(s.description ? html`<small style="display:block;color:var(--t3);margin-top:2px">${s.description}</small>` : '')}
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            ${raw(control)}
            <button type="button" class="bt bt-p" data-act="save-setting" data-key="${s.key}"${raw(busy ? ' disabled' : '')}>Lưu</button>
          </div>
        </div>`;
      }).join('');
      return panel('Cấu hình hệ thống', html`<div data-role="system-settings">${raw(rows)}</div>`);
    }

    function drawSystem() {
      const { version, health, overview, settings } = systemState;
      const dash = '—';
      const server = health
        ? html`<b style="color:var(--ok)">Hoạt động</b> · chạy liên tục ${uptimeText(health.uptime_seconds)} · môi trường ${own(ENV, health.environment) || dash} · kiểm tra lúc ${stamp(health.checked_at)}`
        : html`${dash} <small style="color:var(--t3)">Không đọc được trạng thái máy chủ.</small>`;
      const onOff = (v) => (v === true ? 'Bật' : v === false ? 'Tắt' : dash);
      const ai = overview
        ? [
          row('AI viết bài', html`${onOff(overview.integrations?.ai_enabled)}`),
          row('Tự động đăng bài', html`${onOff(overview.auto_enabled)}`),
          row('Cách đăng đang dùng', html`${own(MODE, overview.mode) || dash}`),
          row('Giới hạn bài', html`${overview.limits ? `${overview.limits.per_run ?? dash} bài mỗi lần, ${overview.limits.per_day ?? dash} bài mỗi ngày` : dash}`),
        ].join('')
        : html`${dash} <small style="color:var(--t3)">Không đọc được thiết lập AI Agent.</small>`;
      const links = html`<a href="#/marketing?tab=settings">Sửa thiết lập AI Agent ở màn Đăng bài tự động</a><br><a href="#/rules">Chính sách đơn hàng (màn Quy tắc đơn hàng)</a>`;

      body.innerHTML = html`${raw(panel('Cổng quản trị', row('Phiên bản cổng', html`${version || dash}`, 'version')))}
        ${raw(panel('Máy chủ', row('Trạng thái', server, 'health')))}
        ${raw(renderSystemSettingsPanel(settings))}
        ${raw(panel('AI Agent đăng bài (chỉ xem)', html`<div data-role="ai-agent">${raw(ai)}</div>`))}
        ${raw(panel('Liên kết liên quan', links))}`;
    }

    async function saveSystemSetting(key) {
      if (busy || !key) return;
      const items = listOf(systemState.settings);
      const item = items.find((s) => s.key === key);
      const input = [...body.querySelectorAll('[data-role="setting-input"]')].find((el) => el.dataset.key === key);
      if (!input) return;

      const kind = input.dataset.kind;
      let value;
      if (kind === 'boolean') {
        value = Boolean(input.checked);
      } else if (kind === 'number') {
        const parsed = Number(String(input.value).trim());
        if (String(input.value).trim() === '' || !Number.isFinite(parsed)) {
          ctx.ui.toast('Vui lòng nhập giá trị số hợp lệ.', 'err');
          return;
        }
        value = parsed;
      } else {
        value = String(input.value).trim();
      }

      const label = item?.label || 'cài đặt này';
      const res = await ctx.ui.confirm({
        title: `Lưu "${label}"?`,
        body: 'Thay đổi sẽ được áp dụng ngay trên hệ thống và ghi vào Nhật ký hoạt động.',
        confirmText: 'Lưu cài đặt',
      });
      if (!res.ok || !alive()) return;

      busy = true;
      try {
        await api.put(`/admin/settings/${encodeURIComponent(key)}`, { value }, { signal });
        if (!alive()) return;
        ctx.ui.toast('Đã lưu cài đặt hệ thống');
        busy = false;
        await loadTab({ quiet: true });
      } catch (err) {
        busy = false;
        if (err?.name === 'AbortError' || !alive()) return;
        ctx.ui.toast(err?.message || 'Không lưu được cài đặt hệ thống', 'err');
      }
    }

    // ─────────────────────────── 5. Tab Đánh giá ───────────────────────────
    function drawReviews() {
      const filters = [['all', 'Tất cả'], ['visible', 'Đang hiển thị'], ['hidden', 'Đã ẩn']].map(([val, label]) =>
        html`<button type="button" class="bt${raw(reviewsState.visibility === val ? ' bt-p' : '')}" data-act="review-filter" data-visibility="${val}">${label}</button>`
      ).join('');

      const trs = reviewsState.items.map((r) => {
        const hidden = Boolean(r.hidden_at);
        const stars = `${Math.max(0, Math.min(5, Math.round(num(r.rating))))} ★`;
        const hiddenNote = hidden && r.hidden_reason
          ? html`<br><small style="color:var(--err)">Lý do ẩn: ${r.hidden_reason}</small>`
          : '';
        const btn = hidden
          ? html`<button type="button" class="bt bt-p" data-act="review-vis" data-id="${r.id}" data-action="unhide"${raw(busy ? ' disabled' : '')}>Hiện lại</button>`
          : html`<button type="button" class="bt b-e" data-act="review-vis" data-id="${r.id}" data-action="hide"${raw(busy ? ' disabled' : '')}>Ẩn đánh giá</button>`;
        return html`<tr data-review-id="${r.id}">
          <td><b>${r.store_name || '—'}</b>${raw(r.order_number ? html`<br><small style="color:var(--t3)">Đơn #${r.order_number}</small>` : '')}</td>
          <td>${r.customer_name || '—'}</td>
          <td style="font-family:var(--m);font-weight:700">${stars}</td>
          <td style="white-space:normal;max-width:340px">${r.comment || '—'}${raw(hiddenNote)}</td>
          <td>${raw(badge('reviewVisibility', hidden ? 'hidden' : 'visible'))}</td>
          <td>${stamp(r.created_at)}</td>
          <td>${raw(btn)}</td>
        </tr>`;
      }).join('');

      const hadFocus = document.activeElement?.dataset?.role === 'review-search';
      body.innerHTML = html`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="display:flex;gap:6px;flex-wrap:wrap">${raw(filters)}</div>
          <input type="search" data-role="review-search" value="${reviewsState.q}" maxlength="80" placeholder="Tìm cửa hàng, khách, nội dung…" aria-label="Tìm đánh giá" style="padding:6px 10px;border:1px solid var(--bd2);border-radius:var(--rs);min-width:220px">
        </div>
        <section class="P">
          <div class="P-h"><span class="P-t">Đánh giá của người mua về cửa hàng</span></div>
          <div class="W"><table class="tbl" data-role="reviews-table">
            <thead><tr><th>Cửa hàng</th><th>Khách hàng</th><th>Số sao</th><th>Nội dung</th><th>Trạng thái hiển thị</th><th>Thời gian</th><th>Thao tác</th></tr></thead>
            <tbody>${raw(trs || html`<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:20px">Không có đánh giá phù hợp.</td></tr>`)}</tbody>
          </table></div>
        </section>`;
      if (hadFocus) {
        const input = body.querySelector('[data-role="review-search"]');
        if (input) { input.focus(); input.setSelectionRange(reviewsState.q.length, reviewsState.q.length); }
      }
    }

    async function toggleReviewVisibility(id, action) {
      if (busy) return;
      const hiding = action === 'hide';
      const res = await ctx.ui.confirm({
        title: hiding ? 'Ẩn đánh giá này?' : 'Hiện lại đánh giá này?',
        body: hiding
          ? 'Đánh giá sẽ không còn hiển thị công khai và điểm trung bình của cửa hàng sẽ được cập nhật lại.'
          : 'Đánh giá sẽ hiển thị công khai trở lại trên trang cửa hàng.',
        danger: hiding,
        reasonRequired: hiding,
        reasonOptional: !hiding,
        reasonMax: 500,
        reasonLabel: hiding ? 'Lý do ẩn đánh giá (bắt buộc, ít nhất 3 ký tự)' : 'Ghi chú (không bắt buộc)',
        confirmText: hiding ? 'Ẩn đánh giá' : 'Hiện lại',
      });
      if (!res.ok || !alive()) return;

      busy = true;
      try {
        const payload = { action: hiding ? 'hide' : 'unhide', ...(res.reason ? { reason: res.reason } : {}) };
        await api.post(`/admin/reviews/${encodeURIComponent(id)}/visibility`, payload, { signal });
        if (!alive()) return;
        ctx.ui.toast(hiding ? 'Đã ẩn đánh giá' : 'Đã hiện lại đánh giá');
        busy = false;
        await loadTab({ quiet: true });
      } catch (err) {
        busy = false;
        if (err?.name === 'AbortError' || !alive()) return;
        ctx.ui.toast(err?.message || 'Không cập nhật được trạng thái đánh giá', 'err');
      }
    }

    // ─────────────────────────── Tải dữ liệu theo tab ───────────────────────────
    async function loadTab({ quiet = false } = {}) {
      const mine = ++seq;
      drawTabs();
      if (!quiet) loading(body);

      try {
        if (tab === 'admins') {
          try {
            const data = await api.get('/admin/admins', { signal });
            if (!alive() || mine !== seq) return;
            adminsState.data = data;
            adminsState.err = null;
          } catch (err) {
            if (err?.name === 'AbortError' || !alive() || mine !== seq) return;
            adminsState.data = null;
            adminsState.err = err;
          }
          drawAdmins();
          return;
        }

        if (tab === 'notifications') {
          const [listRes, statsRes] = await Promise.all([
            api.get('/admin/notifications?page=1&limit=20', { signal }),
            safe('/admin/notifications/stats'),
          ]);
          if (!alive() || mine !== seq) return;
          notifState.list = listOf(listRes);
          notifState.total = num(listRes?.total ?? notifState.list.length);
          notifState.stats = statsRes || {};
          drawNotifications();
          return;
        }

        if (tab === 'support') {
          const sp = new URLSearchParams({ page: '1', limit: '20' });
          if (supportState.status) sp.set('status', supportState.status);
          if (supportState.q.trim()) sp.set('q', supportState.q.trim().slice(0, 80));
          const endpoint = supportState.sub === 'applications'
            ? `/admin/applications?${sp.toString()}`
            : `/admin/contact-messages?${sp.toString()}`;
          const res = await api.get(endpoint, { signal });
          if (!alive() || mine !== seq) return;
          supportState.items = listOf(res);
          supportState.total = num(res?.total ?? supportState.items.length);
          drawSupport();
          return;
        }

        if (tab === 'reviews') {
          const sp = new URLSearchParams({ page: '1', limit: '20', visibility: reviewsState.visibility });
          if (reviewsState.q.trim()) sp.set('q', reviewsState.q.trim().slice(0, 80));
          const res = await api.get(`/admin/reviews?${sp.toString()}`, { signal });
          if (!alive() || mine !== seq) return;
          reviewsState.items = listOf(res);
          reviewsState.total = num(res?.total ?? reviewsState.items.length);
          drawReviews();
          return;
        }

        // tab === 'system'
        let version = null;
        try { version = (await import('../core/config.js')).VERSION; } catch { version = null; }
        const [health, overview, settings] = await Promise.all([
          safe('/health'),
          safe('/marketing/admin/overview'),
          safe('/admin/settings'),
        ]);
        if (!alive() || mine !== seq) return;
        systemState = { version, health, overview, settings };
        drawSystem();
      } catch (err) {
        if (!alive() || mine !== seq || err?.name === 'AbortError') return;
        error(body, err, () => loadTab());
      }
    }

    // ─────────────────────────── Gắn sự kiện ủy quyền ───────────────────────────
    delegate(root, 'click', '[data-act="tab"]', (_e, el) => {
      if (el.dataset.tab !== tab) ctx.navigate('settings', { tab: el.dataset.tab });
    });

    // Tab Quản trị viên
    delegate(root, 'click', '[data-act="open-create-admin"]', () => {
      adminsState.formMode = 'create';
      adminsState.formError = '';
      drawAdmins();
    });
    delegate(root, 'click', '[data-act="open-grant-admin"]', () => {
      adminsState.formMode = 'grant';
      adminsState.formError = '';
      drawAdmins();
    });
    delegate(root, 'click', '[data-act="close-admin-form"]', () => {
      adminsState.formMode = null;
      adminsState.formError = '';
      drawAdmins();
    });
    delegate(root, 'submit', '[data-role="create-admin-form"]', (e, form) => {
      e.preventDefault();
      submitCreateAdmin(form);
    });
    delegate(root, 'submit', '[data-role="grant-admin-form"]', (e, form) => {
      e.preventDefault();
      submitGrantAdmin(form);
    });
    delegate(root, 'click', '[data-act="admin-status"]', (_e, el) => updateAdminStatus(el.dataset.id, el.dataset.status));
    delegate(root, 'click', '[data-act="admin-revoke"]', (_e, el) => revokeAdmin(el.dataset.id));

    // Tab Thông báo
    delegate(root, 'change', '[data-role="notif-target"]', (_e, el) => {
      const form = root.querySelector('[data-role="broadcast-form"]');
      if (form) {
        notifState.title = String(form.elements.title?.value || '');
        notifState.body = String(form.elements.body?.value || '');
        notifState.push = Boolean(form.elements.push?.checked);
      }
      notifState.target = el.value === 'user' ? 'user' : 'role';
      notifState.formError = '';
      drawNotifications();
    });
    delegate(root, 'submit', '[data-role="broadcast-form"]', (e, form) => {
      e.preventDefault();
      submitBroadcast(form);
    });

    // Tab Hỗ trợ
    delegate(root, 'click', '[data-act="support-sub"]', (_e, el) => {
      const next = el.dataset.sub === 'applications' ? 'applications' : 'contacts';
      if (next !== supportState.sub) {
        supportState.sub = next;
        supportState.status = '';
        supportState.q = '';
        loadTab();
      }
    });
    delegate(root, 'change', '[data-role="support-status"]', (_e, el) => {
      supportState.status = el.value;
      loadTab();
    });
    delegate(root, 'input', '[data-role="support-search"]', (_e, el) => {
      supportState.q = el.value;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { searchTimer = null; if (alive()) loadTab({ quiet: true }); }, 250);
    });
    delegate(root, 'click', '[data-act="contact-update"]', (_e, el) => patchSupportItem('contact', el.dataset.id, el.dataset.status, { requireNote: false }));
    delegate(root, 'click', '[data-act="contact-note"]', (_e, el) => patchSupportItem('contact', el.dataset.id, el.dataset.status, { requireNote: true }));
    delegate(root, 'click', '[data-act="app-update"]', (_e, el) => patchSupportItem('app', el.dataset.id, el.dataset.status, { requireNote: el.dataset.status === 'rejected' }));
    delegate(root, 'click', '[data-act="app-note"]', (_e, el) => patchSupportItem('app', el.dataset.id, el.dataset.status, { requireNote: true }));

    // Tab Hệ thống
    delegate(root, 'click', '[data-act="save-setting"]', (_e, el) => saveSystemSetting(el.dataset.key));

    // Tab Đánh giá
    delegate(root, 'click', '[data-act="review-filter"]', (_e, el) => {
      const next = el.dataset.visibility || 'all';
      if (next !== reviewsState.visibility) {
        reviewsState.visibility = next;
        loadTab();
      }
    });
    delegate(root, 'input', '[data-role="review-search"]', (_e, el) => {
      reviewsState.q = el.value;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { searchTimer = null; if (alive()) loadTab({ quiet: true }); }, 250);
    });
    delegate(root, 'click', '[data-act="review-vis"]', (_e, el) => toggleReviewVisibility(el.dataset.id, el.dataset.action));

    signal.addEventListener('abort', () => { if (searchTimer) clearTimeout(searchTimer); }, { once: true });

    await loadTab();
  },

  destroy() {},
};
