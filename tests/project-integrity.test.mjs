import assert from 'node:assert/strict';
import { open, readFile } from 'node:fs/promises';
import test from 'node:test';
import { checkProject, HTML_FILES, inspectHtml, MANIFEST_FILES, resolveLocalReference } from '../scripts/check-project.mjs';

const PUBLIC_ROOT = new URL('../public/', import.meta.url);

test('local references preserve root and relative paths while ignoring URL queries', () => {
  assert.equal(resolveLocalReference('/'), 'index.html');
  assert.equal(resolveLocalReference('frontend/app.js?v=2&amp;preview=1'), 'frontend/app.js');
  assert.equal(resolveLocalReference('../icons/icon-192.png', 'frontend/app.css'), 'icons/icon-192.png');
  assert.equal(resolveLocalReference('/FOODSAVE_USER.html#orders'), 'FOODSAVE_USER.html');
  assert.equal(resolveLocalReference('icons/food%20photo.png'), 'icons/food photo.png');
});

test('external, fragment and dynamic references are not treated as local files', () => {
  for (const reference of [
    'https://example.com/image.png', '//example.com/script.js', '#faq', 'data:image/png;base64,AA',
    'blob:https://example.com/id', 'mailto:hello@example.com', 'tel:12345', 'javascript:void(0)',
    '${imageUrl}', '{{ image }}', '',
  ]) {
    assert.equal(resolveLocalReference(reference), null);
  }
});

test('disallowed or malformed references are rejected before any file is probed', () => {
  // These are URL strings only; the test never creates, reads or probes such files.
  for (const reference of ['/node_modules/example.js', '/dist/example.js', '/.hidden', '/icons/%2eprivate', '/icons/%00.png', '/bad%ZZ.png', 'icons\\image.png']) {
    assert.throws(() => resolveLocalReference(reference));
  }
});

test('HTML inspection excludes virtual markup in scripts, styles and comments', () => {
  const html = `<!-- <img src="comment.png"> -->
<script type="application/ld+json">{"image":"virtual.png"}</script>
<script>const virtual = '<img src="virtual.png">';</script>
<style>.example::after { content: '<a href="virtual.html">'; }</style>
<script src="frontend/app.js"></script>
<img src='icons/icon.png'><a href="FOODSAVE_USER.html">Buyer</a>`;
  const result = inspectHtml(html);
  assert.deepEqual(result.references.map((reference) => reference.value), [
    'frontend/app.js', 'icons/icon.png', 'FOODSAVE_USER.html',
  ]);
  assert.equal(result.scripts.length, 1);
  assert.match(result.scripts[0].code, /const virtual/);
});

test('all supplied portal pages, scripts, CSS resources and PWA assets are complete', async () => {
  const result = await checkProject();
  assert.deepEqual(result.issues, [], result.issues.map((issue) => `${issue.file}:${issue.line}: ${issue.message}`).join('\n'));
  assert.ok(result.checkedFiles >= 35);
  assert.ok(result.checkedReferences > 50);
  assert.ok(result.checkedScripts > 20);
});

