import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

function runIsolated(code, extraEnv = {}) {
  const result = spawnSync(process.execPath, ['--input-type=commonjs', '-e', code], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || 'Isolated Wave 2B test failed.');
  return result.stdout;
}

const baseMockHelper = `
  const assert = require('node:assert/strict');
  function mockModule(rel, exports) {
    const resolved = require.resolve(rel);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  }
  const fakeEnv = {
    NODE_ENV: 'production',
    PORT: 8080,
    API_BASE_PATH: '/api/v1',
    PASSWORD_RESET_REDIRECT_URL: 'https://makeitorganized.netlify.app/reset-password',
    GOOGLE_OAUTH_REDIRECT_URL: 'https://makeitorganized.netlify.app/FOODSAVE_USER.html',
    FACEBOOK_OAUTH_REDIRECT_URL: 'https://makeitorganized.netlify.app/FOODSAVE_USER.html',
    GOOGLE_OTP_EXPIRES_SECONDS: 600,
    PHONE_OTP_EXPIRES_SECONDS: 600,
    SUPABASE_URL: 'https://demo.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key-test',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role-key-0123456789abcdef',
    CORS_ORIGINS: ['https://makeitorganized.netlify.app', 'https://app.mio.vn'],
    SOCKET_CORS_ORIGINS: ['https://makeitorganized.netlify.app'],
    PUBLIC_SITE_URL: 'https://makeitorganized.netlify.app/FOODSAVE_USER.html',
    RATE_LIMIT_WINDOW_MS: 60000,
    RATE_LIMIT_MAX_REQUESTS: 120,
    RATE_LIMIT_REDIS_URL: undefined,
    RATE_LIMIT_REDIS_TOKEN: undefined,
    VOLUNTEER_TOKEN_SECRET: undefined,
    NEON_ACTIVITY_ENABLED: true,
    DEMO_MODE: false,
    ORDER_POLICY_TIME_SCALE: 1,
    PHOTO_REVIEW_MINUTES: 360,
    PHOTO_GPS_MAX_METERS: 500,
    PAYMENT_PROVIDER: 'simulated',
    PAYOUT_PROVIDER: 'manual',
    MOMO_API_BASE_URL: 'https://test-payment.momo.vn/v2/gateway/api',
    MOMO_PARTNER_CODE: 'MOMO',
    MOMO_REDIRECT_URL: 'https://makeitorganized.netlify.app/api/v1/orders/payments/momo/return',
    MOMO_IPN_URL: 'https://makeitorganized.netlify.app/api/v1/orders/payments/momo/webhook/mock',
    LOG_LEVEL: 'error',
  };
  mockModule('./dist/config/env.js', { env: fakeEnv });
`;

test('volunteerToken supports dual-key rotation with VOLUNTEER_TOKEN_SECRET and legacy fallback', () => {
  runIsolated(`
    ${baseMockHelper}
    const {
      createVolunteerToken,
      verifyVolunteerToken,
      createSelectionToken,
      verifySelectionToken,
    } = require('./dist/utils/volunteerToken.js');

    // 1. Legacy token minted before VOLUNTEER_TOKEN_SECRET is enabled
    const legacyVolToken = createVolunteerToken('vol-1', 'charity-1', 'otp');
    const legacySelToken = createSelectionToken('TNV@Example.com');
    assert.equal(verifyVolunteerToken(legacyVolToken)?.vid, 'vol-1');
    assert.equal(verifyVolunteerToken(legacyVolToken)?.amr, 'otp');
    assert.equal(verifySelectionToken(legacySelToken)?.email, 'tnv@example.com');

    // 2. Enable dedicated VOLUNTEER_TOKEN_SECRET (>= 32 chars)
    fakeEnv.VOLUNTEER_TOKEN_SECRET = 'dedicated-volunteer-hmac-secret-32-chars-min';
    const rotatedVolToken = createVolunteerToken('vol-2', 'charity-2', 'otp');
    const rotatedSelToken = createSelectionToken('Next@Example.com');

    // Both rotated tokens and legacy 12h tokens verify cleanly
    assert.equal(verifyVolunteerToken(rotatedVolToken)?.vid, 'vol-2');
    assert.equal(verifyVolunteerToken(legacyVolToken)?.vid, 'vol-1');
    assert.equal(verifySelectionToken(rotatedSelToken)?.email, 'next@example.com');
    assert.equal(verifySelectionToken(legacySelToken)?.email, 'tnv@example.com');

    // Cross-purpose tokens never verify
    assert.equal(verifyVolunteerToken(rotatedSelToken), null);
    assert.equal(verifySelectionToken(rotatedVolToken), null);

    // 3. Prove rotatedVolToken is truly signed with VOLUNTEER_TOKEN_SECRET (not SUPABASE_SERVICE_ROLE_KEY)
    fakeEnv.SUPABASE_SERVICE_ROLE_KEY = 'completely-different-service-role-key-999999';
    assert.equal(verifyVolunteerToken(rotatedVolToken)?.vid, 'vol-2');
    assert.equal(verifyVolunteerToken(legacyVolToken), null);
  `);
});

