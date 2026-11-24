import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { HTML_FILES } from '../scripts/check-project.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(rootDir, rel));

test('retires obsolete _v2 and _demo HTML pages and removes them from HTML_FILES', () => {
  const retired = [
    'FOODSAVE_PARTNER_v2.html',
    'ADMIN_FOODSAVE_v2.html',
    'FOODSAVE_APP_demo.html',
  ];
  for (const file of retired) {
    assert.equal(exists(path.join('public', file)), false, `Expected public/${file} to be deleted`);
    assert.equal(HTML_FILES.includes(file), false, `Expected ${file} to be removed from HTML_FILES`);
  }
});

test('public/robots.txt disallows private/admin/api routes and keeps sitemap directive', () => {
  const robots = read('public/robots.txt');
  const lines = robots.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert.ok(lines.includes('User-agent: *'));
  assert.ok(lines.includes('Allow: /'));
  assert.ok(lines.includes('Disallow: /admin/'));
  assert.ok(lines.includes('Disallow: /ADMIN_FOODSAVE.html'));
  assert.ok(lines.includes('Disallow: /offline.html'));
  assert.ok(lines.includes('Disallow: /api/'));
  assert.ok(lines.includes('Sitemap: https://makeitorganized.netlify.app/sitemap.xml'));
});

test('public/sitemap.xml is well-formed XML listing all canonical public 200 URLs', () => {
  const xml = read('public/sitemap.xml').trim();
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">[\s\S]*<\/urlset>$/);

  const openUrls = (xml.match(/<url>/g) ?? []).length;
  const closeUrls = (xml.match(/<\/url>/g) ?? []).length;
  assert.equal(openUrls, closeUrls, 'Mismatched <url> tags in sitemap.xml');

  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  assert.equal(locs.length, openUrls, 'Each <url> must contain a <loc>');

  const expectedUrls = [
    'https://makeitorganized.netlify.app/',
    'https://makeitorganized.netlify.app/FOODSAVE_USER.html',
    'https://makeitorganized.netlify.app/FOODSAVE_APP.html',
    'https://makeitorganized.netlify.app/FOODSAVE_PARTNER.html',
    'https://makeitorganized.netlify.app/FOODSAVE_CHARITY.html',
    'https://makeitorganized.netlify.app/FOODSAVE_VOLUNTEER.html',
    'https://makeitorganized.netlify.app/dieu-khoan.html',
    'https://makeitorganized.netlify.app/chinh-sach.html',
  ];
  for (const url of expectedUrls) {
    assert.ok(locs.includes(url), `sitemap.xml missing canonical URL ${url}`);
  }
  assert.equal(new Set(locs).size, locs.length, 'sitemap.xml contains duplicate URLs');
  for (const loc of locs) {
    assert.doesNotMatch(loc, /ADMIN_FOODSAVE|\/admin\/|_v2\.html|_demo\.html/i);
  }
});

test('legal pages and charity portal pin lucide@0.460.0 (no @latest), keep Tailwind on legal pages, and include meta description', () => {
  for (const file of ['public/dieu-khoan.html', 'public/chinh-sach.html']) {
    const html = read(file);
    assert.doesNotMatch(html, /@latest/i, `${file} must not load @latest CDN packages`);
    assert.match(
      html,
      /<script\s+src="https:\/\/unpkg\.com\/lucide@0\.460\.0\/dist\/umd\/lucide\.min\.js"><\/script>/,
      `${file} must pin lucide@0.460.0`,
    );
    assert.match(html, /https:\/\/cdn\.tailwindcss\.com/, `${file} must keep Tailwind intact`);
    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"\s*\/?>/i);
    assert.ok(descMatch && descMatch[1].trim().length >= 30, `${file} must include a meaningful <meta name="description">`);
  }

  const charityHtml = read('public/FOODSAVE_CHARITY.html');
  assert.doesNotMatch(charityHtml, /lucide@latest/i, 'FOODSAVE_CHARITY.html must not load lucide@latest');
  assert.match(
    charityHtml,
    /<script\s+defer\s+src="https:\/\/unpkg\.com\/lucide@0\.460\.0\/dist\/umd\/lucide\.min\.js"><\/script>/,
    'FOODSAVE_CHARITY.html must pin lucide@0.460.0',
  );

  const userHtml = read('public/FOODSAVE_USER.html');
  assert.match(userHtml, /src="frontend\/foodsave-order-flow\.js\?v=20261124a"/);

  const projectStructure = read('docs/PROJECT_STRUCTURE.md');
  assert.doesNotMatch(projectStructure, /FOODSAVE_PARTNER_v2\.html|ADMIN_FOODSAVE_v2\.html|FOODSAVE_APP_demo\.html/);
});

