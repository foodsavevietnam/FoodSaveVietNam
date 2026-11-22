import { expect, test } from '@playwright/test';
import { FAKE_SUPABASE } from './helpers/fake-supabase.mjs';

// Task 7: tab "Bản đồ theo dõi" của trang quản trị (/quan-tri). Auth Supabase và API đều được stub.
const NOW = new Date('2026-11-22T10:00:00Z');
const ok = data => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const minutesAgo = m => new Date(NOW.getTime() - m * 60000).toISOString();

function row(over = {}) {
  return {
    actor_kind: 'volunteer', actor_id: 'v1', name: 'TNV Một', context_kind: 'donation', context_id: 'd1', context_code: 'DN-1001',
    lat: 10.7769, lng: 106.7009, accuracy_m: 15, updated_at: minutesAgo(1),
    destination: { lat: 10.78, lng: 106.69, label: 'Tiệm thử' },
    directions_url: 'https://www.google.com/maps/dir/?api=1&destination=10.78,106.69', ...over,
  };
}
const DEFAULT_ROWS = () => [
  row(),
  row({ actor_kind: 'customer', actor_id: 'c1', name: 'Khách Hai', context_kind: 'order', context_id: 'o1', context_code: 'MIO-2002', lat: 10.7800, lng: 106.7100, updated_at: minutesAgo(8) }),
];

async function setup(page, state = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  state.calls = [];
  state.rows = state.rows || DEFAULT_ROWS();
  await page.clock.install({ time: NOW });
  await page.route('**/@supabase/supabase-js**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_SUPABASE }));
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
    if (path === '/admin/live-locations') {
      state.calls.push({ auth: route.request().headers().authorization, url: route.request().url() });
      if (state.fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'INTERNAL', message: 'Lỗi' } }) });
      return route.fulfill(ok(state.rows));
    }
    if (path === '/admin/users') return route.fulfill(ok({ buyers: [] }));
    // Các API admin khác của trang (dashboard, ESG, nhãn...) không thuộc phạm vi test: trả lỗi để trang tự hiện thông báo.
    if (path.startsWith('/admin/')) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'INTERNAL', message: 'Không thuộc test' } }) });
    return route.fulfill(ok({ items: [] }));
  });
  await page.goto('/quan-tri');
  await expect(page.locator('.S-i[data-p="tracking"]')).toBeVisible();
  return errors;
}

const openTab = page => page.click('.S-i[data-p="tracking"]');

test('tab theo dõi hiện 2 marker + 2 dòng, lọc Người mua còn 1, không lỗi', async ({ page }) => {
  const state = {};
  const errors = await setup(page, state);
  await expect(page.locator('.S-i[data-p="tracking"]')).toHaveText(/Bản đồ theo dõi/);
  await openTab(page);
  await expect(page.locator('#trk-list .trk-row')).toHaveCount(2);
  await expect(page.locator('#trk-map .leaflet-marker-icon')).toHaveCount(2);
  expect(state.calls[0].auth).toBe('Bearer admin-token');
  await expect(page.locator('#trk-list')).toContainText('DN-1001');
  await expect(page.locator('#trk-list')).toContainText('MIO-2002');
  await expect(page.locator('#trk-list')).toContainText('1 phút trước');
  await expect(page.locator('#trk-list a[href^="https://"]').first()).toHaveText(/Chỉ đường/);
  await page.click('[data-trk-filter="customer"]');
  await expect(page.locator('#trk-list .trk-row')).toHaveCount(1);
  await expect(page.locator('#trk-map .leaflet-marker-icon')).toHaveCount(1);
  await expect(page.locator('#trk-list .trk-row')).toContainText('Khách Hai');
  await page.click('[data-trk-filter="volunteer"]');
  await expect(page.locator('#trk-list .trk-row')).toHaveCount(1);
  await expect(page.locator('#trk-list .trk-row')).toContainText('TNV Một');
  await page.click('[data-trk-filter="all"]');
  await expect(page.locator('#trk-list .trk-row')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('dòng cập nhật > 5 phút bị làm mờ, dòng mới thì không', async ({ page }) => {
  await setup(page);
  await openTab(page);
  await expect(page.locator('#trk-list .trk-row')).toHaveCount(2);
  await expect(page.locator('#trk-list .trk-row[data-actor="v1"]')).toHaveAttribute('data-stale', '0');
  await expect(page.locator('#trk-list .trk-row[data-actor="c1"]')).toHaveAttribute('data-stale', '1');
  await expect(page.locator('#trk-map .trk-pin.stale')).toHaveCount(1);
});

test('poll 20 giây, dừng khi tab ẩn và khi rời trang', async ({ page }) => {
  const state = {};
  await setup(page, state);
  await openTab(page);
  await expect(page.locator('#trk-list .trk-row')).toHaveCount(2);
  const n0 = state.calls.length;
  await page.clock.runFor(20100);
  await expect.poll(() => state.calls.length).toBe(n0 + 1);
  await page.clock.runFor(20100);
  await expect.poll(() => state.calls.length).toBe(n0 + 2);

  // Tab ẩn: không poll
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(65000);
  expect(state.calls.length).toBe(n0 + 2);
  // Hiện lại: tải ngay và poll tiếp
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => state.calls.length).toBe(n0 + 3);
  await page.clock.runFor(20100);
  await expect.poll(() => state.calls.length).toBe(n0 + 4);

  // Rời trang: dừng poll, gỡ bản đồ
  await page.click('.S-i[data-p="dashboard"]');
  await page.clock.runFor(65000);
  expect(state.calls.length).toBe(n0 + 4);
  await expect(page.locator('#trk-map')).toHaveCount(0);
});

test('tải lỗi hiện cảnh báo dữ liệu cũ và làm mờ', async ({ page }) => {
  const state = {};
  await setup(page, state);
  await openTab(page);
  await expect(page.locator('#trk-list .trk-row')).toHaveCount(2);
  await expect(page.locator('#trk-list .trk-row[data-actor="v1"]')).toHaveAttribute('data-stale', '0');
  state.fail = true;
  await page.clock.runFor(20100);
  await expect(page.locator('#trk-status')).toContainText('Không tải được');
  await expect(page.locator('#trk-list .trk-row[data-actor="v1"]')).toHaveAttribute('data-stale', '1');
  state.fail = false;
  await page.clock.runFor(20100);
  await expect(page.locator('#trk-status')).not.toContainText('Không tải được');
  await expect(page.locator('#trk-list .trk-row[data-actor="v1"]')).toHaveAttribute('data-stale', '0');
});

test('tên chứa HTML không chạy mã, link không phải https bị bỏ', async ({ page }) => {
  const evil = '<img src=x onerror="window.__xss=1">';
  const errors = await setup(page, { rows: [row({ name: evil, context_code: '<b onmouseover="window.__xss=1">X</b>', directions_url: 'javascript:window.__xss=1' })] });
  await openTab(page);
  await expect(page.locator('#trk-list .trk-row')).toHaveCount(1);
  await expect(page.locator('#trk-list .trk-row')).toContainText('<img src=x');
  await expect(page.locator('#trk-list a')).toHaveCount(0);
  await page.locator('#trk-map .leaflet-marker-icon').first().click();
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

// ---------- Giới hạn chi phí: dừng khi không thao tác 15 phút, timeout, giữ zoom/popup ----------
test('không thao tác 15 phút thì dừng poll, hiện nút "Bấm để tiếp tục cập nhật"; bấm thì tải lại và poll tiếp', async ({ page }) => {
  const state = {};
  const errors = await setup(page, state);
  await openTab(page);
  await expect(page.locator('#trk-list .trk-row')).toHaveCount(2);
  // Thao tác ở phút thứ 10 làm mốc rảnh tính lại
  await page.clock.runFor(10 * 60000);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })));
  await page.clock.runFor(10 * 60000);
  const resume = page.locator('[data-trk-resume]');
  await expect(resume).toBeHidden();
  await page.clock.runFor(6 * 60000);
  await expect(resume).toBeVisible();
  await expect(resume).toHaveText(/Bấm để tiếp tục cập nhật/);
  const stopped = state.calls.length;
  await page.clock.runFor(5 * 60000);
  expect(state.calls.length).toBe(stopped);
  await resume.click();
  await expect.poll(() => state.calls.length).toBe(stopped + 1);
  await expect(resume).toBeHidden();
  await page.clock.runFor(20100);
  await expect.poll(() => state.calls.length).toBe(stopped + 2);
  expect(errors).toEqual([]);
});

