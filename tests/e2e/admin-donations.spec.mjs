import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';
import work from '../../public/admin/demo/fixtures/work.js';

// Màn Lô tặng & ghép đơn (Đợt 3): GET /admin/donations, GET /admin/donations/:id, POST /admin/donations/:id/cancel, GET /matching/needs.
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const NOW = Date.now();
const iso = (minutes) => new Date(NOW + minutes * 60000).toISOString();
const D1 = 'd1111111-aaaa-4000-8000-000000000001';
const D2 = 'd2222222-bbbb-4000-8000-000000000002';
const D3 = 'd3333333-cccc-4000-8000-000000000003';
const D4 = 'd4444444-dddd-4000-8000-000000000004';
const SECRET = 'XK7Q2M';

const seedLots = () => [
  {
    id: D1, donation_code: 'DN-1001', status: 'in_route', urgency: 'red', items: 'Bánh mì ngọt các loại', amount_text: '30 phần', quantity: 30, weight_kg: 6.5,
    expires_at: iso(300), pickup_start: '16:00', pickup_end: '18:00', note: 'Lấy ở cửa sau', pickup_code: SECRET, offer_expires_at: null, created_at: iso(-200),
    stores: { id: 's1', name: 'Tiệm bánh Hoa Sữa', address: '12 Lê Lợi, Quận 1' }, charity_profiles: { id: 'c1', name: 'Mái ấm Hy Vọng' },
    volunteers: { id: 'v1', full_name: 'Phạm Tình Nguyện', phone: '0988123456' },
    donation_assignments: [
      { volunteer_id: 'v1', stage: 'pickup', share: 30, done_at: iso(-60), volunteers: { id: 'v1', full_name: 'Phạm Tình Nguyện', phone: '0988123456', vehicle: 'Xe máy' } },
      { volunteer_id: 'v2', stage: 'distribute', share: 30, done_at: null, volunteers: { id: 'v2', full_name: 'Hồ Phát Hàng', phone: '0977000111', vehicle: 'Xe đạp' } },
    ],
  },
  { id: D2, donation_code: 'DN-1002', status: 'open', urgency: 'green', items: 'Cơm hộp', amount_text: '12 hộp', quantity: null, weight_kg: 4, expires_at: iso(200), pickup_start: '17:00', pickup_end: '19:00', note: null, pickup_code: SECRET, created_at: iso(-30), stores: { id: 's2', name: 'Siêu thị Xanh', address: null }, charity_profiles: null, volunteers: null, donation_assignments: [] },
  { id: D3, donation_code: 'DN-1003', status: 'rejected', urgency: 'yellow', items: 'Rau củ', amount_text: '5 kg', quantity: 5, weight_kg: 5, expires_at: iso(-50), pickup_start: '08:00', pickup_end: '09:00', note: null, pickup_code: null, created_at: iso(-500), stores: { id: 's2', name: 'Siêu thị Xanh', address: null }, charity_profiles: { id: 'c1', name: 'Mái ấm Hy Vọng' }, volunteers: null, donation_assignments: [] },
  { id: D4, donation_code: 'DN-1004', status: 'completed', urgency: 'green', items: 'Sữa tươi tiệt trùng', amount_text: '24 hộp', quantity: 24, weight_kg: 6, expires_at: iso(-10), pickup_start: '09:00', pickup_end: '10:00', note: null, pickup_code: SECRET, created_at: iso(-600), stores: { id: 's1', name: 'Tiệm bánh Hoa Sữa', address: '12 Lê Lợi' }, charity_profiles: { id: 'c1', name: 'Mái ấm Hy Vọng' }, volunteers: null, donation_assignments: [] },
];