test('PATCH /volunteer/me blocks changing login email while preserving backward-compatible unchanged email', () => {
  runIsolated(`
    ${baseMockHelper}
    const writes = [];
    const existingRow = {
      id: 'vol-1',
      charity_id: 'charity-1',
      full_name: 'Nguyen Van A',
      phone: '0901234567',
      email: 'tnv@mio.vn',
      vehicle: 'Xe may',
      zones: ['Quan 1'],
      schedule: 'Sang',
      role: 'volunteer',
      duty_role: 'both',
      active_on: null,
      avatar_url: null,
      status: 'active',
      runs: 1,
      kg_collected: 5,
      rating: 5,
      charity_profiles: { name: 'Hoi Chu Thap Do', owner_id: 'owner-1' },
    };
    mockModule('./dist/services/supabaseService.js', {
      supabaseAdmin: {
        from(table) {
          if (table === 'volunteers') {
            return {
              select() { return this; },
              eq() { return this; },
              update(payload) { writes.push(payload); return this; },
              async maybeSingle() { return { data: { ...existingRow, ...(writes.at(-1) || {}) }, error: null }; },
              then(resolve) { resolve({ error: null }); },
            };
          }
          return { insert: async () => ({ error: null }) };
        },
      },
      supabaseAuth: { auth: {} },
      handleSupabaseError(err) { throw err; },
      requireRecord(v) { if (!v) throw new Error('missing'); return v; },
    });
    mockModule('./dist/services/notificationService.js', { createNotification: async () => {} });

    const { volunteerService } = require('./dist/services/volunteerService.js');
    (async () => {
      // Changing email is forbidden (403 AUTH_FORBIDDEN)
      await assert.rejects(
        volunteerService.updateProfile('vol-1', { email: 'hacker@evil.com', vehicle: 'Xe dap' }),
        (err) => err.statusCode === 403 && err.code === 'AUTH_FORBIDDEN'
      );
      assert.equal(writes.length, 0);

      // Sending unchanged email (like legacy frontend form) is allowed, and email is stripped from DB update
      const updated = await volunteerService.updateProfile('vol-1', { email: ' TNV@mio.vn ', vehicle: 'Xe dap' });
      assert.equal(updated.vehicle, 'Xe dap');
      assert.equal(writes.length, 1);
      assert.deepEqual(writes[0], { vehicle: 'Xe dap' });
      assert.equal('email' in writes[0], false);
    })().catch((err) => { console.error(err); process.exitCode = 1; });
  `);
});

