import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';
import work, { buildOverview } from '../../public/admin/demo/fixtures/work.js';
import finance from '../../public/admin/demo/fixtures/finance.js';
import labels from '../../public/admin/demo/fixtures/labels.js';
import esg from '../../public/admin/demo/fixtures/esg.js';
import automation from '../../public/admin/demo/fixtures/automation.js';
import { createSettingsResolver } from '../../public/admin/demo/fixtures/settings.js';

// Màn "Cài đặt" (#/settings — 5 tab trực tiếp Đợt 4) & bảng xu hướng 7/30 ngày trên #/today.
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });

const ADMIN = {
  id: 'a1000001-0000-4000-8000-000000000001',
  role: 'admin',
  status: 'active',
  full_name: 'Admin Thử',
  email: 'admin@mio.vn',
};
const OVERVIEW_MKT = {
  central: { id: 'p1' },
  integrations: { ai_enabled: true, n8n_configured: true },
  mode: 'ai',
  auto_enabled: false,
  limits: { per_run: 5, per_day: 20 },
  kpi: {},
  days: [],
  queue: [],
  posts: [],
};
const XSS = '<img src=x onerror="window.__xss=1">';

function makeApi(state = {}) {
  const settingsResolve = createSettingsResolver();
  return async (route, { path, method, body }) => {
    const bare = path.split('?')[0];
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/dashboard/work') return route.fulfill(ok(work));
    if (bare === '/admin/finance/summary') return route.fulfill(ok(finance));
    if (bare === '/admin/labels') return route.fulfill(ok(labels));
    if (bare === '/admin/esg') return route.fulfill(ok(esg));
    if (bare === '/admin/automation') return route.fulfill(ok(automation));
    if (bare === '/marketing/admin/overview') return route.fulfill(ok(OVERVIEW_MKT));

    if (bare === '/admin/dashboard/overview') {
      if (state.overview === 'missing') return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Chưa bật overview'));
      const days = new URLSearchParams(path.split('?')[1] || '').get('days') || '7';
      return route.fulfill(ok(buildOverview(days)));
    }
    if (bare === '/admin/admins' && state.admins === 'error') {
      return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
    }
    if (bare === '/health' && state.health === 'error') {
      return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
    }
    if (state.xss) {
      if (bare === '/admin/admins' && method === 'GET') {
        return route.fulfill(ok({
          items: [{ id: ADMIN.id, full_name: XSS, email: 'admin@mio.vn', status: 'active', last_login_at: '2026-11-24T01:00:00Z' }],
          total: 1,
          active_count: 1,
        }));
      }
      if (bare === '/admin/reviews' && method === 'GET') {
        return route.fulfill(ok({
          items: [{ id: 'rv-xss', store_name: XSS, customer_name: XSS, order_number: 'FS1', rating: 4, comment: XSS, created_at: '2026-11-24T01:00:00Z', hidden_at: null, hidden_reason: null }],
          total: 1,
          page: 1,
          limit: 20,
        }));
      }
      if (bare === '/admin/contact-messages' && method === 'GET') {
        return route.fulfill(ok({
          items: [{ id: 'cm-xss', full_name: XSS, email: 'a@b.test', subject: XSS, message: XSS, status: 'open', admin_note: XSS, created_at: '2026-11-24T01:00:00Z' }],
          total: 1,
          page: 1,
          limit: 20,
        }));
      }
    }

    const hit = settingsResolve(method, bare, body, path);
    if (hit !== undefined) return route.fulfill(ok(hit));
    return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không có ' + bare));
  };
}

const setup = (page, state = {}, opt = {}) => stubAdmin(page, { api: makeApi(state), ...opt });

