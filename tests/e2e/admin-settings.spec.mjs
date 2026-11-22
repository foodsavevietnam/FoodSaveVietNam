import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';

// Màn "Cài đặt" (#/settings): chỉ đọc. Auth Supabase và API đều được stub.
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };
const OVERVIEW = { central: { id: 'p1' }, integrations: { ai_enabled: true, n8n_configured: true }, mode: 'ai', auto_enabled: false, limits: { per_run: 5, per_day: 20 }, kpi: {}, days: [], queue: [], posts: [] };

function makeApi(state = {}) {
  return async (route, { path }) => {
    const bare = path.split('?')[0];
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/dashboard/work') return route.fulfill(ok({}));
    if (bare === '/admin/users') {
      if (state.users === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      return route.fulfill(ok({ counts: { customers: 10, partners: 2, charities: 1, volunteers: 3, admins: 3, stores: 2 }, buyers: [] }));
    }
    if (bare === '/health') {
      if (state.health === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      return route.fulfill(ok({ service: 'foodsave-backend', environment: 'production', uptime_seconds: 7384, checked_at: '2026-11-23T08:00:00.000Z' }));
    }
    if (bare === '/marketing/admin/overview') return route.fulfill(ok(OVERVIEW));
    return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không có ' + bare));
  };
}
const setup = (page, state = {}, opt = {}) => stubAdmin(page, { api: makeApi(state), ...opt });

test('tab quản trị viên: thẻ tài khoản, số quản trị viên, hướng dẫn, nút Sắp có disabled', async ({ page }) => {
  const { errors, calls } = await setup(page);
  await page.goto(`${PAGE}#/settings`);
  const root = page.locator('[data-screen="settings"]');
  await expect(root).toContainText('Admin Thử');
  await expect(root).toContainText('admin@mio.vn');
  await expect(root.locator('[data-role="admin-count"]')).toHaveText('3');
  await expect(root).toContainText('Supabase');
  await expect(root.locator('[data-role="add-admin"]')).toBeDisabled();
  await expect(root).toContainText('Sắp có');
  expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  expect(errors).toEqual([]);
});

test('/admin/users lỗi 500 → số quản trị viên hiện "—", màn vẫn dùng được', async ({ page }) => {
  const { errors } = await setup(page, { users: 'error' }, { ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/settings`);
  await expect(page.locator('[data-role="admin-count"]')).toHaveText('—');
  await expect(page.locator('[data-screen="settings"]')).toContainText('Không đọc được số quản trị viên');
  await expect(page.locator('[data-screen="settings"]')).toContainText('admin@mio.vn');
  expect(errors).toEqual([]);
});

test('tab hệ thống: phiên bản, máy chủ, AI Agent, link quy tắc, không mã thô', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/settings?tab=system`);
  const root = page.locator('[data-screen="settings"]');
  await expect(root.locator('[data-role="version"]')).toHaveText(/^\d{8}[a-z]?$/);
  await expect(root.locator('[data-role="health"]')).toContainText('Hoạt động');
  await expect(root.locator('[data-role="ai-agent"]')).toContainText('Bật');
  await expect(root.locator('a[href="#/marketing?tab=settings"]')).toBeVisible();
  await expect(root.locator('a[href="#/rules"]')).toBeVisible();
  const text = await root.innerText();
  expect(text).not.toMatch(/\b(production|template|direct|n8n_configured)\b/);
  expect(errors).toEqual([]);
});

test('/health lỗi 500 → hiện "—", không văng lỗi', async ({ page }) => {
  const { errors } = await setup(page, { health: 'error' }, { ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/settings?tab=system`);
  await expect(page.locator('[data-role="health"]')).toContainText('—');
  await expect(page.locator('[data-role="version"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('các tab tĩnh Thông báo / Hỗ trợ / Đánh giá ghi "Sắp có"', async ({ page }) => {
  const { errors, calls } = await setup(page);
  for (const tab of ['notifications', 'support', 'reviews']) {
    await page.goto(`${PAGE}#/settings?tab=${tab}`);
    await expect(page.locator('[data-screen="settings"] [data-role="soon"]')).toContainText('Sắp có');
  }
  expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  expect(errors).toEqual([]);
});

test('?demo=1 mở được màn, không gọi /api/v1', async ({ page }) => {
  const { calls, errors } = await setup(page, {}, { fakeSb: { noSession: true } });
  await page.goto(`${PAGE}?demo=1#/settings`);
  await expect(page.locator('[data-role="admin-count"]')).toBeVisible();
  await page.goto(`${PAGE}?demo=1#/settings?tab=system`);
  await expect(page.locator('[data-role="health"]')).toContainText('Hoạt động');
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
