// Dữ liệu xem thử (?demo=1) cho màn "Cài đặt" (5 tab Đợt 4) và bảng xu hướng của màn "Hôm nay".
import { buildOverview } from './work.js';

const HEALTH = {
  service: 'foodsave-backend',
  environment: 'production',
  uptime_seconds: 93784,
  checked_at: '2026-11-23T08:00:00.000Z',
};

const SEED_ADMINS = [
  { id: 'a1000001-0000-4000-8000-000000000001', full_name: 'Quản trị viên (xem thử)', email: 'admin@mio.vn', phone: '0901112233', role: 'admin', status: 'active', last_sign_in_at: '2026-11-24T02:10:00.000Z', last_login_at: '2026-11-24T02:10:00.000Z', created_at: '2026-08-01T08:00:00.000Z', suspended_at: null, suspended_reason: null },
  { id: 'a1000002-0000-4000-8000-000000000002', full_name: 'Trần Minh Quân', email: 'quan.tran@mio.vn', phone: '0902223344', role: 'admin', status: 'active', last_sign_in_at: '2026-11-23T14:30:00.000Z', last_login_at: '2026-11-23T14:30:00.000Z', created_at: '2026-09-12T08:00:00.000Z', suspended_at: null, suspended_reason: null },
  { id: 'a1000003-0000-4000-8000-000000000003', full_name: 'Lê Thu Hà', email: 'ha.le@mio.vn', phone: '0903334455', role: 'admin', status: 'suspended', last_sign_in_at: '2026-11-10T09:00:00.000Z', last_login_at: '2026-11-10T09:00:00.000Z', created_at: '2026-10-05T08:00:00.000Z', suspended_at: '2026-11-15T10:00:00.000Z', suspended_reason: 'Nghỉ phép dài hạn' },
];

const SEED_NOTIFICATIONS = [
  { id: 'n1000001-0000-4000-8000-000000000001', type: 'admin_broadcast', role_target: 'customer', recipient_id: null, title: 'Khung giờ vàng giải cứu thực phẩm tối nay', body: 'Từ 19:00 hôm nay có nhiều phần ăn giảm đến 80% tại các cửa hàng gần bạn.', push_sent: 18, created_at: '2026-11-23T11:30:00.000Z' },
  { id: 'n1000002-0000-4000-8000-000000000002', type: 'admin_broadcast', role_target: 'partner', recipient_id: null, title: 'Nhắc cập nhật tồn kho cuối ngày', body: 'Quý đối tác vui lòng kiểm tra số lượng món cận hạn trước 18:00 để hệ thống gắn nhãn tự động.', push_sent: 0, created_at: '2026-11-22T09:15:00.000Z' },
];

const SEED_STATS = {
  total_subscriptions: 42,
  by_role: { customer: 34, volunteer: 8, partner: 0, charity: 0, admin: 0 },
  recent_broadcasts: 2,
};

const SEED_CONTACTS = [
  { id: 'cm100001-0000-4000-8000-000000000001', full_name: 'Nguyễn Hoàng Anh', email: 'hoanganh@example.test', phone: '0912345678', subject: 'Hỏi về cách đăng ký quán ăn nhỏ', message: 'Quán cơm gia đình của tôi muốn tham gia bán phần ăn cuối ngày trên MIO.', status: 'open', admin_note: null, handled_by: null, handled_at: null, created_at: '2026-11-24T01:20:00.000Z' },
  { id: 'cm100002-0000-4000-8000-000000000002', full_name: 'Phạm Thanh Tâm', email: 'thanhtam@example.test', phone: '0987654321', subject: 'Góp ý giao diện bản đồ cửa hàng', message: 'Mong ứng dụng bổ sung bộ lọc khoảng cách dưới 2 km.', status: 'closed', admin_note: 'Đã ghi nhận vào danh sách cải tiến tháng 12.', handled_by: 'a1000001-0000-4000-8000-000000000001', handled_at: '2026-11-23T15:00:00.000Z', created_at: '2026-11-23T10:05:00.000Z' },
];

