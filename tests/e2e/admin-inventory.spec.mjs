import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';
import work from '../../public/admin/demo/fixtures/work.js';

// Màn "Hàng đang bán" (Đợt 3): GET /admin/labels + GET /admin/products, POST /admin/products/:id/visibility, POST /admin/automation/label-automation/run.
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };
const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();

const lot = (i, label, over = {}) => ({
  id: `p-${i}`,
  name: `Sản phẩm ${i}`,
  store_name: i % 2 ? 'Tiệm Bánh Nắng' : 'Cửa hàng An Lành',
  label,
  stock_quantity: 5 + i,
  expires_at: inHours(40),
  effective_deadline_at: null,
  price_cents: 12000,
  original_price_cents: 20000,
  label_changed_at: null,
  is_active: true,
  admin_hidden_at: null,
  admin_hidden_reason: null,
  ...over,
});

const baseLots = () => [
  lot(1, 'red', { name: 'Bánh mì que pate', expires_at: inHours(1), effective_deadline_at: inHours(0.2), price_cents: 8000, original_price_cents: 16000, label_changed_at: new Date().toISOString() }),
  lot(2, 'yellow', { name: 'Sữa chua nếp cẩm' }),
  lot(3, 'green', { name: 'Rau cải thìa hữu cơ' }),
  lot(4, 'green', { name: 'Chả lụa đóng gói lỗi', is_active: false, admin_hidden_at: new Date().toISOString(), admin_hidden_reason: 'Bao bì rách' }),
];

const overview = (lots) => {
  const active = lots.filter((l) => !l.admin_hidden_at);
  return {
    counts: {
      green: active.filter((l) => l.label === 'green').length,
      yellow: active.filter((l) => l.label === 'yellow').length,
      red: active.filter((l) => l.label === 'red').length,
    },
    total: active.length,
    lots: active,
  };
};

