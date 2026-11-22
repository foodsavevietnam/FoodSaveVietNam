import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';
import work from '../../public/admin/demo/fixtures/work.js';
import finance from '../../public/admin/demo/fixtures/finance.js';
import labels from '../../public/admin/demo/fixtures/labels.js';
import esg from '../../public/admin/demo/fixtures/esg.js';
import automation from '../../public/admin/demo/fixtures/automation.js';

// Ngân sách gọi API của cổng quản trị (hạn mức Netlify 125k lượt/tháng): tab mở ở màn Hôm nay phải tốn
// ≤ 6 lượt/phút khi có người thao tác (≤ 30 lượt trong 5 phút) và 0 lượt khi tab ẩn hoặc rảnh 15 phút.
// Đếm mọi request /api/v1 bằng page.route, thời gian giả bằng page.clock.
const PAGE = '/admin/index.html';
const MIN = 60000;
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };
const ROUTES = {
  '/profile/me': ADMIN,
  '/admin/dashboard/work': work,
  '/admin/finance/summary': finance,
  '/admin/labels': labels,
  '/admin/esg': esg,
  '/admin/automation': automation,
};

const settle = (page) => page.waitForTimeout(80); // cho request đang bay xử lý xong (đồng hồ trang đứng yên)

async function activeFor(page, ms, stepMs = 10000) {
  for (let t = 0; t < ms; t += stepMs) {
    await page.keyboard.press('Shift');
    await page.clock.runFor(stepMs);
    await settle(page);
  }
}

async function idleFor(page, ms, stepMs = MIN) {
  for (let t = 0; t < ms; t += stepMs) {
    await page.clock.runFor(stepMs);
    await settle(page);
  }
}

async function setVisibility(page, state) {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s !== 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

async function openToday(page) {
  const { calls, errors } = await stubAdmin(page, {
    api: (route, { path }) => {
      const bare = path.split('?')[0];
      return bare in ROUTES ? route.fulfill(ok(ROUTES[bare])) : route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Không có' } }) });
    },
    fakeSb: {},
  });
  await page.clock.install();
  await page.goto(`${PAGE}#/today`);
  await expect(page.locator('#screen [data-block="finance"]')).toContainText('480.000đ');
  await expect(page.locator('#screen [data-role="work"] [data-act="go"]').first()).toBeVisible();
  await activeFor(page, 10000, 5000); // lượt tải đầu không tính vào ngân sách theo phút
  return { calls, errors };
}

const note = (info, text) => info.annotations.push({ type: 'ngân sách', description: text });

test('today: có thao tác 5 phút → ≤ 30 lượt gọi API; bấm vào trang sau khi tạm dừng → ≤ 6 lượt trong 2 giây đầu rồi về nhịp thường', async ({ page }, info) => {
  const { calls, errors } = await openToday(page);

  const start = calls.length;
  await activeFor(page, 5 * MIN);
  const used = calls.slice(start);
  const byPath = (re) => used.filter((c) => re.test(c.path)).length;
  note(info, `Hôm nay, 5 phút có thao tác: ${used.length} lượt (${(used.length / 5).toFixed(1)}/phút): work ${byPath(/dashboard\/work/)}, finance ${byPath(/finance/)}, labels ${byPath(/labels/)}, esg ${byPath(/esg/)}, automation ${byPath(/automation/)}`);
  expect(used.length).toBeLessThanOrEqual(30);
  expect(byPath(/dashboard\/work/)).toBeGreaterThanOrEqual(4); // số việc vẫn được làm mới mỗi phút
  expect(byPath(/dashboard\/work/)).toBeLessThanOrEqual(6);
  expect(byPath(/finance\/summary/)).toBeGreaterThanOrEqual(2); // 4 khối còn lại làm mới mỗi 2 phút
  expect(byPath(/finance\/summary/)).toBeLessThanOrEqual(3);

  // Không thao tác 16 phút → tạm dừng, thấy thanh thông báo; thêm 4 phút nữa vẫn 0 lượt
  await idleFor(page, 16 * MIN);
  await expect(page.locator('.poll-paused')).toBeVisible();
  const afterGate = calls.length;
  await idleFor(page, 4 * MIN);
  note(info, `Hôm nay, rảnh 4 phút sau mốc 15 phút: ${calls.length - afterGate} lượt`);
  expect(calls.length - afterGate).toBe(0);

  // Bấm vào trang: làm mới ngay, tối đa 6 lượt trong 2 giây đầu
  await page.mouse.click(5, 5);
  await expect(page.locator('.poll-paused')).toBeHidden();
  await page.clock.runFor(2000);
  await settle(page);
  const burst = calls.length - afterGate;
  note(info, `Hôm nay, bấm vào trang sau khi tạm dừng: ${burst} lượt trong 2 giây đầu`);
  expect(burst).toBeGreaterThanOrEqual(1);
  expect(burst).toBeLessThanOrEqual(6);

  // Về nhịp thường: 2 phút kế tiếp có thao tác ≤ 12 lượt
  const resumed = calls.length;
  await activeFor(page, 2 * MIN);
  note(info, `Hôm nay, 2 phút sau khi tiếp tục: ${calls.length - resumed} lượt`);
  expect(calls.length - resumed).toBeLessThanOrEqual(12);
  expect(errors).toEqual([]);
});

test('today: tab ẩn 5 phút → 0 lượt gọi API; hiện lại thì làm mới một lượt', async ({ page }, info) => {
  const { calls, errors } = await openToday(page);
  await setVisibility(page, 'hidden');
  await settle(page);
  const hiddenAt = calls.length;
  await activeFor(page, 5 * MIN);
  note(info, `Hôm nay, tab ẩn 5 phút: ${calls.length - hiddenAt} lượt`);
  expect(calls.length - hiddenAt).toBe(0);

  await setVisibility(page, 'visible');
  await page.clock.runFor(2000);
  await settle(page);
  const back = calls.length - hiddenAt;
  note(info, `Hôm nay, hiện lại tab: ${back} lượt trong 2 giây đầu`);
  expect(back).toBeGreaterThanOrEqual(1);
  expect(back).toBeLessThanOrEqual(6);
  expect(errors).toEqual([]);
});