const PHOTOS = [
  { id: 'p1', volunteer_id: 'v1', stage: 'pickup', photo_url: 'https://img.test/anh-nhan-hang.png', status: 'approved', taken_at: iso(-65), gps_flag: false, is_demo: false, review_note: null, volunteers: { full_name: 'Phạm Tình Nguyện' } },
  { id: 'p2', volunteer_id: 'v2', stage: 'distribute', photo_url: 'javascript:alert(1)', status: 'pending', taken_at: iso(-20), gps_flag: true, is_demo: false, review_note: null, volunteers: { full_name: 'Hồ Phát Hàng' } },
  { id: 'p3', volunteer_id: 'v2', stage: 'distribute', photo_url: 'http://img.test/khong-bao-mat.png', status: 'retake', taken_at: iso(-25), gps_flag: false, is_demo: false, review_note: 'Ảnh mờ', volunteers: { full_name: 'Hồ Phát Hàng' } },
];
const REPORT = {
  donation: { id: D1, code: 'DN-1001', status: 'in_route', items: 'Bánh mì ngọt các loại', amount_text: '30 phần', quantity: 30, weight_kg: 6.5, portions: 30, completed_at: null, distribution_done_at: null, pickup_code: SECRET },
  store: { name: 'Tiệm bánh Hoa Sữa' },
  charity: { name: 'Mái ấm Hy Vọng' },
  team: { pickup: [{ volunteer_id: 'v1', name: 'Phạm Tình Nguyện', phone: '0988123456', vehicle: 'Xe máy', share: 30, done_at: iso(-60), photo_count: 1 }], distribute: [] },
  photos: PHOTOS,
  timeline: [
    { at: iso(-200), label: 'Cửa hàng đăng lô tặng' },
    { at: iso(-150), label: 'Mái ấm Hy Vọng chọn lô' },
  ],
};
const NEEDS = [
  { id: 'n1111111-0000-4000-8000-000000000001', charity_id: 'c1aaaaaa-0000-4000-8000-000000000001', title: 'Bữa tối cho 50 người', category_codes: ['meal', 'bakery'], quantity: 50, needed_by: iso(240), status: 'open', note: null, matched_donation_ids: [], created_at: iso(-60) },
  { id: 'n2222222-0000-4000-8000-000000000002', charity_id: 'c1aaaaaa-0000-4000-8000-000000000001', title: 'Bánh sáng mai', category_codes: ['bakery'], quantity: 30, needed_by: iso(-30), status: 'matched', note: null, matched_donation_ids: [D1, D2], created_at: iso(-400) },
  { id: 'n3333333-0000-4000-8000-000000000003', charity_id: 'c2bbbbbb-0000-4000-8000-000000000002', title: 'Đồ ăn nhẹ', category_codes: ['meal'], quantity: 10, needed_by: iso(60), status: 'cancelled', note: null, matched_donation_ids: [], created_at: iso(-300) },
];