test('authService.refreshSession blocks suspended profiles and attempts to revoke the session', () => {
  runIsolated(`
    ${baseMockHelper}
    const signOutCalls = [];
    const auditLogs = [];
    let currentStatus = 'suspended';

    mockModule('./dist/config/supabase.js', {
      supabaseAuth: {
        auth: {
          async refreshSession() {
            return {
              data: {
                user: { id: 'user-1', email: 'u@mio.vn', phone: '0901234567', created_at: '2026-01-01T00:00:00Z' },
                session: { access_token: 'access-tok-123', refresh_token: 'refresh-tok-456', expires_at: 9999999999, token_type: 'bearer' },
              },
              error: null,
            };
          },
        },
      },
      supabaseAdmin: {
        auth: {
          admin: {
            async signOut(token, scope) {
              signOutCalls.push({ token, scope });
              return { error: null };
            },
          },
        },
        from(table) {
          if (table === 'profiles') {
            return {
              select() { return this; },
              eq() { return this; },
              async single() {
                return { data: { id: 'user-1', role: 'customer', email: 'u@mio.vn', status: currentStatus }, error: null };
              },
            };
          }
          if (table === 'customer_profiles') {
            return {
              select() { return this; },
              eq() { return this; },
              async maybeSingle() { return { data: null, error: null }; },
            };
          }
          if (table === 'auth_audit_logs') {
            return {
              async insert(row) { auditLogs.push(row); return { error: null }; },
            };
          }
          throw new Error('Unexpected table: ' + table);
        },
      },
    });

    const { authService } = require('./dist/services/authService.js');
    (async () => {
      await assert.rejects(
        authService.refreshSession({ refresh_token: 'rt-1' }, { ipAddress: '1.2.3.4', userAgent: 'test' }),
        (err) => err.statusCode === 403 && err.code === 'AUTH_FORBIDDEN'
      );
      assert.deepEqual(signOutCalls, [{ token: 'access-tok-123', scope: 'local' }]);
      assert.ok(auditLogs.some((entry) => entry.event_type === 'LOGIN_FAILED' && entry.metadata?.reason === 'SUSPENDED'));

      // Active user refreshes normally
      currentStatus = 'active';
      const result = await authService.refreshSession({ refresh_token: 'rt-2' }, { ipAddress: '1.2.3.4', userAgent: 'test' });
      assert.equal(result.profile.status, 'active');
      assert.equal(result.session.access_token, 'access-tok-123');
    })().catch((err) => { console.error(err); process.exitCode = 1; });
  `);
});

test('authService.startOAuth enforces redirect_to allowlist and custom mio: scheme', () => {
  runIsolated(`
    ${baseMockHelper}
    let oauthCalls = 0;
    mockModule('./dist/config/supabase.js', {
      supabaseAuth: {
        auth: {
          async signInWithOAuth({ options }) {
            oauthCalls += 1;
            return { data: { url: 'https://accounts.google.com/o/oauth2/auth?redirect=' + encodeURIComponent(options.redirectTo) }, error: null };
          },
        },
      },
      supabaseAdmin: {
        from() { return { insert: async () => ({ error: null }) }; },
      },
    });

    const { authService, assertAllowedRedirectUrl } = require('./dist/services/authService.js');
    (async () => {
      // Blocked external domains, unsafe schemes, and http in production
      for (const badUrl of [
        'https://evil.example/steal',
        'javascript:alert(1)',
        'http://makeitorganized.netlify.app/FOODSAVE_USER.html',
        'https://user:pass@makeitorganized.netlify.app/FOODSAVE_USER.html',
        'not-a-url',
      ]) {
        assert.throws(
          () => assertAllowedRedirectUrl(badUrl),
          (err) => err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
          'Should reject: ' + badUrl
        );
      }

      await assert.rejects(
        authService.startGoogleOAuth({ redirect_to: 'https://evil.example/cb' }, { ipAddress: null, userAgent: null }),
        (err) => err.statusCode === 400 && err.code === 'VALIDATION_ERROR'
      );
      assert.equal(oauthCalls, 0);

      // Allowed: origin in CORS_ORIGINS / PUBLIC_SITE_URL and custom scheme mio:
      const okWeb = await authService.startGoogleOAuth(
        { redirect_to: 'https://app.mio.vn/auth/callback' },
        { ipAddress: null, userAgent: null }
      );
      assert.equal(okWeb.redirect_to, 'https://app.mio.vn/auth/callback');

      const okApp = await authService.startFacebookOAuth(
        { redirect_to: 'mio://auth/callback' },
        { ipAddress: null, userAgent: null }
      );
      assert.equal(okApp.redirect_to, 'mio://auth/callback');
      assert.equal(oauthCalls, 2);

      // Outside production, http:// origin in allowlist is accepted
      fakeEnv.NODE_ENV = 'development';
      fakeEnv.CORS_ORIGINS.push('http://localhost:5500');
      assert.equal(assertAllowedRedirectUrl('http://localhost:5500/FOODSAVE_USER.html'), 'http://localhost:5500/FOODSAVE_USER.html');
    })().catch((err) => { console.error(err); process.exitCode = 1; });
  `);
});

