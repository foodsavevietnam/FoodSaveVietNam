import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';

// Màn "Bản đồ theo dõi" của cổng quản trị mới (/admin). Leaflet được thay bằng bản giả (không dùng mạng ngoài).
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

const rows = () => [
  { actor_kind: 'volunteer', actor_id: 'v1', name: 'TNV Một', context_kind: 'donation', context_id: 'd1', context_code: 'DN-1001', lat: 10.7769, lng: 106.7009, accuracy_m: 15, updated_at: minutesAgo(1), destination: { lat: 10.78, lng: 106.69, label: 'Tiệm thử' }, directions_url: 'https://www.google.com/maps/dir/?api=1&destination=10.78,106.69' },
  { actor_kind: 'customer', actor_id: 'c1', name: 'Khách Hai', context_kind: 'order', context_id: 'o1', context_code: 'MIO-2002', lat: 10.78, lng: 106.71, accuracy_m: 20, updated_at: minutesAgo(8), destination: null, directions_url: 'javascript:alert(1)' },
];

// Leaflet giả: đếm marker đã thêm và số lần map.remove().
const FAKE_LEAFLET = `
window.__fl = { markers: 0, removed: 0, maps: 0, alive: 0, maxAlive: 0 };
window.L = {
  map(el) {
    if (el.__flMap) throw new Error('Map container is already initialized.');
    el.__flMap = 1;
    const f = window.__fl;
    f.maps += 1; f.alive += 1; f.maxAlive = Math.max(f.maxAlive, f.alive);
    return { setView() {}, fitBounds() {}, invalidateSize() {}, hasLayer() { return true; }, removeLayer() {}, addLayer() {}, remove() { el.__flMap = 0; f.removed += 1; f.alive -= 1; } };
  },
  tileLayer() { return { on() {}, addTo() { return this; } }; },
  layerGroup() { const items = []; return { addTo() { return this; }, clearLayers() { items.length = 0; window.__fl.markers = 0; document.querySelectorAll('.fake-marker').forEach((n) => n.remove()); }, eachLayer(fn) { items.forEach(fn); }, addLayer(m) { items.push(m); } }; },
  divIcon(o) { return o; },
  marker(_p, o) { const m = { opts: o, bindPopup() { return m; }, addTo(layer) { layer.addLayer(m); window.__fl.markers += 1; document.querySelector('[data-role="map"]').insertAdjacentHTML('beforeend', '<i class="fake-marker">' + o.icon.html + '</i>'); return m; }, openPopup() {}, isPopupOpen() { return false; } }; return m; },
};
`;

async function setup(page, { rowsData = rows(), leaflet = true, ...opts } = {}) {
  const state = { rows: rowsData, fail: false, locCalls: 0 };
  const api = async (route, { path }) => {
    const bare = path.split('?')[0];
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/live-locations') {
      state.locCalls += 1;
      if (state.fail) return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      return route.fulfill(ok(state.rows));
    }
    if (bare === '/admin/dashboard/work') return route.fulfill(ok({}));
    return route.fulfill(ok({}));
  };
  const stub = await stubAdmin(page, { api, ...opts });
  if (leaflet) {
    await page.route('**/leaflet@1.9.4/**', (route) => (route.request().url().endsWith('.css')
      ? route.fulfill({ status: 200, contentType: 'text/css', body: '' })
      : route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_LEAFLET })));
  } else {
    await page.route('**/leaflet@1.9.4/**', (route) => route.fulfill({ status: 404, body: '' }));
  }
  return { state, ...stub };
}

test('tải vị trí thật: 2 dòng, 2 marker, nhãn tiếng Việt, lọc Người mua còn 1, chỉ nhận link https', async ({ page }) => {
  const { errors, calls } = await setup(page);
  await page.goto(`${PAGE}#/tracking`);
  await expect(page.locator('.trk-row')).toHaveCount(2);
  const list = page.locator('[data-role="list"]');
  await expect(list).toContainText('TNV Một');
  await expect(list).toContainText('Tình nguyện viên · Lô DN-1001');
  await expect(list).toContainText('Đơn MIO-2002');
  await expect(list).toContainText('1 phút trước');
  await expect(list).toContainText('Đang tới: Tiệm thử');
  await expect(list).not.toContainText('volunteer');
  await expect(list).not.toContainText('donation');
  await expect(page.locator('.trk-row a[href^="https://"]')).toHaveCount(1);
  await expect(page.locator('.trk-row a[href^="javascript"]')).toHaveCount(0);
  await expect(page.locator('.fake-marker')).toHaveCount(2);
  await expect(page.locator('.trk-row[data-kind="volunteer"]')).toHaveAttribute('data-stale', '0');
  await expect(page.locator('.trk-row[data-kind="customer"]')).toHaveAttribute('data-stale', '1');
  expect(calls.some((c) => c.path === '/admin/live-locations')).toBe(true);

  await page.click('[data-act="filter"][data-kind="customer"]');
  await expect(page.locator('.trk-row')).toHaveCount(1);
  await expect(page.locator('.fake-marker')).toHaveCount(1);
  expect(page.url()).toContain('kind=customer');
  expect(errors).toEqual([]);
});