test('tab Quản trị viên: ẩn nút tự khóa bản thân; tạo mới, cấp quyền, tạm khóa (bắt buộc lý do ≥ 3) và thu hồi quyền', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/settings`);
  const root = page.locator('[data-screen="settings"]');
  await expect(root).toContainText('Admin Thử');
  await expect(root).toContainText('admin@mio.vn');
  await expect(root.locator('[data-role="admin-count"]')).toHaveText('3');
  await expect(root).not.toContainText('Sắp có');

  // Hàng của chính admin đang đăng nhập không có nút tạm khóa / thu hồi quyền
  const selfRow = root.locator(`[data-admin-id="${ADMIN.id}"]`);
  await expect(selfRow).toContainText('Đang đăng nhập');
  await expect(selfRow.locator('[data-act="admin-status"]')).toHaveCount(0);
  await expect(selfRow.locator('[data-act="admin-revoke"]')).toHaveCount(0);

  // Chặn mật khẩu < 10 ký tự phía client; hợp lệ → POST /admin/admins
  await root.locator('[data-act="open-create-admin"]').click();
  const createForm = root.locator('[data-role="create-admin-form"]');
  await createForm.locator('input[name="email"]').fill('lan.pham@mio.vn');
  await createForm.locator('input[name="full_name"]').fill('Phạm Ngọc Lan');
  await createForm.locator('input[name="password"]').fill('ngan123');
  await createForm.locator('[data-act="submit-create-admin"]').click();
  await expect(root.locator('[data-role="admin-form-error"]')).toContainText('10 ký tự');
  expect(calls.filter((c) => c.method === 'POST' && c.path === '/admin/admins')).toHaveLength(0);

  await createForm.locator('input[name="password"]').fill('MatKhauAnToan2026!');
  await createForm.locator('[data-act="submit-create-admin"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã tạo quản trị viên mới');
  await expect(root.locator('[data-role="admin-count"]')).toHaveText('4');

  // Cấp quyền từ tài khoản có sẵn → POST /admin/admins/grant { identifier, reason }
  await root.locator('[data-act="open-grant-admin"]').click();
  const grantForm = root.locator('[data-role="grant-admin-form"]');
  await grantForm.locator('input[name="identifier"]').fill('cosan@mio.vn');
  await grantForm.locator('textarea[name="reason"]').fill('Trực vận hành cuối tuần');
  await grantForm.locator('[data-act="submit-grant-admin"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã cấp quyền quản trị viên');
  await expect(root.locator('[data-role="admin-count"]')).toHaveText('5');

  // Tạm khóa admin khác: bắt buộc lý do ≥ 3 ký tự
  const otherRow = root.locator('[data-admin-id="a1000002-0000-4000-8000-000000000002"]');
  await otherRow.locator('[data-act="admin-status"]').click();
  await expect(page.locator('#modal [data-role="ok"]')).toBeDisabled();
  await page.fill('#modal [data-role="reason"]', 'ab');
  await expect(page.locator('#modal [data-role="ok"]')).toBeDisabled();
  await page.fill('#modal [data-role="reason"]', 'Kiểm tra định kỳ');
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã tạm khóa quản trị viên');

  // Thu hồi quyền admin khác: bắt buộc lý do ≥ 3 ký tự
  await otherRow.locator('[data-act="admin-revoke"]').click();
  await page.fill('#modal [data-role="reason"]', 'Chuyển sang bộ phận khác');
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã thu hồi quyền quản trị viên');
  await expect(root.locator('[data-role="admin-count"]')).toHaveText('4');

  const writes = calls.filter((c) => c.method === 'POST');
  expect(writes.map((w) => [w.path, w.body])).toEqual([
    ['/admin/admins', { email: 'lan.pham@mio.vn', full_name: 'Phạm Ngọc Lan', password: 'MatKhauAnToan2026!' }],
    ['/admin/admins/grant', { identifier: 'cosan@mio.vn', reason: 'Trực vận hành cuối tuần' }],
    ['/admin/admins/a1000002-0000-4000-8000-000000000002/status', { status: 'suspended', reason: 'Kiểm tra định kỳ' }],
    ['/admin/admins/a1000002-0000-4000-8000-000000000002/revoke', { reason: 'Chuyển sang bộ phận khác' }],
  ]);
  expect(errors).toEqual([]);
});

test('/admin/admins lỗi 500 → số quản trị viên hiện "—", thẻ đang đăng nhập giữ nguyên, có nút Thử lại', async ({ page }) => {
  const { errors } = await setup(page, { admins: 'error' }, { ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/settings`);
  await expect(page.locator('[data-role="admin-count"]')).toHaveText('—');
  await expect(page.locator('[data-screen="settings"]')).toContainText('admin@mio.vn');
  await expect(page.locator('[data-screen="settings"] [data-role="retry"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('tab Thông báo: KPI thiết bị đẩy + gửi thông báo theo vai trò và theo người dùng', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/settings?tab=notifications`);
  const root = page.locator('[data-screen="settings"]');
  await expect(root.locator('[data-kpi="total-subs"]')).toContainText('42');
  await expect(root.locator('[data-kpi="customer-subs"]')).toContainText('34');

  const form = root.locator('[data-role="broadcast-form"]');
  await form.locator('select[name="role"]').selectOption('partner');
  await form.locator('input[name="title"]').fill('Thông báo đối tác ca tối');
  await form.locator('textarea[name="body"]').fill('Vui lòng xác nhận đơn mới trong vòng 15 phút.');
  await form.locator('input[name="push"]').uncheck();
  await form.locator('[data-act="submit-broadcast"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã gửi thông báo');
  await expect(root.locator('[data-role="notifications-table"]')).toContainText('Thông báo đối tác ca tối');

  // Chuyển sang gửi cho 1 UUID người dùng
  await root.locator('[data-role="notif-target"]').selectOption('user');
  await root.locator('input[name="user_id"]').fill('d1000001-0000-4000-8000-000000000001');
  await root.locator('input[name="title"]').fill('Hỗ trợ đơn hàng riêng');
  await root.locator('textarea[name="body"]').fill('Bộ phận CSKH đã tiếp nhận yêu cầu của bạn.');
  await root.locator('[data-act="submit-broadcast"]').click();
  await page.click('#modal [data-role="ok"]');

  const posts = calls.filter((c) => c.method === 'POST' && c.path === '/admin/notifications');
  expect(posts.map((p) => p.body)).toEqual([
    { target: 'role', role: 'partner', title: 'Thông báo đối tác ca tối', body: 'Vui lòng xác nhận đơn mới trong vòng 15 phút.', push: false },
    { target: 'user', user_id: 'd1000001-0000-4000-8000-000000000001', title: 'Hỗ trợ đơn hàng riêng', body: 'Bộ phận CSKH đã tiếp nhận yêu cầu của bạn.', push: true },
  ]);
  expect(errors).toEqual([]);
});

