import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';

// Màn "Hàng đang bán" của cổng quản trị mới (/admin).
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };
const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();

const lot = (i, label, over = {}) => ({
  id: `p-${i}`, name: `Sản phẩm ${i}`, store_name: i % 2 ? 'Tiệm Bánh Nắng' : 'Cửa hàng An Lành', label, stock_quantity: 5 + i,
  expires_at: inHours(40), effective_deadline_at: null, price_cents: 12000, original_price_cents: 20000, label_changed_at: null, ...over,
});
const baseLots = () => [
  lot(1, 'red', { name: 'Bánh mì que pate', expires_at: inHours(1), effective_deadline_at: inHours(0.2), price_cents: 8000, original_price_cents: 16000, label_changed_at: new Date().toISOString() }),
  lot(2, 'yellow', { name: 'Sữa chua nếp cẩm' }),
  lot(3, 'green', { name: 'Rau cải thìa hữu cơ' }),
  lot(4, 'green', { name: 'Cà chua bi' }),
];
const overview = (lots) => ({ counts: { green: lots.filter((l) => l.label === 'green').length, yellow: lots.filter((l) => l.label === 'yellow').length, red: lots.filter((l) => l.label === 'red').length }, total: lots.length, lots });

async function setup(page, { lots = baseLots(), ...opts } = {}) {
  const state = { lots, fail: false, run: 'ok' };
  const api = async (route, { path, method }) => {
    const bare = path.split('?')[0];
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/labels') {
      if (state.fail) return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      return route.fulfill(ok(overview(state.lots)));
    }
    if (bare === '/admin/automation/label-automation/run' && method === 'POST') {
      if (state.run === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Chạy lỗi'));
      return route.fulfill(ok({ updated: 2 }));
    }
    return route.fulfill(ok({}));
  };
  const stub = await stubAdmin(page, { api, ...opts });
  return { state, ...stub };
}

test('tải hàng đang bán thật: 3 ô số, bảng, giá, hạn, không mã thô', async ({ page }) => {
  const { errors, calls } = await setup(page);
  await page.goto(`${PAGE}#/inventory`);
  await expect(page.locator('[data-role="kpi-red"]')).toContainText('1');
  await expect(page.locator('[data-role="kpi-yellow"]')).toContainText('1');
  await expect(page.locator('[data-role="kpi-green"]')).toContainText('2');
  await expect(page.locator('[data-role="kpi-red"]')).toContainText('Đỏ');
  const body = page.locator('[data-screen="inventory"]');
  await expect(body.locator('tbody tr')).toHaveCount(4);
  await expect(body).toContainText('Bánh mì que pate');
  await expect(body).toContainText('Tiệm Bánh Nắng');
  await expect(body).toContainText('16.000đ');
  await expect(body).toContainText('8.000đ');
  await expect(body).toContainText('Đỏ −80%');
  await expect(body).toContainText('phút');
  await expect(body).not.toContainText(/\b(red|yellow|green)\b/);
  expect(calls.some((c) => c.path === '/admin/labels')).toBe(true);
  expect(errors).toEqual([]);
});

test('tab nhãn lưu trong hash và lọc bảng; tìm theo tên sản phẩm/cửa hàng', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/inventory?label=green`);
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(2);
  await page.click('[data-act="tab"][data-label="red"]');
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(1);
  expect(page.url()).toContain('label=red');
  await page.click('[data-act="tab"][data-label="all"]');
  await page.fill('[data-role="inv-search"]', 'sữa chua');
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(1);
  await page.fill('[data-role="inv-search"]', 'an lành');
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(2);
  await page.fill('[data-role="inv-search"]', 'không có gì');
  await expect(page.locator('[data-screen="inventory"]')).toContainText('Không có');
  expect(errors).toEqual([]);
});

test('giá trị nhãn lạ trong hash → coi như tất cả', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/inventory?label=%3Cx%3E`);
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('phân trang phía client 50 dòng/trang', async ({ page }) => {
  const many = Array.from({ length: 120 }, (_, i) => lot(i + 1, 'green'));
  const { errors } = await setup(page, { lots: many });
  await page.goto(`${PAGE}#/inventory`);
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(50);
  await page.click('[data-act="page"][data-page="3"]');
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(20);
  expect(errors).toEqual([]);
});

test('API lỗi 500 → báo lỗi có nút Thử lại', async ({ page }) => {
  const { state, errors } = await setup(page, { ignoreStatuses: [500] });
  state.fail = true;
  await page.goto(`${PAGE}#/inventory`);
  await expect(page.getByRole('alert')).toContainText('Lỗi máy chủ');
  state.fail = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('Cập nhật nhãn ngay: confirm rồi POST đúng đường dẫn, toast, tải lại; hủy thì không gọi', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/inventory`);
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(4);
  await page.click('[data-act="run-labels"]');
  await page.click('[data-role="cancel"]');
  expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  const before = calls.filter((c) => c.path === '/admin/labels').length;
  await page.click('[data-act="run-labels"]');
  await page.click('[data-role="ok"]');
  await expect(page.locator('.v2toast')).toContainText('Đã cập nhật nhãn');
  const posts = calls.filter((c) => c.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0].path).toBe('/admin/automation/label-automation/run');
  await expect.poll(() => calls.filter((c) => c.path === '/admin/labels').length).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test('Cập nhật nhãn lỗi → toast lỗi, nút mở lại', async ({ page }) => {
  const { state, errors } = await setup(page, { ignoreStatuses: [500] });
  state.run = 'error';
  await page.goto(`${PAGE}#/inventory`);
  await page.click('[data-act="run-labels"]');
  await page.click('[data-role="ok"]');
  await expect(page.locator('.v2toast-err')).toContainText('Chạy lỗi');
  await expect(page.locator('[data-act="run-labels"]')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('"Sắp có": ẩn sản phẩm vi phạm là nút tắt, không gọi API', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/inventory`);
  const btn = page.locator('[data-role="soon-hide"]');
  await expect(btn).toBeDisabled();
  await expect(page.locator('[data-screen="inventory"]')).toContainText('Sắp có');
  expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  expect(errors).toEqual([]);
});

test('?demo=1 mở được màn, không gọi /api/v1', async ({ page }) => {
  const { calls, errors } = await setup(page, { fakeSb: { noSession: true } });
  await page.goto(`${PAGE}?demo=1#/inventory`);
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(3);
  await expect(page.locator('[data-screen="inventory"]')).toContainText('Bánh mì que pate');
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