test('mờ khi cập nhật hơn 5 phút', async ({ page }) => {
  const old = rows();
  old[1].updated_at = minutesAgo(9 * 60);
  old[1].directions_url = null;
  const { errors } = await setup(page, { rowsData: old });
  await page.goto(`${PAGE}#/tracking`);
  await expect(page.locator('.trk-row[data-kind="customer"]')).toHaveAttribute('data-stale', '1');
  await expect(page.locator('.trk-row[data-kind="volunteer"]')).toHaveAttribute('data-stale', '0');
  await expect(page.locator('.trk-row[data-kind="customer"]')).toContainText('9 giờ trước');
  expect(errors).toEqual([]);
});

test('không nạp được Leaflet: vẫn hiện danh sách và báo "Không tải được bản đồ"', async ({ page }) => {
  const { errors } = await setup(page, { leaflet: false });
  await page.goto(`${PAGE}#/tracking`);
  await expect(page.locator('.trk-row')).toHaveCount(2);
  await expect(page.locator('[data-role="map"]')).toContainText('Không tải được bản đồ');
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});

test('rời màn: gỡ bản đồ (map.remove) và thẻ style', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/tracking`);
  await expect(page.locator('.fake-marker')).toHaveCount(2);
  await expect(page.locator('style[data-screen="tracking"]')).toHaveCount(1);
  await page.evaluate(() => { location.hash = '#/audit'; });
  await expect(page.locator('[data-screen="tracking"]')).toHaveCount(0);
  await expect(page.locator('style[data-screen="tracking"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__fl.removed)).toBe(1);
  expect(errors).toEqual([]);
});

test('API lỗi 500 → báo lỗi có nút Thử lại, bấm lại thành công', async ({ page }) => {
  const { state, errors } = await setup(page, { ignoreStatuses: [500] });
  state.fail = true;
  await page.goto(`${PAGE}#/tracking`);
  await expect(page.getByRole('alert')).toContainText('Lỗi máy chủ');
  state.fail = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.locator('.trk-row')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('không có ai chia sẻ → câu trạng thái rỗng', async ({ page }) => {
  const { errors } = await setup(page, { rowsData: [] });
  await page.goto(`${PAGE}#/tracking`);
  await expect(page.locator('[data-role="list"]')).toContainText('Chưa có ai chia sẻ vị trí');
  expect(errors).toEqual([]);
});

test('?demo=1 mở được màn, không gọi /api/v1', async ({ page }) => {
  const { calls, errors } = await setup(page, { fakeSb: { noSession: true } });
  await page.goto(`${PAGE}?demo=1#/tracking`);
  await expect(page.locator('.trk-row')).toHaveCount(2);
  await expect(page.locator('[data-role="list"]')).toContainText('Người mua mẫu B');
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});

test('vào → sang màn khác → quay lại nhanh 2 lần: không lỗi, tối đa 1 bản đồ sống', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/tracking`);
  await expect(page.locator('.fake-marker')).toHaveCount(2);
  for (let i = 0; i < 2; i += 1) {
    await page.evaluate(() => { location.hash = '#/audit'; });
    await page.evaluate(() => { location.hash = '#/tracking'; });
  }
  await expect(page.locator('.trk-row')).toHaveCount(2);
  await expect(page.locator('.fake-marker')).toHaveCount(2);
  const fl = await page.evaluate(() => window.__fl);
  expect(fl.maxAlive).toBe(1);
  expect(fl.alive).toBe(1);
  expect(errors.filter((e) => /already initialized/.test(e))).toEqual([]);
  expect(errors).toEqual([]);
});

test('rời màn rồi tua 60 giây: không gọi thêm /admin/live-locations', async ({ page }) => {
  await page.clock.install();
  const { state, errors } = await setup(page);
  await page.goto(`${PAGE}#/tracking`);
  await expect(page.locator('.trk-row')).toHaveCount(2);
  await page.evaluate(() => { location.hash = '#/audit'; });
  await expect(page.locator('[data-screen="tracking"]')).toHaveCount(0);
  const before = state.locCalls;
  await page.clock.runFor(60000);
  expect(state.locCalls).toBe(before);
  expect(errors).toEqual([]);
});

test('tên chứa HTML độc không chạy mã: danh sách và popup', async ({ page }) => {
  const evil = rows();
  evil[0].name = '<img src=x onerror="window.__xss=1">';
  evil[0].destination.label = '<img src=x onerror="window.__xss=1">';
  const { errors } = await setup(page, { rowsData: evil });
  await page.goto(`${PAGE}#/tracking`);
  await expect(page.locator('.trk-row')).toHaveCount(2);
  await expect(page.locator('.trk-row img')).toHaveCount(0);
  await expect(page.locator('[data-screen="tracking"] img')).toHaveCount(0);
  await expect(page.locator('.trk-name').first()).toContainText('<img src=x');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('đã có window.L thì không chèn lại script leaflet', async ({ page }) => {
  await page.addInitScript(() => { window.L = { map() { throw new Error('không được dùng'); } }; });
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/tracking`);
  await expect(page.locator('.trk-row')).toHaveCount(2);
  expect(await page.evaluate(() => [...document.scripts].filter((s) => /leaflet/.test(s.src)).length)).toBe(0);
  expect(errors.filter((e) => /không được dùng/.test(e))).toEqual([]);
});