test('tab Hỗ trợ: xử lý tin nhắn liên hệ và duyệt / từ chối đơn đăng ký đối tác', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/settings?tab=support`);
  const root = page.locator('[data-screen="settings"]');
  await expect(root.locator('[data-role="contacts-table"]')).toContainText('Nguyễn Hoàng Anh');

  const openContact = root.locator('[data-contact-id="cm100001-0000-4000-8000-000000000001"]');
  await openContact.locator('[data-act="contact-update"]').click();
  await page.fill('#modal [data-role="reason"]', 'Đã gửi hướng dẫn đăng ký qua email');
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã cập nhật tin nhắn liên hệ');
  await expect(openContact).toContainText('Đã đóng');

  // Chuyển sang sub-tab Đơn đăng ký đối tác
  await root.locator('[data-act="support-sub"][data-sub="applications"]').click();
  await expect(root.locator('[data-role="applications-table"]')).toContainText('Tiệm Bánh Mì Xanh');
  const appRow = root.locator('[data-app-id="ap100001-0000-4000-8000-000000000001"]');
  await appRow.locator('[data-act="app-update"][data-status="rejected"]').click();
  await expect(page.locator('#modal [data-role="ok"]')).toBeDisabled();
  await page.fill('#modal [data-role="reason"]', 'Chưa cung cấp giấy chứng nhận VSATTP');
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã cập nhật đơn đăng ký');
  await expect(appRow).toContainText('Đã từ chối');

  const patches = calls.filter((c) => c.method === 'PATCH');
  expect(patches.map((p) => [p.path, p.body])).toEqual([
    ['/admin/contact-messages/cm100001-0000-4000-8000-000000000001', { status: 'closed', admin_note: 'Đã gửi hướng dẫn đăng ký qua email' }],
    ['/admin/applications/ap100001-0000-4000-8000-000000000001', { status: 'rejected', admin_note: 'Chưa cung cấp giấy chứng nhận VSATTP' }],
  ]);
  expect(errors).toEqual([]);
});

test('tab Hệ thống: phiên bản, máy chủ, AI Agent, lưu cấu hình PUT /admin/settings/:key, không mã thô', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/settings?tab=system`);
  const root = page.locator('[data-screen="settings"]');
  await expect(root.locator('[data-role="version"]')).toHaveText(/^\d{8}[a-z]?$/);
  await expect(root.locator('[data-role="health"]')).toContainText('Hoạt động');
  await expect(root.locator('[data-role="ai-agent"]')).toContainText('Bật');
  await expect(root.locator('a[href="#/marketing?tab=settings"]')).toBeVisible();
  await expect(root.locator('a[href="#/rules"]')).toBeVisible();

  // Bật công tắc chế độ bảo trì & lưu phí nền tảng mặc định
  const bannerRow = root.locator('[data-setting-row="maintenance_mode"]');
  await bannerRow.locator('input[type="checkbox"]').check();
  await bannerRow.locator('[data-act="save-setting"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã lưu cài đặt hệ thống');

  const rateRow = root.locator('[data-setting-row="default_commission_rate"]');
  await rateRow.locator('input[type="number"]').fill('15');
  await rateRow.locator('[data-act="save-setting"]').click();
  await page.click('#modal [data-role="ok"]');

  const puts = calls.filter((c) => c.method === 'PUT');
  expect(puts.map((p) => [p.path, p.body])).toEqual([
    ['/admin/settings/maintenance_mode', { value: true }],
    ['/admin/settings/default_commission_rate', { value: 15 }],
  ]);

  const text = await root.innerText();
  expect(text).not.toMatch(/\b(production|template|direct|n8n_configured|maintenance_mode|default_commission_rate)\b/);
  expect(errors).toEqual([]);
});