async function setup(page, { lots = baseLots(), ...opts } = {}) {
  const state = { lots, fail: false, run: 'ok', vis: 'ok' };
  const api = async (route, { path, method, body }) => {
    const [bare, query = ''] = path.split('?');
    const sp = new URLSearchParams(query);
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/dashboard/work') return route.fulfill(ok(work));
    if (bare === '/admin/labels') {
      if (state.fail) return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      return route.fulfill(ok(overview(state.lots)));
    }
    if (bare === '/admin/products' && method === 'GET') {
      if (state.fail) return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      const label = sp.get('label');
      const vis = sp.get('visibility');
      const q = (sp.get('q') || '').trim().toLowerCase();
      const pageNum = Math.max(1, Number(sp.get('page')) || 1);
      const limit = Math.max(1, Number(sp.get('limit')) || 50);
      const filtered = state.lots.filter((p) => {
        if (label && p.label !== label) return false;
        if (vis === 'visible' && p.admin_hidden_at) return false;
        if (vis === 'hidden' && !p.admin_hidden_at) return false;
        if (q && ![p.name, p.store_name].some((v) => String(v || '').toLowerCase().includes(q))) return false;
        return true;
      });
      const start = (pageNum - 1) * limit;
      return route.fulfill(ok({
        items: filtered.slice(start, start + limit),
        total: filtered.length,
        page: pageNum,
        limit,
      }));
    }
    const visMatch = method === 'POST' ? /^\/admin\/products\/([^/]+)\/visibility$/.exec(bare) : null;
    if (visMatch) {
      if (state.vis === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Không đổi được hiển thị'));
      const found = state.lots.find((l) => l.id === visMatch[1]);
      if (!found) return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy sản phẩm'));
      if (body.action === 'hide') {
        found.is_active = false;
        found.admin_hidden_at = new Date().toISOString();
        found.admin_hidden_reason = body.reason;
      } else {
        found.is_active = true;
        found.admin_hidden_at = null;
        found.admin_hidden_reason = null;
      }
      return route.fulfill(ok({ id: found.id, is_active: found.is_active }));
    }
    if (bare === '/admin/automation/label-automation/run' && method === 'POST') {
      if (state.run === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Chạy lỗi'));
      return route.fulfill(ok({ updated: 2 }));
    }
    return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', `Không có ${bare}`));
  };
  const stub = await stubAdmin(page, { api, ...opts });
  return { state, ...stub };
}

const productCalls = (calls) => calls.filter((c) => c.method === 'GET' && c.path.split('?')[0] === '/admin/products');
const visPosts = (calls) => calls.filter((c) => c.method === 'POST' && /^\/admin\/products\/[^/]+\/visibility$/.test(c.path));

test('inventory: tải 3 ô số từ /admin/labels và bảng từ /admin/products; hiện huy hiệu Admin ẩn + lý do; không lộ mã thô hay Sắp có', async ({ page }) => {
  const { errors, calls } = await setup(page);
  await page.goto(`${PAGE}#/inventory`);
  await expect(page.locator('[data-role="kpi-red"]')).toContainText('1');
  await expect(page.locator('[data-role="kpi-yellow"]')).toContainText('1');
  await expect(page.locator('[data-role="kpi-green"]')).toContainText('1');
  const body = page.locator('[data-screen="inventory"]');
  await expect(body.locator('tbody tr')).toHaveCount(4);
  await expect(body).toContainText('Bánh mì que pate');
  await expect(body).toContainText('16.000đ');
  await expect(body).toContainText('8.000đ');
  await expect(body).toContainText('Đỏ −80%');
  await expect(body).toContainText('Admin ẩn');
  await expect(body).toContainText('Bao bì rách');
  const text = await body.innerText();
  expect(text).not.toMatch(/\b(red|yellow|green|visible|hidden|cents)\b/);
  expect(text).not.toContain('Sắp có');
  expect(calls.some((c) => c.path === '/admin/labels')).toBe(true);
  expect(productCalls(calls)[0].path).toBe('/admin/products?page=1&limit=50');
  expect(errors).toEqual([]);
});

test('inventory: lọc nhãn, lọc hiển thị (Tất cả / Đang hiện / Admin đã ẩn), tìm kiếm server & hash', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/inventory?label=green`);
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(2);
  expect(productCalls(calls)[0].path).toBe('/admin/products?page=1&limit=50&label=green');

  await page.click('[data-act="vis"][data-visibility="hidden"]');
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(1);
  await expect(page.locator('[data-screen="inventory"]')).toContainText('Chả lụa đóng gói lỗi');
  expect(page.url()).toContain('visibility=hidden');
  expect(productCalls(calls).at(-1).path).toBe('/admin/products?page=1&limit=50&label=green&visibility=hidden');

  await page.click('[data-act="tab"][data-label="all"]');
  await page.click('[data-act="vis"][data-visibility="visible"]');
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(3);
  expect(productCalls(calls).at(-1).path).toBe('/admin/products?page=1&limit=50&visibility=visible');

  await page.fill('[data-role="inv-search"]', 'sữa chua');
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(1);
  await page.fill('[data-role="inv-search"]', 'không có gì');
  await expect(page.locator('[data-screen="inventory"]')).toContainText('Không có sản phẩm nào khớp');
  expect(errors).toEqual([]);
});

test('inventory: ẩn / bỏ ẩn sản phẩm vi phạm gọi POST /admin/products/:id/visibility với kiểm tra lý do ≥ 3 ký tự', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/inventory`);
  const row1 = page.locator('[data-screen="inventory"] tr[data-id="p-1"]');
  await row1.locator('[data-act="visibility"][data-action="hide"]').click();

  const modal = page.locator('#modal');
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  await modal.locator('[data-role="reason"]').fill('ab');
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  await modal.locator('[data-role="reason"]').fill('Hình ảnh sản phẩm sai thực tế');
  await modal.locator('[data-role="ok"]').click();

  await expect(page.locator('#toasts')).toContainText('Đã ẩn sản phẩm');
  expect(visPosts(calls)[0]).toMatchObject({ path: '/admin/products/p-1/visibility', body: { action: 'hide', reason: 'Hình ảnh sản phẩm sai thực tế' } });
  await expect(row1).toContainText('Admin ẩn');
  await expect(row1).toContainText('Hình ảnh sản phẩm sai thực tế');
  await expect(row1.locator('[data-act="visibility"][data-action="unhide"]')).toBeVisible();

  // Bỏ ẩn p-1
  await row1.locator('[data-act="visibility"][data-action="unhide"]').click();
  await modal.locator('[data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã bỏ ẩn sản phẩm');
  expect(visPosts(calls)[1]).toMatchObject({ path: '/admin/products/p-1/visibility', body: { action: 'unhide' } });
  await expect(row1).not.toContainText('Admin ẩn');
  expect(errors).toEqual([]);
});

