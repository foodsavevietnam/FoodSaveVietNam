import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';
import work from '../../public/admin/demo/fixtures/work.js';

// Màn "Đăng bài tự động" của cổng quản trị mới. Auth Supabase và API đều được stub.
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };

const ID = (n) => `b1000000-0000-4000-8000-00000000000${n}`;
const item = (n, over = {}) => ({
  product_id: ID(n), name: `Món thử ${n}`, emoji: '🍱', store_name: `Cửa hàng ${n}`, label: n % 2 ? 'red' : 'yellow', food_group: 'cooked',
  discount_percent: n % 2 ? 80 : 50, price_vnd: 6000 * n, original_price_vnd: 30000, deadline_text: '21:30', hours_left: 1.5, image_url: null, ...over,
});
const QUEUE = [item(1), item(2), item(3), item(4), { ...item(5), recently_posted: true }].map((q) => ({ recently_posted: false, ...q }));
const post = (n, over = {}) => ({
  id: `c2000000-0000-4000-8000-00000000000${n}`, created_at: '2026-11-23T08:15:00.000Z', status: 'sent', tier: 'ai',
  content: `Nội dung bài số ${n}`, error: null, external_url: null, items: [item(1), item(2)], labels: { red: 1, yellow: 1 }, ...over,
});
const OVERVIEW = {
  central: { id: '100000000000001', name: 'Fanpage MIO Thử' },
  integrations: { n8n_configured: true, n8n_central_configured: true, ai_enabled: true, direct_fallback: false },
  mode: 'ai', auto_enabled: true, limits: { per_run: 5, per_day: 12 },
  kpi: { today: 3, success_rate: 83, tried_7d: 12, ok_7d: 10, failed_7d: 2, ai_7d: 7, template_7d: 2, direct_7d: 1, fallback_7d: 3, platforms_7d: { facebook: 10, instagram: 0, tiktok: 0, zalo: 0, buyers: 24 } },
  days: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ date: `2026-11-${17 + i}`, label: `T${i + 2}`, red: i, yellow: 1 })),
  top_stores: [{ name: 'Cửa hàng 1', count: 9 }],
  queue: QUEUE,
  posts: [
    post(1, { external_url: 'https://example.com/bai-1' }),
    post(2, { status: 'failed', tier: null, error: 'Hết hạn token Fanpage', content: 'Bài lỗi hết hạn' }),
    post(3, { status: 'posted', tier: 'template', external_url: 'javascript:alert(1)' }),
    post(4, { status: 'queued', tier: null }),
  ],
};
const BUNDLE = (ids, over = {}) => ({
  items: ids.map((n) => item(n)), more_count: 1, message: 'Bài tổng hợp: 🔥 Món thử 1 · giảm 80%',
  link: 'https://example.com', hero_image_url: null, labels: { red: 2, yellow: 1 }, ...over,
});
const XSS = '<img src=x onerror="window.__xss=1">';

