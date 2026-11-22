import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Trang chủ mới (giao diện từ bản FOODSAVE, thương hiệu MIO): không còn nội dung giả, giữ SEO của trang cũ.
const OLD_HOME = readFileSync(new URL('../../docs/trang-chu-cu/index.html', import.meta.url), 'utf8');
const VERIFICATION = OLD_HOME.match(/name="google-site-verification" content="([^"]+)"/)[1];
const PUBLIC_ROUTES = ['landing', 'about', 'business', 'services', 'impact', 'news', 'newsArticle', 'community', 'faq', 'help', 'contact'];

async function openHome(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Chạy offline: chặn ảnh, font và CDN bên ngoài.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  await page.addInitScript(() => sessionStorage.setItem('cookie-consent', 'accept'));
  await page.goto('/');
  // Sẵn sàng khi trang chủ đã render và mio-chatbot.js (defer) đã gắn câu hỏi vào widget.
  await expect(page.locator('#hero-title')).toHaveText('MIO');
  await expect(page.locator('#aiQuick button').first()).toBeAttached();
  return errors;
}

test('trang chủ giữ SEO cũ, hiện nội dung và các route công khai không lỗi', async ({ page }) => {
  const errors = await openHome(page);
  await expect(page).toHaveTitle(/\bMIO\b/);
  await expect(page.locator('meta[name="google-site-verification"]')).toHaveAttribute('content', VERIFICATION);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://makeitorganized.netlify.app/');
  await expect(page.locator('#hero-title')).toHaveText('MIO');
  expect((await page.locator('#app').innerHTML()).length).toBeGreaterThan(1000);
  for (const route of PUBLIC_ROUTES) {
    await page.evaluate((name) => window.setRoute(name), route);
    expect((await page.locator('#app').innerHTML()).length, route).toBeGreaterThan(200);
  }
  expect(errors).toEqual([]);
});

