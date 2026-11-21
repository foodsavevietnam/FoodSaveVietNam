import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const { normalizeNetlifyApiEvent } = require('../dist/utils/netlifyRequest.js');
const { isNeonHttpRuntime } = require('../dist/neon/database.js');

const isolatedSetup = `
  const assert = require('node:assert/strict');
  const fakeEnv = {
    NODE_ENV: 'production', DEMO_MODE: false,
    API_BASE_PATH: '/api/v1',
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_SERVICE_ROLE_KEY: 'unit-test-placeholder',
    MOMO_API_BASE_URL: 'https://payments.example/api',
    CORS_ORIGINS: [], SOCKET_CORS_ORIGINS: [],
    RATE_LIMIT_WINDOW_MS: 60000, RATE_LIMIT_MAX_REQUESTS: 120,
    LOG_LEVEL: 'error',
  };
  const envPath = require.resolve('./dist/config/env.js');
  require.cache[envPath] = { id: envPath, filename: envPath, loaded: true, exports: { env: fakeEnv } };
  let reads = 0;
  let writes = [];
  const fakeRow = { id: 'charity-1', owner_id: 'owner-1', status: 'pending' };
  const chain = {
    select() { return this; },
    eq() { return this; },
    update(body) { writes.push(body); return this; },
    async single() { return { data: { ...fakeRow, ...writes.at(-1) }, error: null }; },
    async maybeSingle() { return { data: fakeRow, error: null }; },
    async limit() { return { data: [], error: null }; },
  };
  const servicePath = require.resolve('./dist/services/supabaseService.js');
  require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: {
    supabaseAdmin: { from() { reads += 1; return chain; } },
    handleSupabaseError(error) { if (error) throw new Error('Unexpected database error'); },
    requireRecord(record) { if (!record) throw new Error('Record missing'); return record; },
  } };
`;

function runIsolated(code) {
  const result = spawnSync(process.execPath, ['--input-type=commonjs', '-e', `${isolatedSetup}\n${code}`], {
    cwd: backendRoot,
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || 'Isolated backend assertion failed.');
}

test('phone-only volunteer login cannot issue a session or query users outside explicit local demo', () => {
  runIsolated(`
    const { volunteerService } = require('./dist/services/volunteerService.js');
    (async () => {
      for (const [nodeEnv, demoMode] of [['production', false], ['production', true], ['development', false], ['test', false]]) {
        fakeEnv.NODE_ENV = nodeEnv;
        fakeEnv.DEMO_MODE = demoMode;
        await assert.rejects(volunteerService.login('0901234567'), error =>
          error.statusCode === 403 && error.code === 'AUTH_VERIFICATION_REQUIRED');
      }
      assert.equal(reads, 0);
      assert.equal(writes.length, 0);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `);
});

test('charity owners cannot self-approve, suspend or reopen their organization', () => {
  runIsolated(`
    const { charityService } = require('./dist/services/charityService.js');
    (async () => {
      for (const status of ['active', 'pending', 'suspended']) {
        await assert.rejects(charityService.updateCharityProfile('owner-1', 'charity', 'charity-1', { status }),
          error => error.statusCode === 403 && error.code === 'AUTH_FORBIDDEN');
      }
      assert.equal(reads, 0);
      assert.equal(writes.length, 0);
      const adminResult = await charityService.updateCharityProfile('admin-1', 'admin', 'charity-1', { status: 'active' });
      assert.equal(adminResult.status, 'active');
      const ownerResult = await charityService.updateCharityProfile('owner-1', 'charity', 'charity-1', { name: 'Updated organization' });
      assert.equal(ownerResult.name, 'Updated organization');
      assert.deepEqual(writes, [{ status: 'active' }, { name: 'Updated organization' }]);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `);
});

test('Netlify Lambda rewrite paths reach the existing Express API without changing request content', async () => {
  const express = require('express');
  const serverless = require('serverless-http');
  const app = express();
  app.get('/api/v1/health', (_req, res) => res.json({ ok: true }));
  const handler = serverless(app);

  for (const path of ['/api/v1/health', '/.netlify/functions/api/health', '/.netlify/functions/api/api/v1/health']) {
    const event = { path, httpMethod: 'GET', headers: {}, body: '', isBase64Encoded: false,
      queryStringParameters: { probe: '1' }, requestContext: { identity: { sourceIp: '127.0.0.1' } } };
    const normalized = normalizeNetlifyApiEvent(event, '/api/v1');
    assert.equal(normalized.queryStringParameters, event.queryStringParameters);
    assert.equal(normalized.body, event.body);
    assert.equal(normalized.httpMethod, event.httpMethod);
    assert.equal(event.path, path);
    const response = await handler(normalized, {});
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true });
  }
  assert.deepEqual(normalizeNetlifyApiEvent({ rawPath: '/.netlify/functions/api/health', requestPath: '/.netlify/functions/api/health' }, '/api/v1'),
    { rawPath: '/api/v1/health', requestPath: '/api/v1/health' });
});

test('Neon HTTP transport recognizes both Netlify build and Lambda runtime markers', () => {
  assert.equal(isNeonHttpRuntime({ NETLIFY: 'true' }), true);
  assert.equal(isNeonHttpRuntime({ AWS_LAMBDA_FUNCTION_NAME: 'netlify-api' }), true);
  assert.equal(isNeonHttpRuntime({}), false);
});

