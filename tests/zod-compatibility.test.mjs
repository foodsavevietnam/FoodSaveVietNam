import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { ZodError } = require('zod');
const { registerPartnerBodySchema } = require('../dist/schemas/authSchemas.js');
const {
  createProductBodySchema,
  productListQuerySchema,
  storeListQuerySchema,
  updateProductBodySchema,
} = require('../dist/schemas/catalogSchemas.js');
const {
  createCharityProfileBodySchema,
  createVolunteerBodySchema,
  updateCharityProfileBodySchema,
  updateVolunteerBodySchema,
} = require('../dist/schemas/charitySchemas.js');
const { marketingSettingsBodySchema } = require('../dist/schemas/marketingSchemas.js');
const { notificationListQuerySchema } = require('../dist/schemas/notificationSchemas.js');
const { createOrderBodySchema } = require('../dist/schemas/orderSchemas.js');
const { updateProfileBodySchema } = require('../dist/schemas/profileSchemas.js');
const { createApplicationBodySchema } = require('../dist/schemas/supportSchemas.js');
const { validateRequest } = require('../dist/middlewares/validateRequest.js');

const entityId = '5e7c22d1-9911-45cf-a06e-2710962c77e4';
const partner = {
  store_name: 'MIO Test Store',
  email: ' TEST@EXAMPLE.COM ',
  phone: '0900000000',
  password: 'TestOnly123',
  address: '100 Test Street',
  business_type: 'bakery',
  representative_name: 'Test Representative',
  terms_accepted: true,
};

test('partner documents remain optional string-keyed records and registration defaults survive', () => {
  const parsed = registerPartnerBodySchema.parse({
    ...partner,
    documents: { business_license: ' document-reference ', supplemental: 'extra-reference' },
  });
  assert.equal(parsed.email, 'test@example.com');
  assert.equal(parsed.city, 'TP.HCM');
  assert.deepEqual(parsed.documents, { business_license: 'document-reference', supplemental: 'extra-reference' });
  assert.equal(Object.hasOwn(registerPartnerBodySchema.parse(partner), 'documents'), false);
  assert.equal(registerPartnerBodySchema.safeParse({ ...partner, documents: { license: ' ' } }).success, false);
});

test('metadata records preserve arbitrary nested JSON without accepting unknown top-level fields', () => {
  const metadata = { preferences: { locale: 'vi' }, enabled: true, labels: ['fresh'], optional: null };
  assert.deepEqual(updateProfileBodySchema.parse({ metadata }), { metadata });
  assert.deepEqual(updateProfileBodySchema.parse({}), {});
  assert.equal(updateProfileBodySchema.safeParse({ metadata, unexpected: true }).success, false);
});

test('support applications retain an empty default payload and arbitrary nested payload fields', () => {
  const body = {
    type: 'partner', org_name: 'MIO Test', contact_name: 'Test Contact',
    email: 'test@example.com', phone: '0900000000',
  };
  assert.deepEqual(createApplicationBodySchema.parse(body).payload, {});
  assert.deepEqual(createApplicationBodySchema.parse({ ...body, payload: { source: 'web', values: [1, null] } }).payload,
    { source: 'web', values: [1, null] });
});

test('marketing settings PATCH accepts one channel while rejecting unsupported channels', () => {
  assert.deepEqual(marketingSettingsBodySchema.parse({ channels: { facebook: { enabled: false } } }),
    { channels: { facebook: { enabled: false } } });
  assert.deepEqual(marketingSettingsBodySchema.parse({}), {});
  assert.equal(marketingSettingsBodySchema.safeParse({ channels: { unsupported: { enabled: true } } }).success, false);
  assert.equal(marketingSettingsBodySchema.safeParse({ channels: { facebook: { unexpected: true } } }).success, false);
});

test('charity PATCH does not reset beneficiaries when a different field is updated', () => {
  const created = createCharityProfileBodySchema.parse({
    name: 'MIO Test Charity', slug: 'mio-test-charity', phone: '0900000000',
    email: 'test@example.com', address: '100 Test Street', city: 'Test City',
  });
  assert.equal(created.beneficiaries_count, 0);
  assert.deepEqual(updateCharityProfileBodySchema.parse({ name: 'Updated Charity' }), { name: 'Updated Charity' });
  assert.deepEqual(updateCharityProfileBodySchema.parse({}), {});
  assert.deepEqual(updateCharityProfileBodySchema.parse({ beneficiaries_count: 12 }), { beneficiaries_count: 12 });
});