test('authService OTP verification locks after 5 failures and fails open if auth_otp_attempts is absent', () => {
  runIsolated(`
    ${baseMockHelper}
    const attemptsStore = new Map();
    let missingTable = false;
    let verifyCalls = 0;

    mockModule('./dist/config/supabase.js', {
      supabaseAuth: {
        auth: {
          async verifyOtp() {
            verifyCalls += 1;
            return { data: { user: null, session: null }, error: { message: 'Invalid OTP' } };
          },
        },
      },
      supabaseAdmin: {
        from(table) {
          if (table === 'auth_google_otp_challenges') {
            return {
              select() { return this; },
              eq() { return this; },
              async single() {
                return {
                  data: {
                    id: 'ch-1',
                    user_id: 'user-1',
                    email: 'buyer@mio.vn',
                    expected_role: 'customer',
                    expires_at: new Date(Date.now() + 600000).toISOString(),
                    verified_at: null,
                  },
                  error: null,
                };
              },
            };
          }
          if (table === 'auth_otp_attempts') {
            if (missingTable) {
              return {
                select() { return this; },
                eq() { return this; },
                async maybeSingle() { return { data: null, error: { code: '42P01', message: 'relation "auth_otp_attempts" does not exist' } }; },
              };
            }
            let filterKey = '';
            let filterFailedCount = null;
            let pendingPatch = null;
            return {
              select() { return this; },
              eq(col, val) {
                if (col === 'key') filterKey = val;
                if (col === 'failed_count') filterFailedCount = val;
                if (pendingPatch && col === 'failed_count') return this;
                return this;
              },
              async maybeSingle() { return { data: attemptsStore.get(filterKey) ?? null, error: null }; },
              async insert(row) { attemptsStore.set(row.key, { ...row }); return { error: null }; },
              update(patch) {
                pendingPatch = patch;
                return {
                  eq(col, val) {
                    if (col === 'key') filterKey = val;
                    return {
                      eq(c2, v2) {
                        if (c2 === 'failed_count') filterFailedCount = v2;
                        return {
                          async select() {
                            const cur = attemptsStore.get(filterKey);
                            if (cur && cur.failed_count === filterFailedCount) {
                              attemptsStore.set(filterKey, { ...cur, ...pendingPatch });
                              return { data: [{ key: filterKey }], error: null };
                            }
                            return { data: [], error: null };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }
          if (table === 'auth_audit_logs') {
            return { insert: async () => ({ error: null }) };
          }
          throw new Error('Unexpected table: ' + table);
        },
      },
    });

    const { authService } = require('./dist/services/authService.js');
    (async () => {
      // 5 failed attempts allowed before lock engages
      for (let i = 0; i < 5; i += 1) {
        await assert.rejects(
          authService.verifyGoogleOtp({ challenge_id: 'ch-1', otp: '000000' }, { ipAddress: null, userAgent: null }),
          (err) => err.statusCode === 401
        );
      }
      assert.equal(verifyCalls, 5);

      // 6th attempt is locked with 429 OTP_LOCKED without calling Supabase verifyOtp
      await assert.rejects(
        authService.verifyGoogleOtp({ challenge_id: 'ch-1', otp: '123456' }, { ipAddress: null, userAgent: null }),
        (err) => err.statusCode === 429 && err.code === 'OTP_LOCKED'
      );
      assert.equal(verifyCalls, 5);

      // Fail-open when migration 039 (auth_otp_attempts) has not been applied yet
      missingTable = true;
      await assert.rejects(
        authService.verifyGoogleOtp({ challenge_id: 'ch-1', otp: '123456' }, { ipAddress: null, userAgent: null }),
        (err) => err.statusCode === 401
      );
      assert.equal(verifyCalls, 6);
    })().catch((err) => { console.error(err); process.exitCode = 1; });
  `);
});