test('Neon HTTP requests carry a cancellation deadline instead of hanging committed business operations', () => {
  runIsolated(`
    process.env.NETLIFY = 'true';
    process.env.NEON_DATABASE_URL = 'postgresql://unit-test@ep-test.neon.tech/neondb';
    const driverPath = require.resolve('@neondatabase/serverless');
    let calls = 0;
    require.cache[driverPath] = { id: driverPath, filename: driverPath, loaded: true, exports: {
      neon: () => ({ query: async (_sql, _parameters, options) => {
        calls += 1;
        assert.ok(options.fetchOptions.signal instanceof AbortSignal);
        assert.equal(options.fetchOptions.signal.aborted, false);
        return { rows: [{ ok: true }] };
      } }),
    } };
    const { query } = require('./dist/neon/database.js');
    (async () => {
      assert.deepEqual(await query('SELECT true AS ok'), { rows: [{ ok: true }] });
      assert.equal(calls, 1);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `);
});

test('malformed and oversized JSON requests return safe 400/413 responses without logging their body', () => {
  runIsolated(`
    const express = require('express');
    const serverless = require('serverless-http');
    const { errorHandler } = require('./dist/middlewares/errorHandler.js');
    const app = express();
    app.use(express.json({ limit: '64b' }));
    app.post('/test', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    const handler = serverless(app);
    (async () => {
      let logs = 0;
      const originalError = console.error;
      console.error = () => { logs += 1; };
      try {
        for (const [body, status] of [['{"privateField":', 400], [JSON.stringify({ privateField: 'x'.repeat(100) }), 413]]) {
          const response = await handler({ path: '/test', httpMethod: 'POST',
            headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
            body, isBase64Encoded: false, requestContext: { identity: { sourceIp: '127.0.0.1' } } }, {});
          assert.equal(response.statusCode, status);
          const payload = JSON.parse(response.body);
          assert.equal(payload.success, false);
          assert.equal(payload.error.code, 'VALIDATION_ERROR');
          assert.equal(response.body.includes('privateField'), false);
        }
        assert.equal(logs, 0);
      } finally { console.error = originalError; }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `);
});

test('MoMo refuses real API calls before signing or networking when any required setting is absent', () => {
  runIsolated(`
    const { momoPaymentService } = require('./dist/services/momoPaymentService.js');
    let networkCalls = 0;
    global.fetch = async () => { networkCalls += 1; throw new Error('Unexpected network request'); };
    const order = { id: 'order-1', order_number: 'TEST-1', payment_method: 'momo', total_cents: 5000 };
    (async () => {
      for (const missing of ['MOMO_ACCESS_KEY', 'MOMO_SECRET_KEY', 'MOMO_PARTNER_CODE']) {
        fakeEnv.MOMO_ACCESS_KEY = 'unit-test-placeholder';
        fakeEnv.MOMO_SECRET_KEY = 'unit-test-placeholder';
        fakeEnv.MOMO_PARTNER_CODE = 'unit-test-placeholder';
        delete fakeEnv[missing];
        for (const action of ['createPayment', 'queryPayment']) {
          await assert.rejects(momoPaymentService[action](order), error =>
            error.statusCode === 501 && error.code === 'PROVIDER_NOT_CONFIGURED');
        }
      }
      assert.equal(networkCalls, 0);
      assert.equal(reads, 0);
      assert.equal(writes.length, 0);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `);
});

test('production rejects existing unverified volunteer sessions while preserving Supabase customer push', () => {
  runIsolated(`
    const legacyPath = require.resolve('./dist/utils/volunteerToken.js');
    require.cache[legacyPath] = { id: legacyPath, filename: legacyPath, loaded: true, exports: {
      verifyVolunteerToken: value => value === 'legacy-demo-session' ? { vid: 'volunteer-1' } : null,
    } };
    const authPath = require.resolve('./dist/middlewares/authMiddleware.js');
    let customerAuthCalls = 0;
    require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
      authMiddleware(req, _res, next) { customerAuthCalls += 1; req.user = { id: 'customer-1' }; next(); },
      requireRoles: () => (_req, _res, next) => next(),
    } };
    const { volunteerAuth } = require('./dist/middlewares/volunteerAuth.js');
    const { pushActor } = require('./dist/middlewares/pushAuth.js');
    for (const [nodeEnv, demoMode] of [['production', true], ['production', false], ['development', false]]) {
      fakeEnv.NODE_ENV = nodeEnv;
      fakeEnv.DEMO_MODE = demoMode;
      const request = { headers: { authorization: 'Bearer legacy-demo-session' } };
      for (const middleware of [volunteerAuth, pushActor]) {
        const response = { locals: {} };
        let failure;
        middleware(request, response, error => { failure = error; });
        assert.equal(failure?.statusCode, 403);
        assert.equal(failure?.code, 'AUTH_VERIFICATION_REQUIRED');
        assert.equal(response.locals.volunteerId, undefined);
        assert.equal(response.locals.pushOwner, undefined);
      }
    }
    assert.equal(customerAuthCalls, 0);
    fakeEnv.NODE_ENV = 'production';
    const customer = { headers: { authorization: 'Bearer supabase-customer-session' } };
    const response = { locals: {} };
    let customerFailure;
    pushActor(customer, response, error => { customerFailure = error; });
    assert.equal(customerFailure, undefined);
    assert.equal(customerAuthCalls, 1);
    assert.deepEqual(response.locals.pushOwner, { kind: 'user', id: 'customer-1' });
  `);
});