test('/health lỗi 500 → hiện "—", không văng lỗi', async ({ page }) => {
  const { errors } = await setup(page, { health: 'error' }, { ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/settings?tab=system`);
  await expect(page.locator('[data-role="health"]')).toContainText('—');
  await expect(page.locator('[data-role="version"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('tab Đánh giá: lọc hiển thị/đã ẩn, ẩn đánh giá bắt buộc lý do ≥ 3 ký tự và hiện lại', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/settings?tab=reviews`);
  const root = page.locator('[data-screen="settings"]');
  await expect(root.locator('[data-role="reviews-table"] tbody tr')).toHaveCount(2);

  const visibleRow = root.locator('[data-review-id="rv100001-0000-4000-8000-000000000001"]');
  await visibleRow.locator('[data-act="review-vis"][data-action="hide"]').click();
  await expect(page.locator('#modal [data-role="ok"]')).toBeDisabled();
  await page.fill('#modal [data-role="reason"]', 'Spam không hợp lệ');
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã ẩn đánh giá');

  const hiddenRow = root.locator('[data-review-id="rv100002-0000-4000-8000-000000000002"]');
  await hiddenRow.locator('[data-act="review-vis"][data-action="unhide"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã hiện lại đánh giá');

  const posts = calls.filter((c) => c.method === 'POST' && c.path.includes('/admin/reviews/'));
  expect(posts.map((p) => [p.path, p.body])).toEqual([
    ['/admin/reviews/rv100001-0000-4000-8000-000000000001/visibility', { action: 'hide', reason: 'Spam không hợp lệ' }],
    ['/admin/reviews/rv100002-0000-4000-8000-000000000002/visibility', { action: 'unhide' }],
  ]);
  expect(errors).toEqual([]);
});

test('escape chống XSS trên dữ liệu động của quản trị viên, liên hệ và đánh giá', async ({ page }) => {
  const { errors } = await setup(page, { xss: true });
  for (const hash of ['#/settings?tab=admins', '#/settings?tab=support', '#/settings?tab=reviews']) {
    await page.goto(`${PAGE}${hash}`);
    await expect(page.locator('#screen')).toContainText('<img src=x');
    await expect(page.locator('#screen img')).toHaveCount(0);
  }
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('màn Hôm nay: xu hướng 7 ngày / 30 ngày chỉ tải khi bấm nút và tự ẩn êm khi API 404', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/today`);
  await expect(page.locator('[data-block="finance"]')).toContainText('480.000đ');
  expect(calls.filter((c) => c.path.startsWith('/admin/dashboard/overview'))).toHaveLength(0);

  await page.click('[data-role="overview-open"]');
  await expect(page.locator('[data-role="overview-table"] tbody tr')).toHaveCount(7);
  await expect(page.locator('[data-overview-kpi="gmv"]')).toContainText('đ');
  const text = await page.locator('[data-role="overview"]').innerText();
  expect(text).not.toMatch(/cents|no_show/i);

  await page.click('[data-role="overview-actions"] [data-days="30"]');
  await expect(page.locator('[data-role="overview-table"] tbody tr')).toHaveCount(30);
  expect(calls.filter((c) => c.path.startsWith('/admin/dashboard/overview')).map((c) => c.path)).toEqual([
    '/admin/dashboard/overview?days=7',
    '/admin/dashboard/overview?days=30',
  ]);
  expect(errors).toEqual([]);
});

test('màn Hôm nay: /admin/dashboard/overview trả 404 → khối xu hướng tự ẩn êm, các khối khác nguyên vẹn', async ({ page }) => {
  const { errors } = await setup(page, { overview: 'missing' }, { ignoreStatuses: [404] });
  await page.goto(`${PAGE}#/today`);
  await page.click('[data-role="overview-open"]');
  await expect(page.locator('[data-role="overview"]')).toBeHidden();
  await expect(page.locator('[data-block="finance"]')).toContainText('480.000đ');
  expect(errors).toEqual([]);
});

test('?demo=1 mở trọn bộ 5 tab Cài đặt và bảng xu hướng Hôm nay mà không gọi /api/v1', async ({ page }) => {
  const { calls, errors } = await setup(page, {}, { fakeSb: { noSession: true } });
  await page.goto(`${PAGE}?demo=1#/settings`);
  await expect(page.locator('[data-role="admin-count"]')).toHaveText('3');
  await page.goto(`${PAGE}?demo=1#/settings?tab=notifications`);
  await expect(page.locator('[data-kpi="total-subs"]')).toContainText('42');
  await page.goto(`${PAGE}?demo=1#/settings?tab=support`);
  await expect(page.locator('[data-role="contacts-table"]')).toBeVisible();
  await page.goto(`${PAGE}?demo=1#/settings?tab=system`);
  await expect(page.locator('[data-role="health"]')).toContainText('Hoạt động');
  await expect(page.locator('[data-role="system-settings"]')).toBeVisible();
  await page.goto(`${PAGE}?demo=1#/settings?tab=reviews`);
  await expect(page.locator('[data-role="reviews-table"]')).toBeVisible();
  await page.goto(`${PAGE}?demo=1#/today`);
  await page.click('[data-role="overview-open"]');
  await expect(page.locator('[data-role="overview-table"] tbody tr')).toHaveCount(7);
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