test('mio-demo-mode.js renders safe DOM exit button and clears demo keys + ?demo=1 on click', () => {
  const code = read('public/frontend/mio-demo-mode.js');
  assert.match(code, /MIO · CHẾ ĐỘ DEMO/);
  assert.match(code, /Thoát Demo/);
  assert.match(code, /data-act[\s\S]{0,40}exit-demo/);

  function createMemoryStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
      get length() { return map.size; },
      key(index) { return [...map.keys()][index] ?? null; },
      getItem(k) { return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { map.set(String(k), String(v)); },
      removeItem(k) { map.delete(k); },
      _dump() { return Object.fromEntries(map.entries()); },
    };
  }

  function makeElement(tag) {
    const attrs = new Map();
    const listeners = new Map();
    return {
      tagName: tag.toUpperCase(),
      className: '',
      type: '',
      textContent: '',
      children: [],
      setAttribute(name, value) { attrs.set(name, String(value)); },
      getAttribute(name) { return attrs.get(name) ?? null; },
      appendChild(child) { this.children.push(child); return child; },
      addEventListener(event, fn) { listeners.set(event, fn); },
      click() { const fn = listeners.get('click'); if (fn) fn(); },
    };
  }

  const bodyChildren = [];
  const headChildren = [];
  let clearSessionCalls = 0;
  let assignedUrl = null;
  let reloaded = false;

  const sessionStorage = createMemoryStorage({
    'mio.demo': '1',
    'mio.demo.partner': '1',
    'mio.demo.charity': '1',
    'foodsave.mio.demo.extra': 'yes',
    'unrelated.key': 'keep',
  });
  const localStorage = createMemoryStorage({
    'foodsave.mio.demo.session.partner': '{"demo":true}',
    'foodsave.auth.real': 'keep',
  });

  const windowObj = {
    location: {
      href: 'https://makeitorganized.netlify.app/FOODSAVE_PARTNER.html?demo=1&tab=orders',
      assign(url) { assignedUrl = url; },
      reload() { reloaded = true; },
    },
    FoodSaveAuth: {
      clearSession() { clearSessionCalls += 1; },
    },
  };

  const context = {
    window: windowObj,
    document: {
      body: {
        classList: { contains: (cls) => cls === 'role-partner' },
        appendChild: (node) => { bodyChildren.push(node); return node; },
      },
      head: {
        appendChild: (node) => { headChildren.push(node); return node; },
      },
      createElement: makeElement,
      getElementById: () => null,
    },
    sessionStorage,
    localStorage,
    URL,
    Date,
    Proxy,
    setTimeout,
  };

  vm.runInNewContext(code, context, { filename: 'mio-demo-mode.js' });

  const badge = bodyChildren.find((el) => el.className === 'mio-demo-badge');
  assert.ok(badge, 'Expected .mio-demo-badge to be appended to document.body');
  const label = badge.children.find((el) => el.textContent.includes('MIO · CHẾ ĐỘ DEMO'));
  const exitBtn = badge.children.find((el) => el.className === 'mio-demo-exit');
  assert.ok(label, 'Expected MIO · CHẾ ĐỘ DEMO label inside badge');
  assert.ok(exitBtn, 'Expected .mio-demo-exit button inside badge');
  assert.equal(exitBtn.type, 'button');
  assert.equal(exitBtn.getAttribute('data-act'), 'exit-demo');
  assert.equal(exitBtn.textContent, 'Thoát Demo');

  // Trigger exit button click
  exitBtn.click();

  assert.equal(sessionStorage.getItem('mio.demo'), null);
  assert.equal(sessionStorage.getItem('mio.demo.partner'), null);
  assert.equal(sessionStorage.getItem('mio.demo.charity'), null);
  assert.equal(sessionStorage.getItem('foodsave.mio.demo.extra'), null);
  assert.equal(sessionStorage.getItem('unrelated.key'), 'keep');
  assert.equal(localStorage.getItem('foodsave.mio.demo.session.partner'), null);
  assert.equal(localStorage.getItem('foodsave.auth.real'), 'keep');
  assert.equal(clearSessionCalls, 1);
  assert.equal(reloaded, false);
  assert.equal(assignedUrl, 'https://makeitorganized.netlify.app/FOODSAVE_PARTNER.html?tab=orders');
});

