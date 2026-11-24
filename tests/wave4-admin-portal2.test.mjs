import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIONS, actionLabel, badge } from '../public/admin/core/vi.js';
import { matchScreens } from '../public/admin/core/shell.js';
import { SCREENS } from '../public/admin/screens/manifest.js';
import { createDemoApi } from '../public/admin/demo/index.js';

test('SQL 043_admin_portal.sql: transaction, lock_timeout, idempotent columns, policy, pg_trgm safe, rollback, no handle_new_user', () => {
  const sql = readFileSync('database/Admin/043_admin_portal.sql', 'utf8');
  assert.match(sql, /\bBEGIN;/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s';/);
  assert.match(sql, /\bCOMMIT;/);
  assert.match(sql, /Hướng dẫn hoàn tác/i);
  assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.handle_new_user/i, 'không được đụng handle_new_user');

  // Required columns with IF NOT EXISTS
  for (const snippet of [
    /ALTER TABLE public\.profiles[\s\S]*?ADD COLUMN IF NOT EXISTS suspended_at timestamptz/i,
    /ADD COLUMN IF NOT EXISTS suspended_reason text/i,
    /ALTER TABLE public\.stores[\s\S]*?ADD COLUMN IF NOT EXISTS suspended_by uuid/i,
    /ALTER TABLE public\.charity_profiles[\s\S]*?ADD COLUMN IF NOT EXISTS suspended_at timestamptz/i,
    /ALTER TABLE public\.products[\s\S]*?ADD COLUMN IF NOT EXISTS admin_hidden_at timestamptz/i,
    /ADD COLUMN IF NOT EXISTS admin_hidden_reason text/i,
    /ADD COLUMN IF NOT EXISTS admin_hidden_by uuid/i,
    /ALTER TABLE public\.reviews[\s\S]*?ADD COLUMN IF NOT EXISTS hidden_at timestamptz/i,
    /ADD COLUMN IF NOT EXISTS hidden_reason text/i,
    /ADD COLUMN IF NOT EXISTS hidden_by uuid/i,
    /to_regclass\('public\.contact_messages'\)/i,
    /to_regclass\('public\.applications'\)/i,
    /ADD COLUMN IF NOT EXISTS admin_note text/i,
    /ADD COLUMN IF NOT EXISTS handled_by uuid/i,
    /ADD COLUMN IF NOT EXISTS handled_at timestamptz/i,
  ]) {
    assert.match(sql, snippet);
  }

  // Reviews policy excludes hidden reviews unless is_admin()
  assert.match(sql, /CREATE POLICY reviews_public_select[\s\S]*?USING\s*\(hidden_at IS NULL OR public\.is_admin\(\)\)/i);

  // pg_trgm wrapped safely in DO block handling insufficient_privilege
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pg_trgm;[\s\S]*?EXCEPTION WHEN insufficient_privilege THEN[\s\S]*?NULL;/i);
  assert.match(sql, /profiles_full_name_trgm_idx/i);
  assert.match(sql, /stores_name_trgm_idx/i);
  assert.match(sql, /orders_order_number_trgm_idx/i);
});

test('vi.js: có đủ 7 nhãn hành động tiếng Việt cho Đợt 2 và các badge trạng thái', () => {
  const required = [
    'account.suspend',
    'account.unsuspend',
    'store.suspend',
    'store.unsuspend',
    'charity.suspend',
    'charity.unsuspend',
    'volunteer.status',
  ];
  for (const key of required) {
    assert.ok(Object.prototype.hasOwnProperty.call(ACTIONS, key), `Thiếu ACTIONS[${key}]`);
    assert.notEqual(actionLabel(key), key);
    assert.doesNotMatch(actionLabel(key), /[a-z]+\.[a-z_]+/);
  }
  assert.match(badge('accountStatus', 'suspended'), /Tạm khóa/);
  assert.match(badge('storeStatus', 'suspended'), /Tạm ngưng/);
  assert.match(badge('charityStatus', 'active'), /Đang hoạt động/);
  assert.match(badge('volunteerStatus', 'inactive'), /Tạm ngưng/);
});

test('shell.js: matchScreens giữ nguyên hành vi khớp không dấu', () => {
  assert.deepEqual(matchScreens('cua hang', SCREENS).map((s) => s.id), ['stores']);
  assert.deepEqual(matchScreens('nguoi mua', SCREENS).map((s) => s.id), ['customers']);
  assert.deepEqual(matchScreens('tinh nguyen', SCREENS).map((s) => s.id), ['charities']);
});

test('demo API: hỗ trợ đầy đủ endpoints Đợt 2 (accounts, stores, charities, volunteers, search) và giữ endpoint cũ', async () => {
  const api = createDemoApi();

  // Accounts
  const accList = await api.get('/admin/accounts?role=customer&page=1&limit=10');
  assert.ok(accList.items.length >= 3);
  assert.ok(accList.counts.total >= 3);
  const firstId = accList.items[0].id;
  const accDetail = await api.get(`/admin/accounts/${firstId}`);
  assert.equal(accDetail.profile.id, firstId);
  assert.ok(accDetail.order_stats);
  await api.post(`/admin/accounts/${firstId}/status`, { status: 'suspended', reason: 'Kiểm thử khóa' });
  const afterSuspend = await api.get(`/admin/accounts/${firstId}`);
  assert.equal(afterSuspend.profile.status, 'suspended');
  await api.post(`/admin/accounts/${firstId}/status`, { status: 'active' });

  // Old endpoint preserved
  const oldUsers = await api.get('/admin/users');
  assert.ok(Array.isArray(oldUsers.buyers) && oldUsers.buyers.length > 0);

  // Stores
  const stList = await api.get('/admin/stores?status=active');
  assert.ok(stList.items.length >= 1);
  const stId = stList.items[0].id;
  const stDetail = await api.get(`/admin/stores/${stId}`);
  assert.equal(stDetail.store.id, stId);
  assert.ok(stDetail.wallet && stDetail.product_summary);
  assert.ok(!JSON.stringify(stDetail.partner_profile).includes('bank_account_number'));
  const stProds = await api.get(`/admin/stores/${stId}/products`);
  assert.ok(Array.isArray(stProds.items));

  // Charities & Volunteers
  const chList = await api.get('/admin/charities?status=active');
  assert.ok(chList.items.length >= 1);
  const chId = chList.items[0].id;
  const chDetail = await api.get(`/admin/charities/${chId}`);
  assert.equal(chDetail.charity.id, chId);
  assert.ok(Array.isArray(chDetail.volunteers));
  assert.ok(!JSON.stringify(chDetail.recent_donations).includes('pickup_code'));

  const volList = await api.get('/admin/volunteers');
  assert.ok(volList.items.length >= 1);

  // Global search
  const sr = await api.get('/admin/search?q=mẫu');
  assert.ok(Array.isArray(sr.accounts) && sr.accounts.length > 0);
  assert.ok(Array.isArray(sr.stores) && sr.stores.length > 0);
  assert.ok(Array.isArray(sr.charities) && sr.charities.length > 0);
  for (const a of sr.accounts) {
    if (a.phone) assert.match(a.phone, /\*\*\*/);
  }
});
