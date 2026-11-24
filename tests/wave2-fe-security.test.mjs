import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf8');

function extractHeaderBlock(toml, routePath) {
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\[\\[headers\\]\\]\\s*for\\s*=\\s*"${escaped}"[\\s\\S]*?(?=\\n\\[\\[headers\\]\\]|$)`);
  const m = toml.match(re);
  return m ? m[0] : '';
}

test('netlify.toml configures HTTP security headers and no-cache for HTML', () => {
  const toml = read('netlify.toml');

  const globalBlock = extractHeaderBlock(toml, '/*');
  assert.ok(globalBlock, 'Missing [[headers]] for = "/*" block');
  assert.match(globalBlock, /X-Content-Type-Options\s*=\s*"nosniff"/);
  assert.match(globalBlock, /Referrer-Policy\s*=\s*"strict-origin-when-cross-origin"/);
  assert.match(globalBlock, /X-Frame-Options\s*=\s*"SAMEORIGIN"/);
  assert.match(globalBlock, /Strict-Transport-Security\s*=\s*"max-age=31536000; includeSubDomains"/);
  assert.match(globalBlock, /Permissions-Policy\s*=\s*"[^"]*camera=\(self\)[^"]*geolocation=\(self\)[^"]*microphone=\(\)[^"]*"/);
  assert.match(globalBlock, /Content-Security-Policy-Report-Only\s*=\s*"[^"]*default-src 'self'[^"]*frame-ancestors 'self'"/);

  const htmlBlock = extractHeaderBlock(toml, '/*.html');
  assert.ok(htmlBlock, 'Missing [[headers]] for = "/*.html" block');
  assert.match(htmlBlock, /Cache-Control\s*=\s*"no-cache"/);

  const adminBlock = extractHeaderBlock(toml, '/admin/*');
  assert.ok(adminBlock, 'Missing [[headers]] for = "/admin/*" block');
  assert.match(adminBlock, /Cache-Control\s*=\s*"no-cache"/);
  assert.match(adminBlock, /X-Frame-Options\s*=\s*"DENY"/);
  assert.match(adminBlock, /Referrer-Policy\s*=\s*"no-referrer"/);
});

test('ADMIN_FOODSAVE.html disables mock data outside ?demo=1, blocks direct DB approval writes, and escapes XSS vectors', () => {
  const html = read('public/ADMIN_FOODSAVE.html');

  // Demo-only mock arrays
  assert.match(html, /const ADMIN_DEMO_MODE\s*=\s*\/\[\?&\]demo=1/);
  assert.match(html, /const IV\s*=\s*ADMIN_DEMO_MODE\s*\?/);
  assert.match(html, /const OR\s*=\s*ADMIN_DEMO_MODE\s*\?/);
  assert.match(html, /const PAY\s*=\s*ADMIN_DEMO_MODE\s*\?/);

  // Empty DB should not fall back to mock orders outside demo mode
  assert.match(html, /if\s*\(\s*ADMIN_DEMO_MODE\s*&&\s*!rows\.length\s*\)\s*return;/);
  assert.doesNotMatch(html, /if\s*\(\s*!rows\.length\s*\)\s*return;\s*\n\s*OR\.splice/);

  // replaceRealRows does not mix mock inventory rows outside demo mode
  assert.match(html, /function replaceRealRows\([\s\S]*?if\s*\(\s*!ADMIN_DEMO_MODE\s*\)\s*\{\s*list\.splice\(0,\s*list\.length,\s*\.\.\.rows\);\s*return;\s*\}/);

  // No direct Supabase writes to partner_profiles or charity_profiles
  assert.doesNotMatch(html, /\.from\(\s*['"]partner_profiles['"]\s*\)[\s\S]{0,120}\.update\(/);
  assert.doesNotMatch(html, /\.from\(\s*['"]charity_profiles['"]\s*\)[\s\S]{0,120}\.update\(/);
  assert.match(html, /\/admin\/#\/verify/);

  // Stored XSS fix: index-based drawer openers & escaped cells in orders/payments/inventory
  assert.match(html, /function openOrderDrawer\(/);
  assert.match(html, /function openPaymentDrawer\(/);
  assert.match(html, /function openInventoryDrawer\(/);
  assert.match(html, /onclick="openOrderDrawer\(\$\{idx\}\)"/);
  assert.match(html, /onclick="openPaymentDrawer\(\$\{idx\}\)"/);
  assert.doesNotMatch(html, /onclick="oG\('\$\{o\[0\]\}'/);
  assert.doesNotMatch(html, /onclick="oG\('\$\{p\[0\]\}'/);
  assert.doesNotMatch(html, /onclick="oG\('\$\{i\[1\]\}'/);
});

test('admin-v2.js escapes single quotes and validates complaint image URLs', () => {
  const js = read('public/frontend/admin-v2.js');
  assert.match(js, /'&': '&amp;'[\s\S]*?"'": '&#39;'/);
  assert.match(js, /safeImgUrl\s*=\s*function[\s\S]*?\^\(https\?:\\\/\\\/\|\\\/\)/);
  assert.match(js, /var su = safeImgUrl\(u\)/);
});

test('FOODSAVE_PARTNER.html escapes buyer/order/notification fields and validates image URLs', () => {
  const html = read('public/FOODSAVE_PARTNER.html');

  assert.match(html, /function safePartnerImgUrl\([\s\S]*?\^\(https\?:\\\/\\\/\|\\\/\)/);
  assert.match(html, /function modal\(t,c\)[\s\S]*?\$\{escHtml\(t\)\}/);
  assert.match(html, /function tst\(t,d,type\)[\s\S]*?\$\{escHtml\(t\)\}[\s\S]*?\$\{escHtml\(d\)\}/);

  const ordDetailStart = html.indexOf('function ordDetail(){');
  const ordDetailEnd = html.indexOf('function cancelOrder(){', ordDetailStart);
  assert.ok(ordDetailStart > 0 && ordDetailEnd > ordDetailStart, 'ordDetail() not found');
  const ordDetailBody = html.slice(ordDetailStart, ordDetailEnd);

  assert.match(ordDetailBody, /Đơn \$\{escHtml\(o\.id\)\}/);
  assert.match(ordDetailBody, /\$\{escHtml\(o\.c\)\}/);
  assert.match(ordDetailBody, /\$\{escHtml\(o\.ph\)\}/);
  assert.match(ordDetailBody, /\$\{escHtml\(o\.code\)\}/);
  assert.match(ordDetailBody, /\$\{escHtml\(o\.cancelReason/);
  assert.doesNotMatch(ordDetailBody, /\$\{o\.(id|c|ph|mt|time|pay|code|cancelReason)\}/);
});

test('FOODSAVE_CHARITY.html escapes volunteer details and sanitizes v.avatarUrl', () => {
  const html = read('public/FOODSAVE_CHARITY.html');

  assert.match(html, /function safeVolAvatarUrl\(/);
  assert.match(html, /\^\(https\?:\\\/\\\/\|\\\/\)/);
  assert.match(html, /function volAvatarStyle\(/);

  const volStart = html.indexOf('function pVol(){');
  const volEnd = html.indexOf('let volunteerEditing=false;', volStart);
  assert.ok(volStart > 0 && volEnd > volStart, 'Volunteer section not found');
  const volSection = html.slice(volStart, volEnd);

  assert.match(volSection, /volAvatarStyle\(v\.avatarUrl/);
  assert.match(volSection, /\$\{esc\(v\.name\)\}/);
  assert.match(volSection, /\$\{esc\(v\.vehicle\)\}/);
  assert.match(volSection, /\$\{esc\(\(v\.zones\|\|\[\]\)\.join\(/);
  assert.match(volSection, /esc\(v\.phone\)/);
  assert.match(volSection, /esc\(v\.schedule\)/);
  assert.doesNotMatch(volSection, /background:url\('\s*"\s*\+\s*v\.avatarUrl/);
  assert.doesNotMatch(volSection, /\$\{v\.(name|av|vehicle|role|joined|phone|email|schedule)\}/);
});

test('dieu-khoan.html does not use broken Lucide icon receipt-x', () => {
  const html = read('public/dieu-khoan.html');
  assert.doesNotMatch(html, /data-lucide="receipt-x"/);
});