test('volunteer PATCH keeps omitted role, duty and status while creation still applies defaults', () => {
  const created = createVolunteerBodySchema.parse({
    charity_id: entityId, full_name: 'Test Volunteer', phone: '0900000000',
    email: 'test@example.com', vehicle: 'Bicycle', zones: ['District 1'], schedule: 'Weekdays',
  });
  assert.equal(created.role, 'Tình nguyện viên');
  assert.equal(created.duty_role, 'both');
  assert.equal(created.status, 'new');
  assert.deepEqual(updateVolunteerBodySchema.parse({ phone: '0900000001' }), { phone: '0900000001' });
  assert.deepEqual(updateVolunteerBodySchema.parse({}), {});
  assert.deepEqual(updateVolunteerBodySchema.parse({ role: 'Driver', duty_role: 'pickup', status: 'active' }),
    { role: 'Driver', duty_role: 'pickup', status: 'active' });
});

test('product create defaults do not spill into PATCH and paginated query numbers still coerce', () => {
  const product = createProductBodySchema.parse({
    name: 'Test Product', category: 'Bakery', original_price_cents: 10000,
    expires_at: new Date(Date.now() + 86400000).toISOString(), stock_quantity: 5,
    metadata: { tags: ['fresh'] },
  });
  assert.equal(product.is_active, true);
  assert.equal(product.is_donation, false);
  assert.deepEqual(updateProductBodySchema.parse({ stock_quantity: 7 }), { stock_quantity: 7 });
  const query = productListQuerySchema.parse({ page: '2', limit: '5', lat: '10.7', lng: '106.6' });
  assert.equal(query.page, 2);
  assert.equal(query.limit, 5);
  assert.equal(query.lat, 10.7);
  assert.equal(query.radius_km, 5);
  assert.equal(query.sort, 'newest');
});

test('request middleware still parses defaults and invalid nested inputs expose issue paths', () => {
  const request = { query: { page: '2' } };
  let nextCalls = 0;
  validateRequest({ query: productListQuerySchema })(request, {}, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(request.validated.query.page, 2);
  assert.equal(request.validated.query.limit, 20);

  assert.throws(() => validateRequest({ body: createOrderBodySchema })({
    body: { items: [{ product_id: entityId, quantity: 0 }], payment_method: 'vietqr' },
  }, {}, () => { throw new Error('invalid input must not reach the controller'); }), (error) => {
    assert.ok(error instanceof ZodError);
    const quantityIssue = error.issues.find((issue) => issue.path.join('.') === 'items.0.quantity');
    assert.ok(quantityIssue);
    assert.equal(typeof quantityIssue.message, 'string');
    assert.ok(quantityIssue.message.length > 0);
    return true;
  });
});

test('order request bounds and duplicate-product safeguards remain active', () => {
  const validOrder = { items: [{ product_id: entityId, quantity: 1 }], payment_method: 'vietqr' };
  const parsed = createOrderBodySchema.parse(validOrder);
  assert.equal(parsed.pickup_slot_key, 'policy');
  assert.equal(parsed.donation_cents, 0);
  assert.equal(createOrderBodySchema.safeParse({ ...validOrder, items: [validOrder.items[0], validOrder.items[0]] }).success, false);
  const tooMany = createOrderBodySchema.safeParse({ ...validOrder, items: Array(51).fill(validOrder.items[0]) });
  assert.equal(tooMany.success, false);
  assert.ok(tooMany.error.issues.some((issue) => issue.path.join('.') === 'items' && issue.code === 'too_big'));
});

test('URL boolean filters distinguish false from true and reject malformed values', () => {
  for (const value of [true, 'true', 'TRUE', '1']) {
    assert.equal(productListQuerySchema.parse({ donation: value }).donation, true);
    assert.equal(storeListQuerySchema.parse({ verified: value, open: value }).verified, true);
    assert.equal(storeListQuerySchema.parse({ verified: value, open: value }).open, true);
    assert.equal(notificationListQuerySchema.parse({ unread_only: value }).unread_only, true);
  }
  for (const value of [false, 'false', 'FALSE', '0']) {
    assert.equal(productListQuerySchema.parse({ donation: value }).donation, false);
    assert.equal(storeListQuerySchema.parse({ verified: value, open: value }).verified, false);
    assert.equal(storeListQuerySchema.parse({ verified: value, open: value }).open, false);
    assert.equal(notificationListQuerySchema.parse({ unread_only: value }).unread_only, false);
  }
  assert.equal(Object.hasOwn(productListQuerySchema.parse({}), 'donation'), false);
  assert.equal(Object.hasOwn(storeListQuerySchema.parse({}), 'verified'), false);
  assert.equal(Object.hasOwn(storeListQuerySchema.parse({}), 'open'), false);
  assert.equal(notificationListQuerySchema.parse({}).unread_only, false);
  for (const value of ['nonsense', '', ['false'], { value: false }]) {
    assert.equal(productListQuerySchema.safeParse({ donation: value }).success, false);
    assert.equal(storeListQuerySchema.safeParse({ verified: value }).success, false);
    assert.equal(storeListQuerySchema.safeParse({ open: value }).success, false);
    assert.equal(notificationListQuerySchema.safeParse({ unread_only: value }).success, false);
  }
});