test('profileService.updateProfile normalizes VN phone numbers and rejects cross-variant duplicates', () => {
  runIsolated(`
    ${baseMockHelper}
    let duplicateRows = [];
    const updatedPayloads = [];
    let checkedVariants = [];

    mockModule('./dist/services/supabaseService.js', {
      supabaseAdmin: {
        from(table) {
          assert.equal(table, 'profiles');
          return {
            select() { return this; },
            in(_col, values) { checkedVariants = values; return this; },
            neq() { return this; },
            async limit() { return { data: duplicateRows, error: null }; },
            update(payload) {
              updatedPayloads.push(payload);
              return {
                eq() { return this; },
                select() { return this; },
                async single() { return { data: { id: 'user-1', ...payload }, error: null }; },
              };
            },
          };
        },
      },
      handleSupabaseError(err) { throw err; },
    });

    const { profileService } = require('./dist/services/profileService.js');
    (async () => {
      // Duplicate across +84 / 0 variants rejected with 409 RESOURCE_CONFLICT
      duplicateRows = [{ id: 'other-user' }];
      await assert.rejects(
        profileService.updateProfile('user-1', { phone: '+84 912 345 678' }),
        (err) => err.statusCode === 409 && err.code === 'RESOURCE_CONFLICT'
      );
      assert.ok(checkedVariants.includes('0912345678'));
      assert.ok(checkedVariants.includes('+84912345678'));
      assert.equal(updatedPayloads.length, 0);

      // Unique phone is normalized to canonical Vietnamese 0... format
      duplicateRows = [];
      const updated = await profileService.updateProfile('user-1', { phone: '+84 912-345-678' });
      assert.equal(updated.phone, '0912345678');
      assert.equal(updatedPayloads[0].phone, '0912345678');
    })().catch((err) => { console.error(err); process.exitCode = 1; });
  `);
});

test('catalogController sets public CDN cache headers for anonymous GETs and no-store when Authorization is present', () => {
  runIsolated(`
    ${baseMockHelper}
    mockModule('./dist/services/catalogService.js', {
      catalogService: {
        listProducts: async () => ({ items: [] }),
        getProduct: async () => ({ id: 'p-1' }),
        listStores: async () => ({ items: [] }),
        getStore: async () => ({ id: 's-1' }),
        listVouchers: async () => ({ items: [] }),
      },
    });
    mockModule('./dist/services/policyConfigService.js', {
      policyConfigService: { ensureFresh: async () => {} },
    });

    const { catalogController } = require('./dist/controllers/catalogController.js');

    function makeRes() {
      const headers = new Map();
      return {
        headers,
        setHeader(k, v) { headers.set(k.toLowerCase(), v); },
        status() { return this; },
        json() { return this; },
      };
    }

    (async () => {
      for (const [method, reqExtra] of [
        ['listProducts', { validated: { query: {} } }],
        ['getProduct', { validated: { params: { id: 'p-1' } } }],
        ['listStores', { validated: { query: {} } }],
        ['getStore', { validated: { params: { id: 's-1' } } }],
        ['listVouchers', { validated: { query: {} } }],
      ]) {
        const anonRes = makeRes();
        await catalogController[method]({ headers: {}, ...reqExtra }, anonRes);
        assert.equal(
          anonRes.headers.get('cache-control'),
          'public, max-age=15, s-maxage=30, stale-while-revalidate=60',
          method + ' anonymous Cache-Control'
        );
        assert.equal(
          anonRes.headers.get('netlify-cdn-cache-control'),
          'public, durable, s-maxage=30, stale-while-revalidate=60',
          method + ' anonymous Netlify-CDN-Cache-Control'
        );

        const authRes = makeRes();
        await catalogController[method]({ headers: { authorization: 'Bearer jwt' }, ...reqExtra }, authRes);
        assert.equal(authRes.headers.get('cache-control'), 'no-store, private', method + ' auth Cache-Control');
        assert.equal(authRes.headers.get('netlify-cdn-cache-control'), undefined, method + ' auth should not set CDN cache');
      }

      // getPolicy uses longer public TTL (60/300/600)
      const policyAnonRes = makeRes();
      await catalogController.getPolicy({ headers: {} }, policyAnonRes);
      assert.equal(policyAnonRes.headers.get('cache-control'), 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
      assert.equal(policyAnonRes.headers.get('netlify-cdn-cache-control'), 'public, durable, s-maxage=300, stale-while-revalidate=600');

      const policyAuthRes = makeRes();
      await catalogController.getPolicy({ headers: { authorization: 'Bearer jwt' } }, policyAuthRes);
      assert.equal(policyAuthRes.headers.get('cache-control'), 'no-store, private');
      assert.equal(policyAuthRes.headers.get('netlify-cdn-cache-control'), undefined);
    })().catch((err) => { console.error(err); process.exitCode = 1; });
  `);
});