test('every portal ships the MIO identity and loads API configuration before business scripts', async () => {
  for (const file of HTML_FILES) {
    const html = await readFile(new URL(file, PUBLIC_ROOT), 'utf8');
    const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
    assert.match(title, /\bMIO\b/, `${file}: browser title should identify MIO`);
    assert.doesNotMatch(title, /foodsave/i, `${file}: browser title still uses the previous brand`);

    const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
    const bootstrap = /\bsrc\s*=\s*["']\/?frontend\/foodsave-config\.js(?:\?[^"']*)?["']/i;
    assert.equal(scriptTags.filter((tag) => bootstrap.test(tag)).length, 1, `${file}: expected one API configuration bootstrap`);
    assert.match(scriptTags[0] ?? '', bootstrap, `${file}: API configuration must load before other scripts`);

    const links = html.match(/<link\b[^>]*>/gi) ?? [];
    assert.ok(links.some((tag) => /\brel\s*=\s*["']icon["']/i.test(tag)
      && /\bhref\s*=\s*["']\/icons\/icon-192\.png["']/i.test(tag)), `${file}: MIO favicon is missing`);
    const brandStylesheets = links.filter((tag) => /\bhref\s*=\s*["']\/frontend\/mio-brand\.css(?:\?[^"']*)?["']/i.test(tag)
      && /\brel\s*=\s*["']stylesheet["']/i.test(tag));
    // Trang chủ dùng bảng màu riêng của giao diện mới và cố ý không nạp mio-brand.css, để tránh xung đột style chưa được kiểm tra.
    assert.equal(brandStylesheets.length, file === 'index.html' ? 0 : 1, `${file}: unexpected MIO brand stylesheet count`);
    // Some app screens render their logo from an inline template rather than a static img tag.
    assert.ok(html.includes('/icons/mio-logo-square.png'), `${file}: packaged MIO logo is not referenced`);
  }
});

async function readHeader(relativeFile, length) {
  const file = await open(new URL(relativeFile, PUBLIC_ROOT), 'r');
  try {
    const header = Buffer.alloc(length);
    const { bytesRead } = await file.read(header, 0, length, 0);
    assert.equal(bytesRead, length, `${relativeFile}: image header is incomplete`);
    return header;
  } finally {
    await file.close();
  }
}

test('MIO PWA manifests and packaged image headers match the installed icon sizes', async () => {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const expectedIcons = new Map([
    ['icons/icon-192.png', 192],
    ['icons/icon-512.png', 512],
    ['icons/maskable-512.png', 512],
    ['icons/apple-touch-icon-180.png', 180],
  ]);
  for (const [file, expectedSize] of expectedIcons) {
    // PNG dimensions live in the IHDR header; no image body needs to be loaded.
    const header = await readHeader(file, 24);
    assert.deepEqual(header.subarray(0, 8), pngSignature, `${file}: expected PNG signature`);
    assert.equal(header.toString('ascii', 12, 16), 'IHDR', `${file}: expected PNG image header`);
    assert.equal(header.readUInt32BE(16), expectedSize, `${file}: unexpected width`);
    assert.equal(header.readUInt32BE(20), expectedSize, `${file}: unexpected height`);
  }

  const squareLogo = await readHeader('icons/mio-logo-square.png', 24);
  assert.deepEqual(squareLogo.subarray(0, 8), pngSignature);
  assert.ok(squareLogo.readUInt32BE(16) > 0);
  assert.equal(squareLogo.readUInt32BE(16), squareLogo.readUInt32BE(20), 'MIO app logo must be square');
  const sourceLogo = await readHeader('icons/mio-logo.jpg', 3);
  assert.deepEqual(sourceLogo, Buffer.from([255, 216, 255]), 'Original MIO logo should remain available as JPEG');

  for (const file of MANIFEST_FILES) {
    const manifest = JSON.parse(await readFile(new URL(file, PUBLIC_ROOT), 'utf8'));
    assert.match(manifest.name, /\bMIO\b/, `${file}: installed app name should identify MIO`);
    assert.match(manifest.short_name, /^MIO(?:\s|$)/, `${file}: installed app short name should identify MIO`);
    assert.doesNotMatch(`${manifest.name} ${manifest.short_name}`, /foodsave/i, `${file}: installed app still uses the previous brand`);
    assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'), `${file}: maskable icon is missing`);
    for (const icon of manifest.icons) {
      const relativeFile = resolveLocalReference(icon.src, file);
      assert.ok(expectedIcons.has(relativeFile), `${file}: unexpected packaged icon`);
      const size = expectedIcons.get(relativeFile);
      assert.equal(icon.sizes, `${size}x${size}`, `${file}: manifest size does not match image header`);
    }
  }
});