// state: overview = 'ok' | 'error' | 'empty' | 'xss'; run = 'sent' | 'direct' | 'failed'; preview = 'ok' | 'https' | 'http'
function makeApi(state) {
  return async (route, { path, method, body }) => {
    const bare = path.split('?')[0];
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/dashboard/work') return route.fulfill(ok(work));
    if (bare === '/marketing/admin/overview') {
      if (state.overview === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      if (state.overview === 'empty') return route.fulfill(ok({ ...OVERVIEW, queue: [], posts: [], kpi: { ...OVERVIEW.kpi, today: 0, success_rate: null, tried_7d: 0, ok_7d: 0, failed_7d: 0 } }));
      if (state.overview === 'xss') {
        return route.fulfill(ok({ ...OVERVIEW, central: { id: null, name: XSS }, queue: [item(1, { name: XSS, store_name: XSS })], posts: [post(1, { content: XSS, error: XSS, items: [item(1, { name: XSS, store_name: XSS })] })] }));
      }
      return route.fulfill(ok(state.data || OVERVIEW));
    }
    if (bare === '/marketing/admin/settings' && method === 'PATCH') {
      if (state.settings === 'error') return route.fulfill(fail(422, 'VALIDATION_ERROR', 'Không lưu được thiết lập'));
      return route.fulfill(ok({ ai_enabled: body.ai_enabled ?? true, auto_enabled: body.auto_enabled ?? true }));
    }
    if (bare === '/marketing/admin/preview' && method === 'POST') {
      if (state.preview === 'error') return route.fulfill(fail(409, 'RESOURCE_CONFLICT', 'Chưa có hàng nhãn đỏ/vàng nào còn bán để đăng'));
      if (state.preview === 'xss') return route.fulfill(ok(BUNDLE([1, 2, 3], { message: XSS })));
      if (state.preview === 'https') return route.fulfill(ok(BUNDLE([1, 2, 3], { hero_image_url: 'https://cdn.example.com/hero.jpg' })));
      if (state.preview === 'http') return route.fulfill(ok(BUNDLE([1, 2, 3], { hero_image_url: 'http://cdn.example.com/hero.jpg' })));
      return route.fulfill(ok(BUNDLE([1, 2, 3])));
    }
    if (bare === '/marketing/admin/run' && method === 'POST') {
      if (state.run === 'failed') return route.fulfill(ok({ status: 'failed', error: 'n8n không phản hồi', post_log_id: null }));
      if (state.run === 'direct') return route.fulfill(ok({ status: 'sent', via: 'direct', tier: 'direct', post_log_id: 'x' }));
      return route.fulfill(ok({ status: 'sent', via: 'n8n', post_log_id: 'x' }));
    }
    return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không có'));
  };
}

async function setup(page, init = {}) {
  const state = { overview: 'ok', run: 'sent', preview: 'ok', ...init.state };
  const stub = await stubAdmin(page, { api: makeApi(state), ignoreStatuses: init.ignoreStatuses || [], fakeSb: init.fakeSb });
  return { state, ...stub };
}

const overviewCalls = (calls) => calls.filter((c) => c.path === '/marketing/admin/overview');
const writes = (calls) => calls.filter((c) => c.method !== 'GET' && c.path.startsWith('/marketing/'));
const RAW = /\b(queued|posted|failed|template|direct|ai_enabled|auto_enabled|buyers|facebook|instagram|tiktok|zalo|recently_posted|red|yellow)\b/;
const root = (page) => page.locator('#screen [data-screen="marketing"]');

test('marketing: tổng quan hiện trạng thái AI, tự đăng, bài chờ, đã đăng hôm nay và giới hạn; không mã thô', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/marketing`);
  const r = root(page);
  await expect(r.locator('[data-kpi="ai"]')).toContainText('Bật');
  await expect(r.locator('[data-kpi="auto"]')).toContainText('Bật');
  await expect(r.locator('[data-kpi="queue"]')).toContainText('4');
  await expect(r.locator('[data-kpi="queue"]')).toContainText('2 nhãn đỏ');
  await expect(r.locator('[data-kpi="today"]')).toContainText('3');
  await expect(r.locator('[data-kpi="today"]')).toContainText('tối đa 12 bài mỗi ngày');
  await expect(r.locator('[data-kpi="rate"]')).toContainText('83%');
  await expect(r).toContainText('Fanpage MIO Thử');
  await expect(r).toContainText('Facebook');
  await expect(r).toContainText('Thông báo trong ứng dụng');
  expect(await r.innerText()).not.toMatch(RAW);
  expect(overviewCalls(calls)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('marketing: tab lưu trong hash, tab lạ rơi về tổng quan', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/marketing?tab=hack`);
  await expect(root(page).locator('[data-kpi="ai"]')).toBeVisible();
  await page.click('#screen [data-act="tab"][data-tab="queue"]');
  await expect(root(page).locator('[data-role="queue-table"]')).toBeVisible();
  expect(page.url()).toContain('tab=queue');
  await page.click('#screen [data-act="tab"][data-tab="history"]');
  await expect(root(page).locator('[data-role="history-table"]')).toBeVisible();
  await page.click('#screen [data-act="tab"][data-tab="settings"]');
  await expect(root(page).locator('[data-act="toggle"][data-key="auto_enabled"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('marketing: hàng chờ chọn sẵn 3 món chưa đăng gần đây, chọn thêm món thứ 4 bị chặn', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/marketing?tab=queue`);
  const rows = root(page).locator('[data-role="queue-table"] tbody tr');
  await expect(rows).toHaveCount(5);
  await expect(root(page).locator('[data-act="pick"]:checked')).toHaveCount(3);
  await expect(rows.nth(4)).toContainText('Vừa đăng');
  await expect(rows.nth(0)).toContainText('Nhãn đỏ');
  await expect(rows.nth(1)).toContainText('Nhãn vàng');
  await expect(rows.nth(0)).toContainText('Cửa hàng 1');
  await expect(rows.nth(0)).toContainText('6.000đ');
  await root(page).locator('[data-act="pick"][data-id="' + ID(4) + '"]').click();
  await expect(page.locator('#toasts')).toContainText('tối đa 3 món');
  await expect(root(page).locator('[data-act="pick"]:checked')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('marketing: Xem trước gửi đúng body, mở ngăn kéo với nội dung bài; ảnh https được hiện', async ({ page }) => {
  const { calls, errors } = await setup(page, { state: { preview: 'https' } });
  await page.route('https://cdn.example.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64') }));
  await page.goto(`${PAGE}#/marketing?tab=queue`);
  await expect(root(page).locator('[data-act="pick"]:checked')).toHaveCount(3);
  await page.click('#screen [data-act="preview"]');
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText('Xem trước bài đăng');
  await expect(drawer.locator('[data-role="preview-message"]')).toContainText('Bài tổng hợp');
  await expect(drawer).toContainText('Món thử 1');
  await expect(drawer.locator('img[src="https://cdn.example.com/hero.jpg"]')).toHaveCount(1);
  const call = calls.find((c) => c.path === '/marketing/admin/preview');
  expect(call.method).toBe('POST');
  expect(call.body).toEqual({ product_ids: [ID(1), ID(2), ID(3)] });
  expect(errors).toEqual([]);
});

test('marketing: ảnh http:// không được hiện trong xem trước', async ({ page }) => {
  const { errors } = await setup(page, { state: { preview: 'http' } });
  await page.goto(`${PAGE}#/marketing?tab=queue`);
  await page.click('#screen [data-act="preview"]');
  await expect(page.locator('#drawer [data-role="preview-message"]')).toBeVisible();
  await expect(page.locator('#drawer img')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('marketing: Xem trước lỗi hiện thông báo, không đóng màn', async ({ page }) => {
  const { errors } = await setup(page, { state: { preview: 'error' }, ignoreStatuses: [409] });
  await page.goto(`${PAGE}#/marketing?tab=queue`);
  await page.click('#screen [data-act="preview"]');
  await expect(page.locator('#toasts')).toContainText('Chưa có hàng nhãn đỏ/vàng');
  await expect(root(page).locator('[data-role="queue-table"]')).toBeVisible();
  expect(errors.filter((e) => !/409/.test(e))).toEqual([]);
});

test('marketing: Chạy thử ngay cần xác nhận mức nguy hiểm, gửi POST đúng body rồi tải lại', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/marketing?tab=queue`);
  await expect(root(page).locator('[data-act="pick"]:checked')).toHaveCount(3);
  await page.click('#screen [data-act="run"]');
  await expect(page.locator('#modal')).toContainText('Fanpage');
  await expect(page.locator('#modal [data-role="ok"]')).toHaveClass(/b-e/);
  await page.click('#modal [data-role="cancel"]');
  expect(writes(calls)).toHaveLength(0);
  await page.click('#screen [data-act="run"]');
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã gửi lệnh đăng');
  const call = writes(calls)[0];
  expect(call).toMatchObject({ method: 'POST', path: '/marketing/admin/run' });
  expect(call.body).toEqual({ product_ids: [ID(1), ID(2), ID(3)] });
  await expect.poll(() => overviewCalls(calls).length).toBe(2);
  expect(errors).toEqual([]);
});

test('marketing: Chạy thử đăng trực tiếp và đăng lỗi hiện đúng thông báo', async ({ page }) => {
  const { state, errors } = await setup(page, { state: { run: 'direct' } });
  await page.goto(`${PAGE}#/marketing?tab=queue`);
  await page.click('#screen [data-act="run"]');
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã đăng trực tiếp lên Fanpage');
  state.run = 'failed';
  await page.click('#screen [data-act="run"]');
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Chưa đăng được');
  expect(errors).toEqual([]);
});

test('marketing: bỏ chọn hết thì không bấm được Xem trước / Chạy thử', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/marketing?tab=queue`);
  for (const n of [1, 2, 3]) await root(page).locator(`[data-act="pick"][data-id="${ID(n)}"]`).uncheck();
  await expect(root(page).locator('[data-act="preview"]')).toBeDisabled();
  await expect(root(page).locator('[data-act="run"]')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('marketing: hàng chờ trống hiện thông báo', async ({ page }) => {
  const { errors } = await setup(page, { state: { overview: 'empty' } });
  await page.goto(`${PAGE}#/marketing?tab=queue`);
  await expect(root(page)).toContainText('Chưa có hàng nhãn đỏ/vàng nào còn bán');
  await expect(root(page).locator('[data-act="run"]')).toHaveCount(0);
  await page.click('#screen [data-act="tab"][data-tab="history"]');
  await expect(root(page)).toContainText('Chưa có bài tổng hợp nào');
  await page.click('#screen [data-act="tab"][data-tab="overview"]');
  await expect(root(page).locator('[data-kpi="rate"]')).toContainText('—');
  expect(errors).toEqual([]);
});

test('marketing: lịch sử có nhãn Việt, lọc theo trạng thái và tìm kiếm, mở chi tiết trong ngăn kéo', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/marketing?tab=history`);
  const rows = root(page).locator('[data-role="history-table"] tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Đã đăng');
  await expect(rows.nth(0)).toContainText('AI viết');
  await expect(rows.nth(1)).toContainText('Lỗi');
  await expect(root(page).locator('[data-role="history-table"]')).not.toContainText('Hết hạn token Fanpage'); // lỗi gốc chỉ trong ngăn kéo
  await expect(rows.nth(2)).toContainText('Caption mẫu');
  await expect(rows.nth(3)).toContainText('Đang xử lý');
  expect(await root(page).innerText()).not.toMatch(RAW);
  await page.selectOption('#screen [name="status"]', 'failed');
  await expect(rows).toHaveCount(1);
  await page.selectOption('#screen [name="status"]', '');
  await page.fill('#screen [name="q"]', 'không-có-món-này');
  await expect(root(page).locator('[data-role="history-table"] tbody')).toContainText('Không có bài nào phù hợp');
  await page.fill('#screen [name="q"]', '');
  await expect(rows).toHaveCount(4);
  await rows.nth(1).click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText('Chi tiết bài đăng');
  await expect(drawer).toContainText('Lỗi gốc từ hệ thống đăng');
  await expect(drawer).toContainText('Hết hạn token Fanpage');
  await expect(drawer).toContainText('Bài lỗi hết hạn');
  await expect(drawer).toContainText('Món thử 1');
  expect(errors).toEqual([]);
});

test('marketing: chi tiết bài chỉ cho liên kết https, bỏ javascript:', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/marketing?tab=history`);
  const rows = root(page).locator('[data-role="history-table"] tbody tr');
  await rows.nth(0).click();
  await expect(page.locator('#drawer a[href="https://example.com/bai-1"]')).toHaveCount(1);
  await rows.nth(2).click();
  await expect(page.locator('#drawer')).toContainText('Chi tiết bài đăng');
  await expect(page.locator('#drawer a')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('marketing: bật/tắt tự đăng cần xác nhận và gửi PATCH đúng body; tắt AI tương tự', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/marketing?tab=settings`);
  const auto = root(page).locator('[data-act="toggle"][data-key="auto_enabled"]');
  await expect(auto).toContainText('Tắt tự đăng');
  await auto.click();
  await expect(page.locator('#modal')).toContainText('tự đăng');
  await page.click('#modal [data-role="cancel"]');
  expect(writes(calls)).toHaveLength(0);
  await auto.click();
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã tắt tự đăng');
  expect(writes(calls)[0]).toMatchObject({ method: 'PATCH', path: '/marketing/admin/settings', body: { auto_enabled: false } });
  await expect.poll(() => overviewCalls(calls).length).toBe(2);
  const ai = root(page).locator('[data-act="toggle"][data-key="ai_enabled"]');
  await ai.click();
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã tắt AI');
  expect(writes(calls)[1]).toMatchObject({ method: 'PATCH', path: '/marketing/admin/settings', body: { ai_enabled: false } });
  expect(errors).toEqual([]);
});

test('marketing: thiết lập lỗi hiện toast và không đổi trạng thái', async ({ page }) => {
  const { errors } = await setup(page, { state: { settings: 'error' }, ignoreStatuses: [422] });
  await page.goto(`${PAGE}#/marketing?tab=settings`);
  await root(page).locator('[data-act="toggle"][data-key="auto_enabled"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Không lưu được thiết lập');
  await expect(root(page).locator('[data-act="toggle"][data-key="auto_enabled"]')).toBeEnabled();
  expect(errors.filter((e) => !/422/.test(e))).toEqual([]);
});

test('marketing: API lỗi 500 → ui.error có nút Thử lại', async ({ page }) => {
  const { state, errors } = await setup(page, { state: { overview: 'error' }, ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/marketing`);
  const retry = page.locator('#screen').getByRole('button', { name: 'Thử lại' });
  await expect(retry).toBeVisible();
  state.overview = 'ok';
  await retry.click();
  await expect(root(page).locator('[data-kpi="ai"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('marketing: dữ liệu có thẻ HTML không chạy mã, vẫn escape đúng', async ({ page }) => {
  const { errors } = await setup(page, { state: { overview: 'xss' } });
  await page.goto(`${PAGE}#/marketing?tab=queue`);
  await expect(root(page).locator('[data-role="queue-table"]')).toContainText(XSS);
  await page.click('#screen [data-act="tab"][data-tab="history"]');
  await root(page).locator('[data-role="history-table"] tbody tr').first().click();
  await expect(page.locator('#drawer')).toContainText(XSS);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator('#screen img[src="x"], #drawer img[src="x"]').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('marketing: tổng quan làm mới mỗi 120 giây, tab lịch sử thì không làm mới', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.clock.install();
  await page.goto(`${PAGE}#/marketing`);
  await expect(root(page).locator('[data-kpi="ai"]')).toBeVisible();
  const advance = async (ms) => {
    for (let t = 0; t < ms; t += 10000) {
      await page.keyboard.press('Shift');
      await page.clock.runFor(10000);
      await page.waitForTimeout(40);
    }
  };
  await advance(60000);
  expect(overviewCalls(calls)).toHaveLength(1);
  await advance(70000);
  expect(overviewCalls(calls)).toHaveLength(2);
  await page.click('#screen [data-act="tab"][data-tab="history"]');
  await expect(root(page).locator('[data-role="history-table"]')).toBeVisible();
  const afterTab = overviewCalls(calls).length;
  await advance(250000);
  expect(overviewCalls(calls)).toHaveLength(afterTab);
  expect(errors).toEqual([]);
});

const advanceBy = async (page, ms) => {
  for (let t = 0; t < ms; t += 10000) {
    await page.keyboard.press('Shift');
    await page.clock.runFor(10000);
    await page.waitForTimeout(40);
  }
};

test('marketing: Chạy thử — poll đổi hàng chờ khi hộp xác nhận đang mở → hủy, KHÔNG gửi POST run, có toast giải thích', async ({ page }) => {
  const { state, calls, errors } = await setup(page);
  await page.clock.install();
  await page.goto(`${PAGE}#/marketing?tab=queue`);
  await expect(root(page).locator('[data-act="pick"]:checked')).toHaveCount(3);
  await page.click('#screen [data-act="run"]');
  await expect(page.locator('#modal')).toContainText('Món thử 1, Món thử 2, Món thử 3');
  // Hàng chờ mới không còn 3 món đã chọn; poll 120 giây vẽ lại màn
  state.data = { ...OVERVIEW, queue: [item(4), item(5)] };
  await advanceBy(page, 130000);
  await expect.poll(() => overviewCalls(calls).length).toBeGreaterThanOrEqual(2);
  await expect(root(page).locator('[data-act="pick"]:checked')).toHaveCount(0); // picks bị lọc rỗng theo hàng chờ mới: đúng kịch bản gây lỗi cũ
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Hàng chờ vừa thay đổi');
  expect(writes(calls)).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('marketing: Chạy thử — poll không đổi hàng chờ thì vẫn gửi đúng ids đã chụp trước hộp xác nhận', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.clock.install();
  await page.goto(`${PAGE}#/marketing?tab=queue`);
  await expect(root(page).locator('[data-act="pick"]:checked')).toHaveCount(3);
  await page.click('#screen [data-act="run"]');
  await advanceBy(page, 130000);
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã gửi lệnh đăng');
  expect(writes(calls)).toHaveLength(1);
  expect(writes(calls)[0].body).toEqual({ product_ids: [ID(1), ID(2), ID(3)] });
  expect(errors).toEqual([]);
});

test('marketing: caption xem trước chứa thẻ HTML không chạy mã, không sinh img lạ', async ({ page }) => {
  const { errors } = await setup(page, { state: { preview: 'xss' } });
  await page.goto(`${PAGE}#/marketing?tab=queue`);
  await page.click('#screen [data-act="preview"]');
  await expect(page.locator('#drawer [data-role="preview-message"]')).toContainText(XSS);
  await expect(page.locator('#drawer img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('marketing: poll chạy khi ngăn kéo xem trước đang mở → ngăn kéo giữ nguyên, ô đã chọn không mất', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.clock.install();
  await page.goto(`${PAGE}#/marketing?tab=queue`);
  await root(page).locator(`[data-act="pick"][data-id="${ID(3)}"]`).click(); // bỏ chọn món 3 → còn 2 món
  await page.click('#screen [data-act="preview"]');
  await expect(page.locator('#drawer [data-role="preview-message"]')).toBeVisible();
  await advanceBy(page, 130000);
  await expect.poll(() => overviewCalls(calls).length).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#drawer [data-role="preview-message"]')).toContainText('Bài tổng hợp');
  await expect(root(page).locator('[data-act="pick"]:checked')).toHaveCount(2);
  await expect(root(page).locator(`[data-act="pick"][data-id="${ID(3)}"]`)).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('marketing: thời gian còn lại tính theo tổng phút (không ra "60 phút")', async ({ page }) => {
  const { errors } = await setup(page, { state: { data: { ...OVERVIEW, queue: [item(1, { hours_left: 1.999 }), item(2, { hours_left: 0.5 })] } } });
  await page.goto(`${PAGE}#/marketing?tab=queue`);
  const rows = root(page).locator('[data-role="queue-table"] tbody tr');
  await expect(rows.nth(0)).toContainText('2 giờ 0 phút');
  await expect(rows.nth(1)).toContainText('30 phút');
  expect(await root(page).innerText()).not.toContain('60 phút');
  expect(errors).toEqual([]);
});

test('marketing: ?demo=1 mở được màn bằng dữ liệu mẫu, không gọi API thật', async ({ page }) => {
  const { calls, errors } = await setup(page, { fakeSb: { noSession: true } });
  await page.goto(`${PAGE}?demo=1#/marketing?tab=queue`);
  await expect(root(page).locator('[data-role="queue-table"] tbody tr').first()).toContainText('Bánh mì thịt nguội');
  await page.click('#screen [data-act="preview"]');
  await expect(page.locator('#drawer [data-role="preview-message"]')).toContainText('MIO');
  await page.click('#screen [data-act="tab"][data-tab="history"]');
  await expect(root(page).locator('[data-role="history-table"] tbody tr').first()).toContainText('Đã đăng');
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