test('NEON_ACTIVITY_ENABLED=false short-circuits recordActivityBestEffort with zero DB calls', () => {
  runIsolated(`
    ${baseMockHelper}
    process.env.NEON_DATABASE_URL = 'postgresql://test@ep-demo.neon.tech/neondb';
    let queryCalls = 0;
    mockModule('./dist/neon/database.js', {
      async query() {
        queryCalls += 1;
        return { rows: [{ id: 'a-1', txid: '1' }] };
      },
    });

    const { recordActivityBestEffort } = require('./dist/neon/activityService.js');
    (async () => {
      fakeEnv.NEON_ACTIVITY_ENABLED = false;
      await recordActivityBestEffort('product_created', 'prod-1');
      assert.equal(queryCalls, 0);

      fakeEnv.NEON_ACTIVITY_ENABLED = true;
      await recordActivityBestEffort('product_created', 'prod-2');
      assert.equal(queryCalls, 1);
    })().catch((err) => { console.error(err); process.exitCode = 1; });
  `);
});

test('app CORS exposes mobile/multi-branch headers and defaults /api/v1 Cache-Control to no-store, private', () => {
  runIsolated(`
    ${baseMockHelper}
    mockModule('./dist/config/supabase.js', {
      supabaseAuth: { auth: {} },
      supabaseAdmin: { from() { return { select() { return this; }, limit: async () => ({ data: [], error: null }) }; } },
    });
    mockModule('./dist/services/policyConfigService.js', {
      policyConfigService: { ensureFresh: async () => {} },
    });
    mockModule('./dist/config/postgres.js', {
      isPostgresAvailable: async () => true,
      postgresPool: { end: async () => {} },
    });

    const serverless = require('serverless-http');
    const { app } = require('./dist/app.js');
    const handler = serverless(app);

    (async () => {
      // 1. CORS preflight with new APP-1 headers
      const preflight = await handler({
        path: '/api/v1/health',
        httpMethod: 'OPTIONS',
        headers: {
          origin: 'https://makeitorganized.netlify.app',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'Authorization, Content-Type, X-App-Version, X-Platform, X-Store-Id, Idempotency-Key',
        },
        body: '',
        isBase64Encoded: false,
        requestContext: { identity: { sourceIp: '127.0.0.1' } },
      }, {});
      assert.equal(preflight.statusCode, 204);
      const allowHeaders = String(preflight.headers['access-control-allow-headers'] || '').toLowerCase();
      for (const h of ['x-app-version', 'x-platform', 'x-store-id', 'idempotency-key']) {
        assert.ok(allowHeaders.includes(h), 'CORS must allow header: ' + h);
      }

      // 2. Default /api/v1 response gets Cache-Control: no-store, private
      const healthRes = await handler({
        path: '/api/v1/health',
        httpMethod: 'GET',
        headers: {},
        body: '',
        isBase64Encoded: false,
        requestContext: { identity: { sourceIp: '127.0.0.1' } },
      }, {});
      assert.equal(healthRes.statusCode, 200);
      assert.equal(healthRes.headers['cache-control'], 'no-store, private');

      // 3. Public GET /api/v1/catalog/policy gets public cache without Authorization
      const policyRes = await handler({
        path: '/api/v1/catalog/policy',
        httpMethod: 'GET',
        headers: {},
        body: '',
        isBase64Encoded: false,
        requestContext: { identity: { sourceIp: '127.0.0.1' } },
      }, {});
      assert.equal(policyRes.statusCode, 200);
      assert.equal(policyRes.headers['cache-control'], 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
      assert.equal(policyRes.headers['netlify-cdn-cache-control'], 'public, durable, s-maxage=300, stale-while-revalidate=600');

      // 4. Authenticated GET /api/v1/catalog/policy stays no-store, private
      const policyAuthRes = await handler({
        path: '/api/v1/catalog/policy',
        httpMethod: 'GET',
        headers: { authorization: 'Bearer test-token' },
        body: '',
        isBase64Encoded: false,
        requestContext: { identity: { sourceIp: '127.0.0.1' } },
      }, {});
      assert.equal(policyAuthRes.statusCode, 200);
      assert.equal(policyAuthRes.headers['cache-control'], 'no-store, private');
      assert.equal(policyAuthRes.headers['netlify-cdn-cache-control'], undefined);
    })().catch((err) => { console.error(err); process.exitCode = 1; });
  `);
});

