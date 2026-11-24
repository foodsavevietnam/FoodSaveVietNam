import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';

// Màn "Tổ chức & tình nguyện viên" (Wave 4A Đợt 2): GET/POST /admin/charities* & /admin/volunteers*.
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };
const CH1 = 'aaaa1111-0000-4000-8000-000000000001';
const CH2 = 'bbbb2222-0000-4000-8000-000000000002';
const CH3 = 'cccc3333-0000-4000-8000-000000000003';
const V1 = 'dddd4444-0000-4000-8000-000000000001';
const V2 = 'dddd4444-0000-4000-8000-000000000002';

const seedCharities = () => [
  { id: CH1, owner_id: 'o1', name: 'Quỹ Bếp Thử Một', address: '15 Lý Tự Trọng', phone: '0901112223', email: 'bep1@example.test', beneficiaries_count: 150, status: 'active', suspended_reason: null, created_at: '2026-11-20T03:00:00.000Z' },
  { id: CH2, owner_id: 'o2', name: 'Quỹ Bếp Yêu Thương', address: '88 CMT8', phone: '0903334445', email: 'yeuthuong@example.test', beneficiaries_count: 80, status: 'pending', suspended_reason: null, created_at: '2026-11-21T03:00:00.000Z' },
  { id: CH3, owner_id: 'o3', name: 'Nhóm Tạm Ngưng', address: '42 Phan Xích Long', phone: '0905556667', email: 'ngung@example.test', beneficiaries_count: 40, status: 'suspended', suspended_reason: 'Thiếu báo cáo tháng', created_at: '2026-10-10T03:00:00.000Z' },
];

const seedVolunteers = () => [
  { id: V1, charity_id: CH1, charity_name: 'Quỹ Bếp Thử Một', full_name: 'Lê Tình Nguyện', phone: '0987654321', email: 'tnv1@example.test', duty_role: 'pickup', status: 'active', runs: 7, kg_collected: '42.5' },
  { id: V2, charity_id: CH1, charity_name: 'Quỹ Bếp Thử Một', full_name: 'Phạm Nghỉ Phép', phone: '0911222333', email: 'tnv2@example.test', duty_role: 'both', status: 'inactive', runs: 0, kg_collected: '0' },
];

