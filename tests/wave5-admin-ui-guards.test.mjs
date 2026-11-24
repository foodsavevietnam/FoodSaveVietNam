import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIONS, actionLabel } from '../public/admin/core/vi.js';
import { uptimeText } from '../public/admin/screens/settings.js';
import { createDemoApi } from '../public/admin/demo/index.js';

const WAVE5_AUDIT_ACTIONS = [
  'order.cancel',
  'order.no_show',
  'order.complete',
  'order.note',
  'donation.cancel',
  'product.hide',
  'product.unhide',
  'review.hide',
  'review.unhide',
  'admin.create',
  'admin.grant',
  'admin.suspend',
  'admin.unsuspend',
  'admin.revoke',
  'notification.send',
  'contact.update',
  'application.update',
  'settings.update',
];

test('vi.js định nghĩa đầy đủ nhãn tiếng Việt cho 18 hành động nhật ký Đợt 3 & Đợt 4', () => {
  for (const key of WAVE5_AUDIT_ACTIONS) {
    assert.ok(Object.prototype.hasOwnProperty.call(ACTIONS, key), `Thiếu nhãn nhật ký cho ${key}`);
    const label = actionLabel(key);
    assert.equal(typeof label, 'string');
    assert.ok(label.trim().length >= 4, `Nhãn quá ngắn cho ${key}`);
    assert.notEqual(label, key, `Nhãn chưa dịch cho ${key}`);
    assert.doesNotMatch(label, /[a-z]+\.[a-z_]+/i, `Nhãn còn mã thô cho ${key}: ${label}`);
  }
});

test('settings.js không còn placeholder "Sắp có" và giữ nguyên hàm uptimeText', () => {
  const src = readFileSync('public/admin/screens/settings.js', 'utf8');
  assert.doesNotMatch(src, /Sắp có/u, 'settings.js không được còn chuỗi "Sắp có"');
  assert.doesNotMatch(src, /cents/i, 'settings.js không được hiện chữ cents');

  assert.equal(uptimeText(-1), '—');
  assert.equal(uptimeText(NaN), '—');
  assert.equal(uptimeText(125), '2 phút');
  assert.equal(uptimeText(7384), '2 giờ 3 phút');
  assert.equal(uptimeText(93784), '1 ngày 2 giờ');
});

test('today.js tách riêng overview khỏi vòng poll định kỳ screen:today', () => {
  const src = readFileSync('public/admin/screens/today.js', 'utf8');
  assert.match(src, /\/admin\/dashboard\/overview\?days=/);
  const pollBlock = src.slice(src.indexOf('const refreshOthers'));
  assert.doesNotMatch(pollBlock, /overview/, 'overview không được nằm trong refreshOthers / screen:today poll');
});

test('admin-v2.js đã gỡ bộ hẹn giờ ngầm setTimeout(cmpLoad, 4000)', () => {
  const src = readFileSync('public/frontend/admin-v2.js', 'utf8');
  assert.doesNotMatch(src, /setTimeout\([^\n]*cmpLoad/u);
  assert.doesNotMatch(src, /cmpLoad\(\)[^;\n]*4000/u);
});

test('createDemoApi hỗ trợ trọn bộ endpoint Đợt 4 (admins, notifications, support, settings, reviews, overview)', async () => {
  const api = createDemoApi();

  // 1. Admins
  const beforeAdmins = await api.get('/admin/admins');
  assert.ok(Array.isArray(beforeAdmins.items) && beforeAdmins.items.length >= 2);
  assert.equal(typeof beforeAdmins.total, 'number');
  assert.equal(typeof beforeAdmins.active_count, 'number');

  const created = await api.post('/admin/admins', { email: 'new.admin@mio.vn', full_name: 'Admin Mới', password: 'mat-khau-manh-10' });
  assert.equal(created.email, 'new.admin@mio.vn');
  const granted = await api.post('/admin/admins/grant', { identifier: 'grant.user@mio.vn', reason: 'Bổ sung ca trực' });
  assert.equal(granted.role, 'admin');
  const suspended = await api.post(`/admin/admins/${created.id}/status`, { status: 'suspended', reason: 'Tạm nghỉ phép' });
  assert.equal(suspended.status, 'suspended');
  const revoked = await api.post(`/admin/admins/${granted.id}/revoke`, { reason: 'Chuyển bộ phận' });
  assert.equal(revoked.revoked, true);

  // 2. Notifications
  const stats = await api.get('/admin/notifications/stats');
  assert.equal(typeof stats.total_subscriptions, 'number');
  assert.equal(typeof stats.by_role?.customer, 'number');
  const sent = await api.post('/admin/notifications', { target: 'role', role: 'customer', title: 'Thông báo thử', body: 'Nội dung thử nghiệm', push: true });
  assert.equal(sent.title, 'Thông báo thử');
  const notifList = await api.get('/admin/notifications?page=1&limit=20');
  assert.equal(notifList.items[0].title, 'Thông báo thử');

  // 3. Support (contact-messages & applications)
  const contacts = await api.get('/admin/contact-messages?page=1&limit=20');
  assert.ok(contacts.items.length >= 1);
  const patchedContact = await api.patch(`/admin/contact-messages/${contacts.items[0].id}`, { status: 'closed', admin_note: 'Đã gọi hỗ trợ' });
  assert.equal(patchedContact.status, 'closed');
  assert.equal(patchedContact.admin_note, 'Đã gọi hỗ trợ');

  const apps = await api.get('/admin/applications?page=1&limit=20');
  assert.ok(apps.items.length >= 1);
  const patchedApp = await api.patch(`/admin/applications/${apps.items[0].id}`, { status: 'approved', admin_note: 'Đủ điều kiện hợp tác' });
  assert.equal(patchedApp.status, 'approved');

  // 4. System settings
  const settings = await api.get('/admin/settings');
  assert.ok(Array.isArray(settings.items) && settings.items.length >= 3);
  const updatedSetting = await api.put(`/admin/settings/${settings.items[0].key}`, { value: true });
  assert.equal(updatedSetting.value, true);

  // 5. Reviews
  const reviews = await api.get('/admin/reviews?visibility=visible');
  assert.ok(reviews.items.length >= 1);
  const hiddenReview = await api.post(`/admin/reviews/${reviews.items[0].id}/visibility`, { action: 'hide', reason: 'Ngôn từ không phù hợp' });
  assert.ok(hiddenReview.hidden_at);
  const unhiddenReview = await api.post(`/admin/reviews/${reviews.items[0].id}/visibility`, { action: 'unhide' });
  assert.equal(unhiddenReview.hidden_at, null);

  // 6. Dashboard overview (7 & 30 days)
  const ov7 = await api.get('/admin/dashboard/overview?days=7');
  assert.equal(ov7.days, 7);
  assert.equal(ov7.series.length, 7);
  assert.equal(typeof ov7.totals.gmv_cents, 'number');
  const ov30 = await api.get('/admin/dashboard/overview?days=30');
  assert.equal(ov30.days, 30);
  assert.equal(ov30.series.length, 30);
});