function makeApi(state) {
  return async (route, { path, method, body }) => {
    const [bare, query = ''] = path.split('?');
    const params = new URLSearchParams(query);
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/dashboard/work') return route.fulfill(ok(work));

    if (bare === '/admin/donations' && method === 'GET') {
      if (state.list === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      const status = params.get('status');
      const q = (params.get('q') || '').trim().toLowerCase();
      const items = state.lots.filter((d) => {
        if (status && d.status !== status) return false;
        if (q && ![d.donation_code, d.items, d.stores?.name].some((v) => String(v || '').toLowerCase().includes(q))) return false;
        return true;
      });
      const page = Number(params.get('page') || 1);
      return route.fulfill(ok({
        items,
        total: state.hasNext ? 45 : items.length,
        page,
        limit: 20,
        pagination: { page, limit: 20, total: state.hasNext ? 45 : items.length, has_next_page: Boolean(state.hasNext) },
      }));
    }

    const detailMatch = method === 'GET' ? /^\/admin\/donations\/([^/]+)$/.exec(bare) : null;
    if (detailMatch) {
      const lot = state.lots.find((d) => d.id === detailMatch[1]);
      if (!lot) return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy lô'));
      if (state.detailMode === 'bare') return route.fulfill(ok({ ...lot })); // buộc fallback sang /photos và /report
      return route.fulfill(ok({ ...lot, photos: PHOTOS, report: REPORT, timeline: REPORT.timeline }));
    }

    const cancelMatch = method === 'POST' ? /^\/admin\/donations\/([^/]+)\/cancel$/.exec(bare) : null;
    if (cancelMatch) {
      if (state.cancel === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Không hủy được lô'));
      const lot = state.lots.find((d) => d.id === cancelMatch[1]);
      if (!lot) return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy lô'));
      lot.status = 'cancelled';
      lot.cancel_reason = body.reason;
      return route.fulfill(ok({ id: lot.id, status: 'cancelled' }));
    }

    if (bare === '/matching/needs') {
      if (state.needs === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      return route.fulfill(ok(NEEDS));
    }
    if (/^\/donations\/[^/]+\/photos$/.test(bare)) {
      if (state.photos === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      return route.fulfill(ok({ items: PHOTOS }));
    }
    if (/^\/donations\/[^/]+\/report$/.test(bare)) {
      if (state.report === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      return route.fulfill(ok(REPORT));
    }
    return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', `Không có route ${bare}`));
  };
}

async function setup(page, { ignoreStatuses = [], fakeSb = {}, ...over } = {}) {
  await page.route(/^https:\/\/(img\.test|example\.com)\//, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const state = { lots: seedLots(), list: 'ok', needs: 'ok', photos: 'ok', report: 'ok', cancel: 'ok', detailMode: 'full', ...over };
  const stub = await stubAdmin(page, { api: makeApi(state), fakeSb, ignoreStatuses });
  return { state, ...stub };
}

const lotCalls = (calls) => calls.filter((c) => c.path.split('?')[0] === '/admin/donations' && c.method === 'GET');
const cancelCalls = (calls) => calls.filter((c) => c.method === 'POST' && /^\/admin\/donations\/[^/]+\/cancel$/.test(c.path));
const RAW = /\bopen\b|\baccepted\b|in_route|\bcompleted\b|\brejected\b|\bcancelled\b|\bmatched\b|\bpending\b|\bapproved\b|auto_approved|\bretake\b|\bpickup\b|\bdistribute\b|\bbakery\b|\bmeal\b|\bcents\b/;
const LOT_ROWS = '[data-role="lots-table"] tbody tr[data-id]';

test('donations: bảng lô từ GET /admin/donations, nhãn Việt, mức khẩn; KHÔNG hiện pickup_code hay Sắp có', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/donations`);
  const rows = page.locator(LOT_ROWS);
  await expect(rows).toHaveCount(4);
  const first = rows.nth(0);
  await expect(first).toContainText('DN-1001');
  await expect(first).toContainText('Tiệm bánh Hoa Sữa');
  await expect(first).toContainText('Mái ấm Hy Vọng');
  await expect(first).toContainText('Bánh mì ngọt các loại');
  await expect(first).toContainText('30 phần');
  await expect(first).toContainText('Đỏ −80%');
  await expect(first).toContainText('Đang đi lấy');
  await expect(rows.nth(1)).toContainText('Đang mời nhận');
  await expect(rows.nth(1)).toContainText('Chưa có tổ chức');
  await expect(rows.nth(2)).toContainText('Cửa hàng từ chối');
  await expect(rows.nth(3)).toContainText('Đã bàn giao');
  const text = await page.locator('#screen').innerText();
  expect(text).not.toMatch(RAW);
  expect(text).not.toContain('Sắp có');
  expect(text).not.toContain(SECRET);
  expect(await page.content()).not.toContain(SECRET);
  expect(lotCalls(calls)[0].path).toBe('/admin/donations?page=1&limit=20');
  expect(errors).toEqual([]);
});

test('donations: tìm kiếm q, lọc trạng thái trong hash, hash lạ bị bỏ, phân trang', async ({ page }) => {
  const { calls, errors } = await setup(page, { hasNext: true });
  await page.goto(`${PAGE}#/donations?status=hack`);
  await expect(page.locator(LOT_ROWS)).toHaveCount(4);
  expect(lotCalls(calls)[0].path).toBe('/admin/donations?page=1&limit=20');

  await page.fill('#screen [data-role="search"]', 'Cơm hộp');
  await expect(page.locator(LOT_ROWS)).toHaveCount(1);
  await expect(page.locator('[data-role="lots-table"]')).toContainText('DN-1002');
  expect(lotCalls(calls).at(-1).path).toContain('q=C%C6%A1m+h%E1%BB%99p');
  await page.fill('#screen [data-role="search"]', '');
  await expect(page.locator(LOT_ROWS)).toHaveCount(4);

  await page.click('[data-act="status"][data-status="open"]');
  expect(await page.evaluate(() => location.hash)).toBe('#/donations?status=open');
  await expect(page.locator(LOT_ROWS)).toHaveCount(1);
  expect(lotCalls(calls).at(-1).path).toBe('/admin/donations?page=1&limit=20&status=open');

  await page.click('[data-act="next"]');
  expect(await page.evaluate(() => location.hash)).toBe('#/donations?status=open&page=2');
  await expect.poll(() => lotCalls(calls).at(-1).path).toBe('/admin/donations?page=2&limit=20&status=open');
  expect(errors).toEqual([]);
});

test('donations: API lỗi 500 → Thử lại; escape XSS dữ liệu độc', async ({ page }) => {
  const { state, errors } = await setup(page, { list: 'error', ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/donations`);
  await expect(page.locator('#screen [data-role="retry"]')).toBeVisible();
  state.list = 'ok';
  state.lots[0].items = '<img src=x onerror="window.__xss=1">';
  await page.click('#screen [data-role="retry"]');
  await expect(page.locator(LOT_ROWS)).toHaveCount(4);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('donations: drawer GET /admin/donations/:id hiện ảnh https, đội TNV, báo cáo; không lộ pickup_code; Hủy lô trực tiếp', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/donations`);
  await page.locator(`${LOT_ROWS}[data-id="${D1}"]`).click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toHaveClass(/open/);
  await expect(drawer).toContainText('Lấy ở cửa sau');
  await expect(drawer).toContainText('Phạm Tình Nguyện');
  await expect(drawer).toContainText('098***456');
  await expect(drawer.locator('[data-role="photos"] img')).toHaveCount(1);
  await expect(drawer.locator('[data-role="photos"] img').first()).toHaveAttribute('src', 'https://img.test/anh-nhan-hang.png');
  await expect(drawer.locator('[data-role="photos"]')).toContainText('Vị trí chụp xa');
  await expect(drawer.locator('[data-role="report"]')).toContainText('Cửa hàng đăng lô tặng');
  await expect(drawer).not.toContainText('Sắp có');
  expect(await drawer.innerText()).not.toMatch(RAW);
  expect(await page.content()).not.toContain(SECRET);
  expect(await drawer.locator('img[src^="http:"], img[src^="javascript:"]').count()).toBe(0);

  // Nút Hủy lô yêu cầu lý do ≥ 3 ký tự
  await drawer.locator('[data-act="cancel-lot"]').click();
  const modal = page.locator('#modal');
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  await modal.locator('[data-role="reason"]').fill('ab');
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  await modal.locator('[data-role="reason"]').fill('Thực phẩm không đạt tiêu chuẩn bảo quản');
  await modal.locator('[data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã hủy lô tặng');
  await expect(drawer).not.toHaveClass(/open/);
  expect(cancelCalls(calls)[0]).toMatchObject({ path: `/admin/donations/${D1}/cancel`, body: { reason: 'Thực phẩm không đạt tiêu chuẩn bảo quản' } });

  // Mở lại lô đã hủy và lô đã bàn giao (completed): không hiện nút Hủy lô
  await page.locator(`${LOT_ROWS}[data-id="${D1}"]`).click();
  await expect(drawer.locator('[data-act="cancel-lot"]')).toHaveCount(0);
  await expect(drawer).toContainText('Thực phẩm không đạt tiêu chuẩn bảo quản');
  await page.click('#drawer [data-role="drawer-close"]');

  await page.locator(`${LOT_ROWS}[data-id="${D4}"]`).click();
  await expect(drawer.locator('[data-act="cancel-lot"]')).toHaveCount(0);
  expect(await page.content()).not.toContain(SECRET);
  expect(errors).toEqual([]);
});

test('donations: fallback sang /donations/:id/photos và /report khi detail không nhúng sẵn; lỗi phụ không phá màn', async ({ page }) => {
  const { calls, errors } = await setup(page, { detailMode: 'bare', photos: 'error', report: 'error', ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/donations`);
  await page.locator(`${LOT_ROWS}[data-id="${D2}"]`).click();
  const drawer = page.locator('#drawer');
  await expect(drawer.locator('[data-role="photos"]')).toContainText('Không tải được');
  await expect(drawer.locator('[data-role="report"]')).toContainText('Không tải được');
  await expect(drawer).toContainText('Cơm hộp');
  const paths = calls.map((c) => c.path.split('?')[0]);
  expect(paths).toContain(`/admin/donations/${D2}`);
  expect(paths).toContain(`/donations/${D2}/photos`);
  expect(paths).toContain(`/donations/${D2}/report`);
  expect(errors).toEqual([]);
});

test('donations: tab Nhu cầu ghép đơn lưu trong hash, hiện bảng nhu cầu, lỗi có Thử lại', async ({ page }) => {
  const { state, errors } = await setup(page, { needs: 'error', ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/donations`);
  await expect(page.locator(LOT_ROWS)).toHaveCount(4);
  await page.click('[data-act="tab"][data-tab="needs"]');
  expect(await page.evaluate(() => location.hash)).toBe('#/donations?tab=needs');
  await expect(page.locator('#screen [data-role="retry"]')).toBeVisible();
  state.needs = 'ok';
  await page.click('#screen [data-role="retry"]');
  const rows = page.locator('[data-role="needs-table"] tbody tr[data-id]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Bữa tối cho 50 người');
  await expect(rows.nth(0)).toContainText('Bữa ăn / cơm hộp');
  await expect(rows.nth(0)).toContainText('Đang mở');
  await expect(rows.nth(1)).toContainText('Đã ghép đủ');
  await expect(rows.nth(2)).toContainText('Đã hủy');
  expect(await page.locator('#screen').innerText()).not.toMatch(RAW);
  expect(errors).toEqual([]);
});

test('donations: ?demo=1 mở được cả hai tab và drawer, không gọi /api/v1/**', async ({ page }) => {
  const { calls, errors } = await setup(page, { fakeSb: { noSession: true } });
  await page.goto(`${PAGE}?demo=1#/donations`);
  const rows = page.locator(LOT_ROWS);
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(4);
  await rows.first().click();
  await expect(page.locator('#drawer [data-role="report"]')).toBeVisible();
  await expect(page.locator('#drawer [data-role="photos"]')).not.toContainText('Đang tải');
  await expect(page.locator('#drawer [data-act="cancel-lot"]')).toBeVisible();
  await page.click('#drawer [data-role="drawer-close"]');
  await page.click('[data-act="tab"][data-tab="needs"]');
  await expect(page.locator('[data-role="needs-table"] tbody tr[data-id]').first()).toBeVisible();
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