function makeApi(state) {
  return async (route, { path, method }) => {
    const bare = path.split('?')[0];
    const sp = new URLSearchParams(path.split('?')[1] || '');
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/dashboard/work') return route.fulfill(ok({}));

    if (bare === '/admin/charities' && method === 'GET') {
      if (state.listMode === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      const st = sp.get('status');
      const q = (sp.get('q') || '').trim().toLowerCase();
      const filtered = state.charities.filter((c) => {
        if (st && c.status !== st) return false;
        if (q && ![c.name, c.address, c.phone, c.email].some((v) => String(v || '').toLowerCase().includes(q))) return false;
        return true;
      });
      return route.fulfill(ok({
        items: filtered,
        total: filtered.length,
        page: 1,
        limit: 20,
        counts: {
          active: state.charities.filter((c) => c.status === 'active').length,
          pending: state.charities.filter((c) => c.status === 'pending').length,
          suspended: state.charities.filter((c) => c.status === 'suspended').length,
          rejected: 0,
          total: state.charities.length,
        },
      }));
    }

    const chDetail = method === 'GET' ? bare.match(/^\/admin\/charities\/([^/]+)$/) : null;
    if (chDetail) {
      if (state.detailMode === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      const c = state.charities.find((x) => x.id === chDetail[1]);
      if (!c) return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy tổ chức'));
      return route.fulfill(ok({
        charity: c,
        owner: { id: c.owner_id, full_name: 'Đại diện tổ chức', email: c.email, phone: '090••••223' },
        volunteers: state.emptyVols ? [] : state.volunteers.filter((v) => v.charity_id === c.id),
        recent_donations: [
          { id: 'd1', donation_code: 'DN-001', items: '20 phần cơm', weight_kg: 12.5, status: 'completed', created_at: '2026-11-22T03:00:00.000Z' },
        ],
        recent_audit: [],
      }));
    }

    const chStatus = method === 'POST' ? bare.match(/^\/admin\/charities\/([^/]+)\/status$/) : null;
    if (chStatus) {
      const body = route.request().postDataJSON?.() || {};
      const c = state.charities.find((x) => x.id === chStatus[1]);
      if (c) {
        c.status = body.status;
        c.suspended_reason = body.status === 'suspended' ? (body.reason || null) : null;
      }
      return route.fulfill(ok({ id: chStatus[1], status: body.status }));
    }

    if (bare === '/admin/volunteers' && method === 'GET') {
      const q = (sp.get('q') || '').trim().toLowerCase();
      const filtered = state.volunteers.filter((v) => !q || [v.full_name, v.phone, v.email].some((val) => String(val || '').toLowerCase().includes(q)));
      return route.fulfill(ok({ items: filtered, total: filtered.length, page: 1, limit: 20 }));
    }

    const volStatus = method === 'POST' ? bare.match(/^\/admin\/volunteers\/([^/]+)\/status$/) : null;
    if (volStatus) {
      const body = route.request().postDataJSON?.() || {};
      const v = state.volunteers.find((x) => x.id === volStatus[1]);
      if (v) v.status = body.status;
      return route.fulfill(ok({ id: volStatus[1], status: body.status }));
    }

    return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không có ' + bare));
  };
}

async function setup(page, opts = {}, stubOpts = {}) {
  const state = {
    listMode: 'ok',
    detailMode: 'ok',
    emptyVols: false,
    charities: seedCharities(),
    volunteers: seedVolunteers(),
    ...opts,
  };
  const stub = await stubAdmin(page, { api: makeApi(state), ...stubOpts });
  return { state, ...stub };
}

test('tab đang hoạt động: tải từ /admin/charities, SĐT che, nhãn tiếng Việt, không mã thô', async ({ page }) => {
  const { errors, calls } = await setup(page);
  await page.goto(`${PAGE}#/charities`);
  const table = page.locator('[data-screen="charities"] [data-role="active-table"]');
  await expect(table).toContainText('Quỹ Bếp Thử Một');
  await expect(table).toContainText('090***223');
  await expect(table).not.toContainText('0901112223');
  const text = await page.locator('[data-screen="charities"]').innerText();
  expect(text).not.toContain('Sắp có');
  expect(text).not.toMatch(/\b(active|pending|suspended|inactive)\b/);
  expect(calls.some((c) => c.path.startsWith('/admin/charities?') && c.path.includes('status=active'))).toBe(true);
  expect(errors).toEqual([]);
});

test('tab chờ duyệt & tab tạm ngưng: danh sách + nút dẫn #/verify', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/charities?tab=suspended`);
  await expect(page.locator('[data-role="suspended-table"]')).toContainText('Nhóm Tạm Ngưng');

  await page.click('[data-act="tab"][data-tab="pending"]');
  await expect(page.locator('[data-role="pending-table"]')).toContainText('Quỹ Bếp Yêu Thương');
  await page.locator('[data-act="to-verify"]').click();
  expect(await page.evaluate(() => location.hash)).toContain('#/verify');
  expect(errors).toEqual([]);
});

test('drawer 360° tổ chức: liệt kê TNV SĐT che, lô tặng không pickup_code, tạm ngưng tổ chức & vô hiệu hóa TNV', async ({ page }) => {
  const { errors, calls } = await setup(page);
  await page.goto(`${PAGE}#/charities`);
  await page.locator(`[data-act="open"][data-id="${CH1}"]`).click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText('Lê Tình Nguyện');
  await expect(drawer).toContainText('098***321');
  await expect(drawer).not.toContainText('0987654321');
  await expect(drawer).toContainText('Lấy hàng');
  await expect(drawer).toContainText('DN-001');
  await expect(drawer).not.toContainText('inactive');

  // Tạm ngưng tổ chức với lý do bắt buộc ≥ 3 ký tự
  await drawer.locator('[data-act="charity-status"][data-status="suspended"]').click();
  const modal = page.locator('#modal');
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  await modal.locator('[data-role="reason"]').fill('Tạm ngưng đối soát');
  await modal.locator('[data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã tạm ngưng tổ chức');
  expect(calls.some((c) => c.method === 'POST' && c.path === `/admin/charities/${CH1}/status` && c.body?.status === 'suspended')).toBe(true);

  // Mở lại tổ chức
  await expect(drawer.locator('[data-act="charity-status"][data-status="active"]')).toBeVisible();
  await drawer.locator('[data-act="charity-status"][data-status="active"]').click();
  await modal.locator('[data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã mở lại tổ chức');
  expect(errors).toEqual([]);
});

test('tab Tình nguyện viên: tải từ /admin/volunteers, có link Bản đồ theo dõi, vô hiệu hóa TNV cần lý do ≥ 3', async ({ page }) => {
  const { errors, calls } = await setup(page);
  await page.goto(`${PAGE}#/charities?tab=volunteers`);
  const table = page.locator('[data-role="volunteers-table"]');
  await expect(table).toContainText('Lê Tình Nguyện');
  await expect(table).toContainText('Quỹ Bếp Thử Một');
  await expect(page.locator('[data-screen="charities"] a[href="#/tracking"]')).toBeVisible();

  await table.locator(`[data-act="vol-status"][data-id="${V1}"]`).click();
  const modal = page.locator('#modal');
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  await modal.locator('[data-role="reason"]').fill('Nghỉ dài hạn');
  await modal.locator('[data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã vô hiệu hóa tình nguyện viên');
  expect(calls.some((c) => c.method === 'POST' && c.path === `/admin/volunteers/${V1}/status` && c.body?.status === 'inactive')).toBe(true);
  expect(errors).toEqual([]);
});

test('API lỗi 500 → nút Thử lại; drawer không TNV / lỗi 500; XSS escape; deep-link #/charities?id=', async ({ page }) => {
  const { state, errors } = await setup(page, { listMode: 'error' }, { ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/charities`);
  await expect(page.locator('[data-screen="charities"] [data-role="retry"]')).toBeVisible();
  state.listMode = 'ok';
  state.charities[0].name = '<img src=x onerror="window.__xss=1">';
  await page.locator('[data-screen="charities"] [data-role="retry"]').click();
  await expect(page.locator('[data-role="active-table"]')).toContainText('<img');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();

  state.emptyVols = true;
  await page.goto(`${PAGE}#/charities?id=${CH1}`);
  await expect(page.locator('#drawer')).toContainText('Tổ chức này chưa có tình nguyện viên.');

  state.detailMode = 'error';
  await page.locator('#drawer [data-role="drawer-close"]').click();
  await page.locator(`[data-act="open"][data-id="${CH1}"]`).click();
  await expect(page.locator('#drawer [role="alert"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('?demo=1 mở được màn, không gọi /api/v1', async ({ page }) => {
  const { calls, errors } = await setup(page, {}, { fakeSb: { noSession: true } });
  await page.goto(`${PAGE}?demo=1#/charities`);
  await expect(page.locator('[data-role="active-table"]')).toBeVisible();
  await expect(page.locator('[data-role="active-table"] tbody tr').first()).toBeVisible();
  await page.goto(`${PAGE}?demo=1#/charities?tab=volunteers`);
  await expect(page.locator('[data-role="volunteers-table"]')).toBeVisible();
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