test('không còn thương hiệu cũ, số điện thoại giả, API site khác; dải tin ẩn khi chưa có dữ liệu', async ({ page }) => {
  const errors = await openHome(page);
  const html = await page.content();
  expect(html).not.toContain('foodsave-vn');
  expect(html).not.toMatch(/1900\s*1545/);
  for (const route of ['landing', 'about', 'faq', 'contact', 'news']) {
    await page.evaluate((name) => window.setRoute(name), route);
    const text = await page.locator('body').innerText();
    expect(text, route).not.toMatch(/FOODSAVE|FoodSave|Food Save/);
    expect(text, route).not.toMatch(/1900\s*1545|090\s*995\s*2120/);
  }
  // Dải tin chỉ chứa số liệu có nguồn: mỗi mục là link https mở tab mới
  const ticker = await page.evaluate(() => MIO_TICKER.map((t) => t.href));
  expect(ticker.length).toBeGreaterThan(0);
  for (const href of ticker) expect(href).toMatch(/^https:\/\//);
  await expect(page.locator('#missionStrip')).toBeVisible();
  const links = page.locator('#missionTicker a');
  expect(await links.count()).toBe(ticker.length * 2); // nhân đôi để chạy vòng liền mạch
  await expect(links.first()).toHaveAttribute('target', '_blank');
  await expect(links.first()).toHaveAttribute('rel', /noopener/);
  // Chưa cấu hình điện thoại: không có lối vào hotline
  await expect(page.locator('#hotlineOption')).toBeHidden();
  expect(errors).toEqual([]);
});

const FABRICATED = ['12.4', '38+', '3200', '18640', '56.2', '18.6K', '240 deal', 'Phản hồi thật', 'Co.op', 'VinMart',
  'Bách Hóa Xanh', 'FoodSafe Cover', '5.000.000', '20.000.000', '12-15%', 'Hotjar', 'Mixpanel', 'Pixel', 'Sapo', 'KiotViet',
  'iPOS', 'Sunmi', 'PCI-DSS', 'Bảo hiểm TNV', 'FAO 2022', '17 danh mục', '28+ câu', 'Kiểm duyệt 100%', 'Khiếu nại 72 giờ', 'Hà Nội',
  'xác thực hai lớp', 'dị ứng', 'chữ ký số', 'nhà tài trợ tự động', 'công thức nấu', 'Q3/2026', 'Forbes', 'Maison Bakery', 'Bếp Xanh'];
const SCANNED_ROUTES = ['landing', 'about', 'impact', 'business', 'services', 'faq', 'help', 'contact'];

// Chữ người xem đọc được của một route: textContent (kể cả câu trả lời FAQ đang đóng) + nội dung modal data-modal.
// Không dùng innerHTML: trong đó có ảnh base64 và URL ảnh (bt-override thay ảnh lỗi bất đồng bộ), dễ khớp nhầm
// chuỗi như "38+" một cách ngẫu nhiên.
async function routeText(page, route) {
  await page.evaluate((name) => window.setRoute(name), route);
  await expect.poll(() => page.evaluate(() => state.route)).toBe(route);
  return page.evaluate(() => {
    const app = document.getElementById('app');
    return app.textContent + '\n' + [...app.querySelectorAll('[data-modal]')].map((el) => el.dataset.modal).join('\n');
  });
}

test('mọi route công khai và chính sách cookie không còn số liệu/đối tác/cam kết bịa; menu không có Tin tức', async ({ page }) => {
  const errors = await openHome(page);
  for (const route of SCANNED_ROUTES) {
    const text = await routeText(page, route);
    for (const phrase of FABRICATED) expect(text, `${route}: ${phrase}`).not.toContain(phrase);
  }
  await page.evaluate(() => window.setRoute('landing'));
  await expect(page.locator('#nav')).not.toContainText('Tin tức');
  expect(await page.locator('#mNav').innerText()).not.toContain('Tin tức');
  await expect(page.locator('footer')).not.toContainText('Tin tức');
  // Route tin tức/cộng đồng không còn truy cập được: rơi về landing
  for (const route of ['news', 'newsArticle', 'community']) {
    await page.evaluate((name) => window.setRoute(name), route);
    await expect(page.locator('#hero-title')).toHaveText('MIO');
  }
  await page.evaluate(() => openLegal('cookie'));
  const cookie = await page.locator('#legal-content').innerText();
  for (const phrase of ['Hotjar', 'Mixpanel', 'Pixel', 'Google Analytics 4']) expect(cookie).not.toContain(phrase);
  expect(cookie).toContain('foodsavevietnam@gmail.com');
  await expect(page.locator('#main')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('trợ lý MIO (mio-chatbot.js) trả lời câu hỏi thường gặp trong widget của trang', async ({ page }) => {
  const errors = await openHome(page);
  await page.locator('.support-toggle').click({ force: true });
  await expect(page.locator('#aiWidget')).toHaveClass(/\bopen\b/);
  await page.locator('#aiInput').fill('MIO là gì?');
  await page.locator('#aiForm button[type="submit"]').click();
  await expect(page.locator('#aiBody .ai-msg.bot').last()).toContainText('MIO là nền tảng kết nối thực phẩm');
  // Câu không có sẵn: trả lời bằng email thật, không có số điện thoại
  await page.locator('#aiInput').fill('Câu hỏi không có trong danh sách');
  await page.locator('#aiForm button[type="submit"]').click();
  await expect(page.locator('#aiBody .ai-msg.bot').last()).toContainText('foodsavevietnam@gmail.com');
  await expect(page.locator('#aiBody .ai-msg.bot').last()).not.toContainText('hotline');
  expect(errors).toEqual([]);
});

test('phần người sáng lập ở trang Giới thiệu có đủ 4 thành viên và ảnh mới tải được', async ({ page }) => {
  // Cho phép ảnh nội bộ /images/team (chỉ chặn tài nguyên bên ngoài)
  const errors = await openHome(page);
  await page.evaluate(() => window.setRoute('about'));
  const grid = page.locator('.founders-grid');
  await grid.scrollIntoViewIfNeeded();
  await expect(grid.locator('.team-card')).toHaveCount(4);
  for (const name of ['Phạm Ngọc Trân', 'Nguyễn Bửu Trân', 'Lê Trần Viết Khánh', 'Trịnh Vũ Việt Anh']) {
    await expect(grid.locator('h4', { hasText: name })).toHaveCount(1);
  }
  for (const src of ['/images/team/pham-ngoc-tran.jpg', '/images/team/nguyen-buu-tran.jpg', '/images/team/le-tran-viet-khanh.jpg', '/images/team/trinh-vu-viet-anh.jpg']) {
    const img = grid.locator(`img[src="${src}"]`);
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.locator('#app')).toContainText('Bốn người, một dự án nhỏ, một niềm tin lớn');
  expect(errors).toEqual([]);
});

test('mã nguồn trang chủ không còn nội dung bịa hay hẹn ngày phát hành', async ({ request }) => {
  const source = await (await request.get('/')).text();
  for (const phrase of ['Forbes', 'Maison Bakery', '240 deal', '56.2', 'Bếp Xanh', 'Q3/2026', 'xác thực hai lớp', 'dị ứng', 'chữ ký số', 'base64,']) {
    expect(source, phrase).not.toContain(phrase);
  }
  // Ngưỡng nhãn khớp LABEL_THRESHOLDS_V1 trong src/core/labels/index.ts
  for (const t of ['còn dưới 4 giờ', 'còn 4–12 giờ', 'còn dưới 24 giờ', 'còn 24–72 giờ', 'còn dưới 3 ngày', 'còn 3–7 ngày']) expect(source).toContain(t);
});
