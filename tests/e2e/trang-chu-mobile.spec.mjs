import { expect, test } from '@playwright/test';

// Trang chủ: header không được nháy (bật/tắt "scrolled" liên tục) và hộp cookie không được ép chữ trên màn hẹp.

// Trình duyệt bù vị trí cuộn khi header (sticky, nằm trong luồng trang) đổi chiều cao (scroll anchoring).
// Tắt transition để header đổi cao ngay lập tức: khi đó Chromium headless cũng bù đúng như Edge/Chrome thật,
// và vòng lặp "thu gọn → bị kéo về dưới ngưỡng → mở ra → bị đẩy qua ngưỡng" lộ ra nếu ngưỡng sai.
async function runAnchoredLoop(page, startY) {
  return page.evaluate(async (y0) => {
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
    document.head.appendChild(style);
    const bar = document.querySelector('.topbar');
    bar.classList.remove('scrolled');
    window.scrollTo({ top: 0, behavior: 'instant' });
    await nextFrame();
    let flips = 0;
    let last = bar.classList.contains('scrolled');
    const obs = new MutationObserver(() => {
      const now = bar.classList.contains('scrolled');
      if (now !== last) { flips += 1; last = now; }
    });
    obs.observe(bar, { attributes: true, attributeFilter: ['class'] });
    window.scrollTo({ top: y0, behavior: 'instant' });
    for (let i = 0; i < 16; i += 1) await nextFrame();
    obs.disconnect();
    style.remove();
    return { flips, scrolled: last, y: Math.round(window.scrollY) };
  }, startY);
}

test.describe('Trang chủ: header không nháy khi cuộn quanh ngưỡng', () => {
  for (const viewport of [{ width: 1914, height: 822 }, { width: 430, height: 880 }]) {
    test(`${viewport.width}px: header đổi trạng thái tối đa 1 lần ở mọi vị trí cuộn gần ngưỡng`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(() => sessionStorage.setItem('cookie-consent', 'accept'));
      await page.goto('/');
      await page.waitForSelector('.topbar');
      for (const y of [25, 31, 40, 55, 80, 97, 110, 140]) {
        const result = await runAnchoredLoop(page, y);
        expect(result.flips, `bắt đầu ở ${y}px: ${JSON.stringify(result)}`).toBeLessThanOrEqual(1);
      }
    });
  }

  test('cuộn xa rồi quay về đầu trang: header mở lại', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => sessionStorage.setItem('cookie-consent', 'accept'));
    await page.goto('/');
    await page.evaluate(() => { window.scrollTo({ top: 600, behavior: 'instant' }); window.dispatchEvent(new Event('scroll')); });
    await expect(page.locator('.topbar')).toHaveClass(/scrolled/);
    await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); window.dispatchEvent(new Event('scroll')); });
    await expect(page.locator('.topbar')).not.toHaveClass(/scrolled/);
  });
});

test.describe('Trang chủ: hộp cookie trên màn hẹp', () => {
  for (const viewport of [{ width: 320, height: 640 }, { width: 360, height: 740 }, { width: 430, height: 880 }, { width: 1280, height: 800 }]) {
    test(`${viewport.width}px: chữ đủ rộng, nút nằm trong hộp, trang không cuộn ngang`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewportSize(viewport);
      await page.goto('/');
      const banner = page.locator('#cookie-banner');
      await expect(banner).toBeVisible({ timeout: 5000 });
      const m = await banner.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const icon = el.children[0].getBoundingClientRect();
        const text = el.children[1].getBoundingClientRect();
        const buttons = [...el.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
        return {
          bannerLeft: box.left, bannerRight: box.right, bannerWidth: box.width, bannerHeight: box.height,
          textWidth: text.width, iconBottom: icon.bottom, textTop: text.top,
          buttonsTop: Math.min(...buttons.map((b) => b.top)),
          buttonsInside: buttons.every((b) => b.left >= box.left - 0.5 && b.right <= box.right + 0.5),
          pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
          viewportHeight: window.innerHeight,
        };
      });
      expect(m.textWidth, JSON.stringify(m)).toBeGreaterThanOrEqual(Math.min(200, m.bannerWidth * 0.6));
      expect(m.buttonsInside, JSON.stringify(m)).toBe(true);
      expect(m.bannerLeft).toBeGreaterThanOrEqual(0);
      expect(m.bannerRight).toBeLessThanOrEqual(viewport.width);
      expect(m.bannerHeight, JSON.stringify(m)).toBeLessThan(m.viewportHeight * 0.45);
      expect(m.pageOverflow).toBe(false);
      // Desktop giữ một hàng như trước; màn hẹp: icon và chữ chung hàng đầu (chữ bắt đầu trước khi icon kết thúc).
      if (viewport.width >= 1024) expect(m.buttonsTop, JSON.stringify(m)).toBeLessThan(m.iconBottom);
      else expect(m.textTop, JSON.stringify(m)).toBeLessThan(m.iconBottom);
      await page.getByRole('button', { name: 'Chấp nhận' }).click();
      await expect(banner).toBeHidden();
      expect(errors).toEqual([]);
    });
  }
});