test('complaintService scopes upload URLs by order ownership, blocks cross-order evidence hijacking, and signs private bucket URLs', async () => {
  Object.assign(process.env, {
    SUPABASE_URL: 'http://127.0.0.1:9',
    SUPABASE_ANON_KEY: 'x',
    SUPABASE_SERVICE_ROLE_KEY: 'x',
    CORS_ORIGINS: 'http://localhost',
    DATABASE_URL: 'postgres://x:x@127.0.0.1:9/x',
    DEMO_MODE: 'false',
    LOG_LEVEL: 'error',
    PAYMENT_PROVIDER: 'simulated',
    PAYOUT_PROVIDER: 'manual',
  });

  const require = createRequire(import.meta.url);
  const { FakeDb } = require('../scripts/fake-supabase.js');
  const sb = require('../dist/config/supabase.js');
  const { complaintUploadBodySchema } = require('../dist/schemas/orderSchemas.js');

  const db = new FakeDb();
  const ORDER_A = '11111111-1111-4111-8111-111111111111';
  const ORDER_B = '22222222-2222-4222-8222-222222222222';
  const MISSING_ORDER = '99999999-9999-4999-8999-999999999999';
  const CUST_A = 'aaaa1111-1111-4111-8111-111111111111';
  const CUST_B = 'bbbb2222-2222-4222-8222-222222222222';
  const OWNER_A = 'cccc3333-3333-4333-8333-333333333333';
  const ADMIN_ID = 'dddd4444-4444-4444-8444-444444444444';

  db.seed('stores', [{ id: 'store-a', owner_id: OWNER_A, name: 'Tiệm A' }]);
  db.seed('orders', [{
    id: ORDER_A,
    order_number: 'MIO-9001',
    customer_id: CUST_A,
    store_id: 'store-a',
    status: 'completed',
    total_cents: 50000,
    stores: { owner_id: OWNER_A, name: 'Tiệm A' },
  }]);

  const signedUrlCalls = [];
  const uploadedBuckets = [];
  sb.supabaseAdmin = {
    from: (name) => db.from(name),
    rpc: (name, args) => db.rpc(name, args),
    storage: {
      from: (bucket) => ({
        createSignedUploadUrl: async (objectPath) => {
          uploadedBuckets.push({ bucket, objectPath });
          return { data: { token: `tok-${objectPath}`, signedUrl: `http://127.0.0.1:9/upload/${bucket}/${objectPath}` }, error: null };
        },
        getPublicUrl: (objectPath) => ({
          data: { publicUrl: `http://127.0.0.1:9/storage/v1/object/public/${bucket}/${objectPath}` },
        }),
        createSignedUrl: async (objectPath, expiresIn) => {
          signedUrlCalls.push({ bucket, objectPath, expiresIn });
          return { data: { signedUrl: `http://127.0.0.1:9/storage/v1/object/sign/${bucket}/${objectPath}?token=signed&exp=${expiresIn}` }, error: null };
        },
      }),
    },
  };

  const {
    complaintService,
    assertEvidenceUrls,
    signEvidenceUrls,
  } = require('../dist/services/complaintService.js');

  // Schema validates optional order_id strictly
  assert.equal(complaintUploadBodySchema.safeParse({ content_type: 'image/jpeg' }).success, true);
  assert.equal(complaintUploadBodySchema.safeParse({ content_type: 'image/png', order_id: ORDER_A }).success, true);
  assert.equal(complaintUploadBodySchema.safeParse({ content_type: 'image/png', order_id: 'not-a-uuid' }).success, false);

  // Backward-compatible legacy call without order_id
  const legacyUp = await complaintService.createUploadUrl(CUST_A, 'customer', 'image/png');
  assert.match(legacyUp.path, new RegExp(`^complaints/customer-${CUST_A}/[0-9a-f-]+\\.png$`));

  // Unauthorized actor for ORDER_A is rejected with 403 AUTH_FORBIDDEN
  await assert.rejects(
    () => complaintService.createUploadUrl(CUST_B, 'customer', 'image/jpeg', ORDER_A),
    (err) => err.statusCode === 403 && err.code === 'AUTH_FORBIDDEN',
  );

  // Missing order returns 404 RESOURCE_NOT_FOUND
  await assert.rejects(
    () => complaintService.createUploadUrl(CUST_A, 'customer', 'image/jpeg', MISSING_ORDER),
    (err) => err.statusCode === 404 && err.code === 'RESOURCE_NOT_FOUND',
  );

  // Malformed order_id returns 400 VALIDATION_ERROR
  await assert.rejects(
    () => complaintService.createUploadUrl(CUST_A, 'customer', 'image/jpeg', 'bad-id'),
    (err) => err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
  );

  // Order customer, store owner, and admin are allowed and scoped to complaints/<orderId>/<actorId>/<uuid>.<ext>
  const custUp = await complaintService.createUploadUrl(CUST_A, 'customer', 'image/jpeg', ORDER_A);
  assert.match(custUp.path, new RegExp(`^complaints/${ORDER_A}/${CUST_A}/[0-9a-f-]+\\.jpg$`));

  const ownerUp = await complaintService.createUploadUrl(OWNER_A, 'partner', 'image/webp', ORDER_A);
  assert.match(ownerUp.path, new RegExp(`^complaints/${ORDER_A}/${OWNER_A}/[0-9a-f-]+\\.webp$`));

  const adminUp = await complaintService.createUploadUrl(ADMIN_ID, 'admin', 'image/png', ORDER_A);
  assert.match(adminUp.path, new RegExp(`^complaints/${ORDER_A}/${ADMIN_ID}/[0-9a-f-]+\\.png$`));

  // Private bucket selection via COMPLAINT_STORAGE_BUCKET env var
  const prevBucket = process.env.COMPLAINT_STORAGE_BUCKET;
  try {
    process.env.COMPLAINT_STORAGE_BUCKET = 'complaint-evidence';
    const privUp = await complaintService.createUploadUrl(CUST_A, 'customer', 'image/jpeg', ORDER_A);
    assert.ok(privUp.public_url.includes('/complaint-evidence/complaints/'));
    assert.equal(uploadedBuckets.at(-1).bucket, 'complaint-evidence');
  } finally {
    if (prevBucket === undefined) delete process.env.COMPLAINT_STORAGE_BUCKET;
    else process.env.COMPLAINT_STORAGE_BUCKET = prevBucket;
  }

  // assertEvidenceUrls: allows same-order (both buckets, case-insensitive UUID/actorId) & legacy URLs, rejects cross-order & external URLs
  const sameOrderPublic = `http://127.0.0.1:9/storage/v1/object/public/partner-assets/complaints/${ORDER_A}/${CUST_A}/img1.jpg`;
  const sameOrderUpperActor = `http://127.0.0.1:9/storage/v1/object/public/partner-assets/complaints/${ORDER_A.toUpperCase()}/${CUST_A.toUpperCase()}/img-upper.jpg`;
  const sameOrderPrivate = `http://127.0.0.1:9/storage/v1/object/public/complaint-evidence/complaints/${ORDER_A}/${CUST_A}/img2.png`;
  const legacyUrl = `http://127.0.0.1:9/storage/v1/object/public/partner-assets/complaints/customer-${CUST_A}/old.jpg`;
  const otherOrderUrl = `http://127.0.0.1:9/storage/v1/object/public/partner-assets/complaints/${ORDER_B}/${CUST_A}/stolen.jpg`;
  const otherActorUrl = `http://127.0.0.1:9/storage/v1/object/public/partner-assets/complaints/${ORDER_A}/${CUST_B}/spoof.jpg`;
  const externalUrl = 'https://evil.example.com/complaints/img.jpg';

  assert.deepEqual(assertEvidenceUrls([sameOrderPublic, sameOrderUpperActor, sameOrderPrivate, legacyUrl], ORDER_A, CUST_A), [
    sameOrderPublic,
    sameOrderUpperActor,
    sameOrderPrivate,
    legacyUrl,
  ]);

  assert.throws(
    () => assertEvidenceUrls([otherOrderUrl], ORDER_A, CUST_A),
    (err) => err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
  );
  assert.throws(
    () => assertEvidenceUrls([otherActorUrl], ORDER_A, CUST_A),
    (err) => err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
  );
  assert.throws(
    () => assertEvidenceUrls([externalUrl], ORDER_A, CUST_A),
    (err) => err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
  );

  // signEvidenceUrls: signs complaint-evidence URLs for 10 min (600s), skips traversal paths, leaves legacy partner-assets URLs untouched
  const traversalDotDot = `http://127.0.0.1:9/storage/v1/object/public/complaint-evidence/complaints/../secret.png`;
  const traversalBackslash = `http://127.0.0.1:9/storage/v1/object/public/complaint-evidence/complaints\\..\\secret.png`;
  const signed = await signEvidenceUrls([legacyUrl, sameOrderPrivate, traversalDotDot, traversalBackslash]);
  assert.equal(signed[0], legacyUrl);
  assert.match(signed[1], /\/storage\/v1\/object\/sign\/complaint-evidence\/complaints\/.*exp=600/);
  assert.equal(signed[2], traversalDotDot);
  assert.equal(signed[3], traversalBackslash);
  assert.equal(signedUrlCalls.length, 1);
  assert.equal(signedUrlCalls[0].expiresIn, 600);
});