const SEED_APPLICATIONS = [
  { id: 'ap100001-0000-4000-8000-000000000001', type: 'partner', org_name: 'Tiệm Bánh Mì Xanh', contact_name: 'Đỗ Văn Khoa', email: 'khoa@banhmixanh.test', phone: '0909123456', payload: { district: 'Quận 3', city: 'TP.HCM', daily_surplus: '25 phần/ngày' }, status: 'pending', admin_note: null, handled_by: null, handled_at: null, created_at: '2026-11-24T02:00:00.000Z' },
  { id: 'ap100002-0000-4000-8000-000000000002', type: 'charity', org_name: 'Bếp Yêu Thương Quận 7', contact_name: 'Võ Thị Mai', email: 'mai@bepyeuthuong.test', phone: '0938111222', payload: { district: 'Quận 7', beneficiaries: 120 }, status: 'in_review', admin_note: 'Đang đối chiếu giấy giới thiệu địa phương.', handled_by: 'a1000002-0000-4000-8000-000000000002', handled_at: '2026-11-23T16:40:00.000Z', created_at: '2026-11-22T13:10:00.000Z' },
];

// Khớp 100% SETTINGS_REGISTRY trong adminSettingsService.ts
const SEED_SETTINGS = [
  { key: 'maintenance_mode', label: 'Chế độ bảo trì', description: 'Bật để hiển thị thông báo bảo trì hệ thống cho người dùng.', type: 'boolean', value: false, default_value: false },
  { key: 'support_hotline', label: 'Tổng đài hỗ trợ', description: 'Số điện thoại tổng đài hỗ trợ hiển thị trên cổng người dùng (tối đa 40 ký tự).', type: 'string', value: '1900 6868', default_value: '1900 6868' },
  { key: 'support_email', label: 'Email hỗ trợ', description: 'Địa chỉ email tiếp nhận yêu cầu hỗ trợ chính thức của nền tảng.', type: 'string', value: 'support@makeitorganized.vn', default_value: 'support@makeitorganized.vn' },
  { key: 'default_commission_rate', label: 'Phí nền tảng mặc định (%)', description: 'Tỷ lệ phí nền tảng mặc định áp dụng cho cửa hàng mới (0–30%).', type: 'number', value: 12, default_value: 12 },
  { key: 'auto_approve_photo_minutes', label: 'Tự duyệt ảnh minh chứng (phút)', description: 'Thời gian chờ trước khi tự động duyệt ảnh minh chứng bàn giao từ thiện (5–1440 phút).', type: 'number', value: 60, default_value: 60 },
  { key: 'max_orders_per_customer_day', label: 'Giới hạn đơn/khách mỗi ngày', description: 'Số lượng đơn hàng tối đa một người mua được đặt trong ngày (1–50).', type: 'number', value: 10, default_value: 10 },
];

const SEED_REVIEWS = [
  { id: 'rv100001-0000-4000-8000-000000000001', store_id: 's-2001', store_name: 'Tiệm bánh Hoa Sữa', customer_id: 'd1000003-0000-4000-8000-000000000003', customer_name: 'Người mua mẫu C', order_id: 'ord-demo-1', order_number: 'FS-DEMO01', rating: 5, comment: 'Bánh còn thơm ngon, đóng gói sạch sẽ và nhân viên nhiệt tình.', created_at: '2026-11-24T01:45:00.000Z', hidden_at: null, hidden_reason: null },
  { id: 'rv100002-0000-4000-8000-000000000002', store_id: 's-2002', store_name: 'Siêu thị Xanh', customer_id: 'd1000001-0000-4000-8000-000000000001', customer_name: 'Người mua mẫu A', order_id: 'ord-demo-2', order_number: 'FS-DEMO02', rating: 1, comment: 'Nội dung quảng cáo rác không liên quan tới đơn hàng.', created_at: '2026-11-23T07:20:00.000Z', hidden_at: '2026-11-23T08:00:00.000Z', hidden_reason: 'Bình luận spam quảng cáo' },
];

function paramsOf(rawPath) {
  const qs = String(rawPath || '').split('?')[1] || '';
  return new URLSearchParams(qs);
}

function paginateList(items, sp) {
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 20));
  const start = (page - 1) * limit;
  return { items: items.slice(start, start + limit), total: items.length, page, limit };
}