test('UpstashRestRateLimitStore sends /pipeline INCR+PEXPIRE+PTTL and resolveApiRateLimitKey keys by user/volunteer/IP', () => {
  runIsolated(`
    ${baseMockHelper}
    const fetchCalls = [];
    global.fetch = async (url, init) => {
      fetchCalls.push({ url, init });
      return {
        ok: true,
        status: 200,
        async json() {
          return [{ result: 3 }, { result: 0 }, { result: 42000 }];
        },
      };
    };

    const { UpstashRestRateLimitStore, resolveApiRateLimitKey } = require('./dist/middlewares/rateLimiter.js');
    const { createVolunteerToken } = require('./dist/utils/volunteerToken.js');

    (async () => {
      const store = new UpstashRestRateLimitStore({
        url: 'https://redis.upstash.example/',
        token: 'upstash-token-123',
        prefix: 'mio:rl:api:',
        timeoutMs: 1500,
      });
      store.init({ windowMs: 60000 });

      const result = await store.increment('ip:1.2.3.4');
      assert.equal(result.totalHits, 3);
      assert.ok(result.resetTime instanceof Date);
      assert.equal(fetchCalls.length, 1);
      assert.equal(fetchCalls[0].url, 'https://redis.upstash.example/pipeline');
      assert.equal(fetchCalls[0].init.headers.Authorization, 'Bearer upstash-token-123');
      assert.ok(fetchCalls[0].init.signal instanceof AbortSignal);
      const sentCommands = JSON.parse(fetchCalls[0].init.body);
      assert.deepEqual(sentCommands[0], ['INCR', 'mio:rl:api:ip:1.2.3.4']);
      assert.deepEqual(sentCommands[1], ['PEXPIRE', 'mio:rl:api:ip:1.2.3.4', '60000', 'NX']);

      // Key generator prefers volunteer token / Supabase JWT sub over shared IP
      const volTok = createVolunteerToken('vol-99', 'ch-1', 'otp');
      assert.equal(
        resolveApiRateLimitKey({ headers: { authorization: 'Bearer ' + volTok }, ip: '10.0.0.1' }),
        'volunteer:vol-99'
      );

      const jwtPayload = Buffer.from(JSON.stringify({
        sub: '11111111-2222-4333-8444-555555555555',
        iss: 'https://demo.supabase.co/auth/v1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url');
      assert.equal(
        resolveApiRateLimitKey({ headers: { authorization: 'Bearer eyJ.' + jwtPayload + '.sig' }, ip: '10.0.0.1' }),
        'user:11111111-2222-4333-8444-555555555555'
      );

      assert.equal(
        resolveApiRateLimitKey({ headers: {}, ip: '10.0.0.1' }),
        'ip:10.0.0.1'
      );
    })().catch((err) => { console.error(err); process.exitCode = 1; });
  `);
});