test('máy chủ treo thì sau 15 giây bỏ chờ, báo lỗi, lần poll sau vẫn chạy', async ({ page }) => {
  const state = {};
  await setup(page, state);
  await page.route('**/api/v1/admin/live-locations', async route => {
    state.calls.push({ hang: state.hang });
    if (state.hang) return; // không bao giờ trả lời
    return route.fulfill(ok(state.rows));
  });
  await openTab(page);
  await expect(page.locator('#trk-list .trk-row')).toHaveCount(2);
  state.hang = true;
  await page.clock.runFor(20100);
  await expect.poll(() => state.calls.length).toBe(2);
  await page.clock.runFor(15100);
  await expect(page.locator('#trk-status')).toContainText('Không tải được');
  state.hang = false;
  await page.clock.runFor(20100);
  await expect.poll(() => state.calls.length).toBe(3);
  await expect(page.locator('#trk-status')).not.toContainText('Không tải được');
});

test('làm mới không đổi zoom và giữ popup đang mở; đổi bộ lọc thì canh lại', async ({ page }) => {
  const state = {};
  const errors = await setup(page, state);
  await openTab(page);
  await expect(page.locator('#trk-map .leaflet-marker-icon')).toHaveCount(2);
  await page.evaluate(() => TRK.map.setZoom(9, { animate: false }));
  await page.locator('#trk-map .leaflet-marker-icon').first().click();
  await expect(page.locator('#trk-map .leaflet-popup')).toHaveCount(1);
  const n = state.calls.length;
  await page.clock.runFor(20100);
  await expect.poll(() => state.calls.length).toBe(n + 1);
  await page.clock.runFor(500);
  expect(await page.evaluate(() => TRK.map.getZoom())).toBe(9);
  await expect(page.locator('#trk-map .leaflet-popup')).toHaveCount(1);
  await page.click('[data-trk-filter="customer"]');
  expect(await page.evaluate(() => TRK.map.getZoom())).not.toBe(9);
  expect(errors).toEqual([]);
});

test('tab hiện lại ngay sau một lần tải thì không tải thêm (giãn cách tối thiểu); lockAdmin xóa dữ liệu vị trí', async ({ page }) => {
  const state = {};
  await setup(page, state);
  await openTab(page);
  await expect(page.locator('#trk-list .trk-row')).toHaveCount(2);
  const n = state.calls.length;
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(1000);
  expect(state.calls.length).toBe(n);
  await page.evaluate(() => lockAdmin('Hết phiên'));
  expect(await page.evaluate(() => TRK.rows.length)).toBe(0);
});