export function createSettingsResolver() {
  let admins = structuredClone(SEED_ADMINS);
  const notifications = structuredClone(SEED_NOTIFICATIONS);
  const stats = structuredClone(SEED_STATS);
  const contacts = structuredClone(SEED_CONTACTS);
  const applications = structuredClone(SEED_APPLICATIONS);
  const settings = structuredClone(SEED_SETTINGS);
  const reviews = structuredClone(SEED_REVIEWS);
  let seq = 10;

  return function resolveSettings(method, path, body, rawPath) {
    if (method === 'GET' && path === '/health') return HEALTH;

    if (method === 'GET' && path === '/admin/dashboard/overview') {
      const sp = paramsOf(rawPath);
      return buildOverview(sp.get('days') || 7);
    }

    // 1. Quản trị viên
    if (method === 'GET' && path === '/admin/admins') {
      return {
        items: admins,
        total: admins.length,
        active_count: admins.filter((a) => a.status === 'active').length,
      };
    }
    if (method === 'POST' && path === '/admin/admins') {
      seq += 1;
      const created = {
        id: `a10000${seq}-0000-4000-8000-0000000000${seq}`,
        full_name: String(body?.full_name || '').trim() || 'Quản trị viên mới',
        email: String(body?.email || '').trim().toLowerCase(),
        phone: null,
        role: 'admin',
        status: 'active',
        last_sign_in_at: null,
        last_login_at: null,
        created_at: new Date().toISOString(),
        suspended_at: null,
        suspended_reason: null,
      };
      admins.unshift(created);
      return created;
    }
    if (method === 'POST' && path === '/admin/admins/grant') {
      seq += 1;
      const ident = String(body?.identifier || '').trim();
      const isEmail = ident.includes('@');
      const granted = {
        id: isEmail ? `a10000${seq}-0000-4000-8000-0000000000${seq}` : ident,
        full_name: isEmail ? ident.split('@')[0] : 'Tài khoản được cấp quyền',
        email: isEmail ? ident.toLowerCase() : 'granted.admin@mio.vn',
        phone: null,
        role: 'admin',
        status: 'active',
        last_sign_in_at: null,
        last_login_at: null,
        created_at: new Date().toISOString(),
        suspended_at: null,
        suspended_reason: null,
      };
      admins.unshift(granted);
      return granted;
    }
    const adminStatusMatch = method === 'POST' ? path.match(/^\/admin\/admins\/([^/]+)\/status$/) : null;
    if (adminStatusMatch) {
      const id = decodeURIComponent(adminStatusMatch[1]);
      const item = admins.find((a) => a.id === id);
      const next = body?.status === 'suspended' ? 'suspended' : 'active';
      if (item) {
        item.status = next;
        item.suspended_at = next === 'suspended' ? new Date().toISOString() : null;
        item.suspended_reason = next === 'suspended' ? (body?.reason || null) : null;
        return item;
      }
      return { id, status: next };
    }
    const adminRevokeMatch = method === 'POST' ? path.match(/^\/admin\/admins\/([^/]+)\/revoke$/) : null;
    if (adminRevokeMatch) {
      const id = decodeURIComponent(adminRevokeMatch[1]);
      admins = admins.filter((a) => a.id !== id);
      return { id, role: 'customer', revoked: true };
    }

    // 2. Thông báo
    if (method === 'GET' && path === '/admin/notifications/stats') {
      return stats;
    }
    if (method === 'GET' && path === '/admin/notifications') {
      return paginateList(notifications, paramsOf(rawPath));
    }
    if (method === 'POST' && path === '/admin/notifications') {
      seq += 1;
      const item = {
        id: `n10000${seq}-0000-4000-8000-0000000000${seq}`,
        type: 'admin_broadcast',
        role_target: body?.target === 'role' ? (body.role || 'customer') : null,
        recipient_id: body?.target === 'user' ? (body.user_id || null) : null,
        title: String(body?.title || '').trim(),
        body: String(body?.body || '').trim(),
        push_sent: body?.push ? 5 : 0,
        created_at: new Date().toISOString(),
      };
      notifications.unshift(item);
      stats.recent_broadcasts = Number(stats.recent_broadcasts || 0) + 1;
      return { ...item, sent_count: 1, push_attempted: Boolean(body?.push) };
    }

    // 3. Hỗ trợ (tin nhắn liên hệ & đơn đăng ký)
    if (method === 'GET' && path === '/admin/contact-messages') {
      const sp = paramsOf(rawPath);
      const status = sp.get('status') || '';
      const q = (sp.get('q') || '').trim().toLowerCase();
      const filtered = contacts.filter((c) => {
        if (status && c.status !== status) return false;
        if (q && ![c.full_name, c.email, c.phone, c.subject, c.message].some((v) => String(v || '').toLowerCase().includes(q))) return false;
        return true;
      });
      return paginateList(filtered, sp);
    }
    const contactPatch = method === 'PATCH' ? path.match(/^\/admin\/contact-messages\/([^/]+)$/) : null;
    if (contactPatch) {
      const id = decodeURIComponent(contactPatch[1]);
      const item = contacts.find((c) => c.id === id);
      if (item) {
        if (body?.status) item.status = body.status;
        if (body?.admin_note !== undefined) item.admin_note = body.admin_note;
        item.handled_at = new Date().toISOString();
        return item;
      }
      return { id, ...(body || {}) };
    }

    if (method === 'GET' && path === '/admin/applications') {
      const sp = paramsOf(rawPath);
      const status = sp.get('status') || '';
      const type = sp.get('type') || '';
      const q = (sp.get('q') || '').trim().toLowerCase();
      const filtered = applications.filter((a) => {
        if (status && a.status !== status) return false;
        if (type && a.type !== type) return false;
        if (q && ![a.org_name, a.contact_name, a.email, a.phone].some((v) => String(v || '').toLowerCase().includes(q))) return false;
        return true;
      });
      return paginateList(filtered, sp);
    }
    const appPatch = method === 'PATCH' ? path.match(/^\/admin\/applications\/([^/]+)$/) : null;
    if (appPatch) {
      const id = decodeURIComponent(appPatch[1]);
      const item = applications.find((a) => a.id === id);
      if (item) {
        if (body?.status) item.status = body.status;
        if (body?.admin_note !== undefined) item.admin_note = body.admin_note;
        item.handled_at = new Date().toISOString();
        return item;
      }
      return { id, ...(body || {}) };
    }

    // 4. Cấu hình hệ thống
    if (method === 'GET' && path === '/admin/settings') {
      return { items: settings };
    }
    const settingPut = method === 'PUT' ? path.match(/^\/admin\/settings\/([^/]+)$/) : null;
    if (settingPut) {
      const key = decodeURIComponent(settingPut[1]);
      const item = settings.find((s) => s.key === key);
      if (item) {
        item.value = body?.value;
        return item;
      }
      return { key, value: body?.value };
    }

    // 5. Đánh giá
    if (method === 'GET' && path === '/admin/reviews') {
      const sp = paramsOf(rawPath);
      const vis = sp.get('visibility') || 'all';
      const rating = Number(sp.get('rating')) || 0;
      const storeId = sp.get('store_id') || '';
      const q = (sp.get('q') || '').trim().toLowerCase();
      const filtered = reviews.filter((r) => {
        if (vis === 'visible' && r.hidden_at) return false;
        if (vis === 'hidden' && !r.hidden_at) return false;
        if (rating && Number(r.rating) !== rating) return false;
        if (storeId && r.store_id !== storeId) return false;
        if (q && ![r.store_name, r.customer_name, r.comment, r.order_number].some((v) => String(v || '').toLowerCase().includes(q))) return false;
        return true;
      });
      return paginateList(filtered, sp);
    }
    const reviewVis = method === 'POST' ? path.match(/^\/admin\/reviews\/([^/]+)\/visibility$/) : null;
    if (reviewVis) {
      const id = decodeURIComponent(reviewVis[1]);
      const item = reviews.find((r) => r.id === id);
      const hiding = body?.action === 'hide';
      if (item) {
        item.hidden_at = hiding ? new Date().toISOString() : null;
        item.hidden_reason = hiding ? (body?.reason || null) : null;
        return item;
      }
      return { id, hidden_at: hiding ? new Date().toISOString() : null, hidden_reason: hiding ? (body?.reason || null) : null };
    }

    return undefined;
  };
}

const defaultResolver = createSettingsResolver();

export const routes = {
  'GET /health': HEALTH,
};

export function resolve(method, path, body, rawPath) {
  return defaultResolver(method, path, body, rawPath);
}