test('inventory: phân trang 50 dòng/trang từ server; giá trị hash lạ bị bỏ', async ({ page }) => {
  const many = Array.from({ length: 120 }, (_, i) => lot(i + 1, 'green'));
  const { calls, errors } = await setup(page, { lots: many });
  await page.goto(`${PAGE}#/inventory?label=%3Cx%3E&visibility=hack`);
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(50);
  expect(productCalls(calls)[0].path).toBe('/admin/products?page=1&limit=50');
  await page.click('[data-act="page"][data-page="3"]');
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(20);
  expect(productCalls(calls).at(-1).path).toBe('/admin/products?page=3&limit=50');
  expect(errors).toEqual([]);
});

test('inventory: API lỗi 500 → Thử lại; escape XSS tên sản phẩm và lý do ẩn', async ({ page }) => {
  const { state, errors } = await setup(page, { ignoreStatuses: [500] });
  state.fail = true;
  await page.goto(`${PAGE}#/inventory`);
  await expect(page.getByRole('alert')).toContainText('Lỗi máy chủ');
  state.fail = false;
  state.lots[3].name = '<img src=x onerror="window.__xss=1">';
  state.lots[3].admin_hidden_reason = '<script>window.__xss=2</script>';
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(4);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('inventory: Cập nhật nhãn ngay confirm rồi POST đúng đường dẫn; lỗi báo toast và mở lại nút', async ({ page }) => {
  const { state, calls, errors } = await setup(page, { ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/inventory`);
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(4);
  await page.click('[data-act="run-labels"]');
  await page.click('[data-role="cancel"]');
  expect(calls.filter((c) => c.method === 'POST')).toEqual([]);

  await page.click('[data-act="run-labels"]');
  await page.click('[data-role="ok"]');
  await expect(page.locator('.v2toast')).toContainText('Đã cập nhật nhãn');
  expect(calls.filter((c) => c.method === 'POST')[0].path).toBe('/admin/automation/label-automation/run');

  state.run = 'error';
  await page.click('[data-act="run-labels"]');
  await page.click('[data-role="ok"]');
  await expect(page.locator('.v2toast-err')).toContainText('Chạy lỗi');
  await expect(page.locator('[data-act="run-labels"]')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('inventory: ?demo=1 mở được màn, lọc sản phẩm đã ẩn và không gọi /api/v1', async ({ page }) => {
  const { calls, errors } = await setup(page, { fakeSb: { noSession: true } });
  await page.goto(`${PAGE}?demo=1#/inventory`);
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(4);
  await expect(page.locator('[data-screen="inventory"]')).toContainText('Bánh mì que pate');
  await expect(page.locator('[data-screen="inventory"]')).toContainText('Admin ẩn');
  await page.click('[data-act="vis"][data-visibility="hidden"]');
  await expect(page.locator('[data-screen="inventory"] tbody tr')).toHaveCount(1);
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