test('database/Orders/043b_private_storage_buckets.sql drafts idempotent private buckets and strict RLS policies', () => {
  const sql = read('database/Orders/043b_private_storage_buckets.sql');

  assert.match(sql, /^\s*BEGIN;/m);
  assert.match(sql, /SET LOCAL lock_timeout\s*=\s*'5s';/i);
  assert.match(sql, /^\s*COMMIT;/m);
  assert.match(sql, /hoàn tác|rollback/i);

  // complaint-evidence: private, 5MB, jpeg/png/webp
  assert.match(sql, /'complaint-evidence'[\s\S]{0,160}false[\s\S]{0,160}5242880[\s\S]{0,160}image\/jpeg[\s\S]{0,80}image\/png[\s\S]{0,80}image\/webp/i);
  // kyc-documents: private, 10MB, jpeg/png/webp/pdf
  assert.match(sql, /'kyc-documents'[\s\S]{0,160}false[\s\S]{0,160}10485760[\s\S]{0,160}application\/pdf/i);
  // Idempotent upsert setting public = false
  assert.match(sql, /ON CONFLICT\s*\(id\)\s*DO UPDATE[\s\S]{0,120}public\s*=\s*false/i);

  // Strict storage.objects RLS policies denying anon and scoping authenticated to own folder or is_admin()
  assert.match(sql, /CREATE POLICY\s+private_buckets_deny_anon[\s\S]{0,160}ON storage\.objects[\s\S]{0,120}AS RESTRICTIVE[\s\S]{0,120}TO anon/i);
  assert.match(sql, /CREATE POLICY\s+complaint_evidence_authenticated_select[\s\S]{0,200}ON storage\.objects[\s\S]{0,120}TO authenticated/i);
  assert.match(sql, /CREATE POLICY\s+kyc_documents_authenticated_select[\s\S]{0,200}ON storage\.objects[\s\S]{0,120}TO authenticated/i);
  assert.match(sql, /public\.is_admin\(\)/i);
  assert.match(sql, /storage\.foldername\(name\)/i);
  assert.match(sql, /auth\.uid\(\)::text/i);
});
