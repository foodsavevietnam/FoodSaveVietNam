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
  assert.equal(result.status, 0, result.stderr || result.stdout || 'Isolated Wave 3B test failed.');
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
    SUPABASE_URL: 'https://secret-project-ref.supabase.co',
    SUPABASE_ANON_KEY: 'anon-secret-key-xyz',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-key-xyz',
    CORS_ORIGINS: ['https://makeitorganized.netlify.app'],
    SOCKET_CORS_ORIGINS: ['https://makeitorganized.netlify.app'],
    PUBLIC_SITE_URL: 'https://makeitorganized.netlify.app/FOODSAVE_USER.html',
    RATE_LIMIT_WINDOW_MS: 60000,
    RATE_LIMIT_MAX_REQUESTS: 120,
    NEON_ACTIVITY_ENABLED: true,
    NEON_DATABASE_URL: 'postgresql://user:supersecret@ep-demo.neon.tech/neondb',
    AUTOMATION_ENABLED: true,
    VAPID_PUBLIC_KEY: 'vapid-pub-secret',
    VAPID_PRIVATE_KEY: 'vapid-priv-secret',
    VAPID_SUBJECT: 'mailto:ops@mio.vn',
    DEMO_MODE: false,
    ORDER_POLICY_TIME_SCALE: 1,
    LOG_LEVEL: 'debug',
    LOG_FORMAT: 'json',
    SENTRY_DSN: undefined,
    PAYOUT_ENCRYPTION_KEY: undefined,
    PAYOUT_ENCRYPTION_KEYS: undefined,
  };
  mockModule('./dist/config/env.js', { env: fakeEnv });
`;

test('logger redacts sensitive keys/tokens recursively, attaches request_id, and outputs 1-line JSON in production or LOG_FORMAT=json', () => {
  runIsolated(`
    ${baseMockHelper}
    const { logger } = require('./dist/utils/logger.js');
    const { runWithRequestId, getRequestId } = require('./dist/utils/requestIdStore.js');

    const captured = [];
    const origInfo = console.info;
    console.info = (...args) => captured.push(args);

    try {
      const circular = { label: 'safe-value', password: 'pw-123' };
      circular.self = circular;

      assert.equal(getRequestId(), undefined);
      runWithRequestId('req-trace-001', () => {
        assert.equal(getRequestId(), 'req-trace-001');
        logger.info('Audit event with Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig', {
          password: 'my-password',
          token: 'raw-token',
          access_token: 'acc-tok',
          refresh_token: 'ref-tok',
          secret: 'top-secret',
          authorization: 'Bearer secret-jwt',
          cookie: 'sid=secret-cookie',
          account_number: '0123456789012',
          cccd: '079099001234',
          bank_account_number: '998877665544',
          api_key: 'sk_live_12345',
          private_key: '-----BEGIN PRIVATE KEY-----',
          nested: {
            dbUrl: 'postgresql://admin:dbpass99@db.example.com:5432/app',
            userId: 'user-42',
            circular,
          },
        });
      });

      assert.equal(captured.length, 1);
      const rawLine = captured[0][0];
      assert.equal(typeof rawLine, 'string');
      assert.equal(rawLine.includes('\\n'), false, 'JSON log phải xuất trên đúng 1 dòng');

      const parsed = JSON.parse(rawLine);
      assert.ok(parsed.timestamp);
      assert.equal(parsed.level, 'info');
      assert.equal(parsed.request_id, 'req-trace-001');
      assert.equal(parsed.message.includes('eyJhbGciOiJIUzI1NiJ9'), false);
      assert.ok(parsed.message.includes('[REDACTED]'));

      for (const secretField of [
        'password', 'token', 'access_token', 'refresh_token', 'secret',
        'authorization', 'cookie', 'account_number', 'cccd',
        'bank_account_number', 'api_key', 'private_key',
      ]) {
        assert.equal(parsed.meta[secretField], '[REDACTED]', secretField + ' phải bị che');
      }
      assert.equal(parsed.meta.nested.userId, 'user-42');
      assert.equal(parsed.meta.nested.dbUrl.includes('dbpass99'), false);
      assert.equal(parsed.meta.nested.circular.password, '[REDACTED]');
      assert.equal(parsed.meta.nested.circular.self, '[Circular]');

      // Kiểm tra mọi giá trị nhạy cảm tuyệt đối không xuất hiện trong chuỗi JSON
      for (const forbidden of ['my-password', 'raw-token', 'acc-tok', 'ref-tok', 'top-secret', 'secret-jwt', 'secret-cookie', '0123456789012', '079099001234', '998877665544', 'sk_live_12345', 'BEGIN PRIVATE KEY', 'dbpass99', 'pw-123']) {
        assert.equal(rawLine.includes(forbidden), false, 'Log bị rò rỉ dữ liệu nhạy cảm: ' + forbidden);
      }
    } finally {
      console.info = origInfo;
    }
  `);
});

test('requestIdMiddleware echoes valid X-Request-Id, replaces invalid IDs, sets response header, and logs request finish without query string', () => {
  runIsolated(`
    ${baseMockHelper}
    const express = require('express');
    const serverless = require('serverless-http');
    const { requestIdMiddleware } = require('./dist/middlewares/requestIdMiddleware.js');
    const { getRequestId } = require('./dist/utils/requestIdStore.js');

    const infoLogs = [];
    const origInfo = console.info;
    console.info = (...args) => infoLogs.push(args[0]);

    const app = express();
    app.use(requestIdMiddleware);
    app.get('/ping', (_req, res) => {
      res.status(200).json({ request_id: getRequestId() });
    });
    const handler = serverless(app);

    (async () => {
      try {
        // 1. Giữ nguyên X-Request-Id hợp lệ
        const res1 = await handler({
          path: '/ping',
          httpMethod: 'GET',
          headers: { 'x-request-id': 'client.req_123-ABC' },
          queryStringParameters: { token: 'super-secret-query-token' },
          body: '',
          isBase64Encoded: false,
          requestContext: { identity: { sourceIp: '127.0.0.1' } },
        }, {});
        assert.equal(res1.statusCode, 200);
        assert.equal(res1.headers['x-request-id'], 'client.req_123-ABC');
        assert.equal(JSON.parse(res1.body).request_id, 'client.req_123-ABC');

        // 2. X-Request-Id không hợp lệ (chứa ký tự lạ / quá 64 ký tự) -> sinh UUID mới
        const res2 = await handler({
          path: '/ping',
          httpMethod: 'GET',
          headers: { 'x-request-id': 'bad id with spaces && ' + 'x'.repeat(80) },
          body: '',
          isBase64Encoded: false,
          requestContext: { identity: { sourceIp: '127.0.0.1' } },
        }, {});
        assert.equal(res2.statusCode, 200);
        assert.match(res2.headers['x-request-id'], /^[0-9a-f-]{36}$/i);
        assert.equal(JSON.parse(res2.body).request_id, res2.headers['x-request-id']);

        assert.equal(infoLogs.length, 2);
        const log1 = JSON.parse(infoLogs[0]);
        assert.equal(log1.request_id, 'client.req_123-ABC');
        assert.equal(log1.meta.method, 'GET');
        assert.equal(log1.meta.path, '/ping');
        assert.equal(log1.meta.status, 200);
        assert.equal(typeof log1.meta.duration_ms, 'number');
        assert.equal(infoLogs[0].includes('super-secret-query-token'), false, 'Không được log query string nhạy cảm');
      } finally {
        console.info = origInfo;
      }
    })().catch((err) => { console.error(err); process.exitCode = 1; });
  `);
});

test('errorHandler serializes errors safely without raw objects and sends PII-free async Sentry event on 5xx', () => {
  runIsolated(`
    ${baseMockHelper}
    fakeEnv.SENTRY_DSN = 'https://pubKey123@o42.ingest.sentry.io/987654';
    const express = require('express');
    const serverless = require('serverless-http');
    const { requestIdMiddleware } = require('./dist/middlewares/requestIdMiddleware.js');
    const { errorHandler } = require('./dist/middlewares/errorHandler.js');

    const errorLogs = [];
    const sentryRequests = [];
    const origError = console.error;
    const origFetch = global.fetch;

    console.error = (...args) => errorLogs.push(args[0]);
    global.fetch = async (url, init) => {
      sentryRequests.push({ url, init });
      return { ok: true, status: 200 };
    };

    const app = express();
    app.use(requestIdMiddleware);
    app.get('/boom', (_req, _res, next) => {
      const err = new Error('Failure using Bearer top-secret-jwt-999');
      err.code = 'DB_FAIL';
      err.rawRequestPayload = { password: 'hidden-password-should-not-appear', cccd: '012345678901' };
      next(err);
    });
    app.use(errorHandler);
    const handler = serverless(app);

    (async () => {
      try {
        const res = await handler({
          path: '/boom',
          httpMethod: 'GET',
          headers: {
            'x-request-id': 'req-err-500',
            authorization: 'Bearer ultra-secret-bearer',
            cookie: 'session=ultra-secret-cookie',
            'user-agent': 'mio-test-agent',
          },
          queryStringParameters: { access_token: 'secret-in-query' },
          body: '',
          isBase64Encoded: false,
          requestContext: { identity: { sourceIp: '127.0.0.1' } },
        }, {});

        assert.equal(res.statusCode, 500);
        await new Promise((r) => setTimeout(r, 20));

        // 1. Log đã serialize an toàn, không chứa rawRequestPayload hay Bearer token
        assert.equal(errorLogs.length, 1);
        const logEntry = JSON.parse(errorLogs[0]);
        assert.equal(logEntry.request_id, 'req-err-500');
        assert.equal(logEntry.meta.error.name, 'Error');
        assert.equal(logEntry.meta.error.code, 'DB_FAIL');
        assert.equal(errorLogs[0].includes('hidden-password-should-not-appear'), false);
        assert.equal(errorLogs[0].includes('012345678901'), false);
        assert.equal(errorLogs[0].includes('top-secret-jwt-999'), false);

        // 2. Sentry Store API được gọi bất đồng bộ, có AbortSignal và không rò PII/headers nhạy cảm
        assert.equal(sentryRequests.length, 1);
        assert.equal(sentryRequests[0].url, 'https://o42.ingest.sentry.io/api/987654/store/');
        assert.ok(sentryRequests[0].init.headers['X-Sentry-Auth'].includes('sentry_key=pubKey123'));
        assert.ok(sentryRequests[0].init.signal instanceof AbortSignal);

        const bodyText = sentryRequests[0].init.body;
        const body = JSON.parse(bodyText);
        assert.equal(body.tags.request_id, 'req-err-500');
        assert.equal(body.request.url, '/boom');
        assert.equal(body.request.headers['user-agent'], 'mio-test-agent');
        assert.equal(body.request.headers.authorization, undefined);
        assert.equal(body.request.headers.cookie, undefined);
        assert.equal(bodyText.includes('ultra-secret-bearer'), false);
        assert.equal(bodyText.includes('ultra-secret-cookie'), false);
        assert.equal(bodyText.includes('secret-in-query'), false);
        assert.equal(bodyText.includes('top-secret-jwt-999'), false);

        // 3. Fail-silent khi Sentry lỗi mạng (không làm hỏng response 500)
        global.fetch = async () => { throw new Error('Sentry unreachable'); };
        const res2 = await handler({
          path: '/boom',
          httpMethod: 'GET',
          headers: { 'x-request-id': 'req-err-501' },
          body: '',
          isBase64Encoded: false,
          requestContext: { identity: { sourceIp: '127.0.0.1' } },
        }, {});
        assert.equal(res2.statusCode, 500);
        await new Promise((r) => setTimeout(r, 20));
      } finally {
        console.error = origError;
        global.fetch = origFetch;
      }
    })().catch((err) => { console.error(err); process.exitCode = 1; });
  `);
});

test('payoutCrypto supports multi-key rotation (v2 encrypt + v1/v2 decrypt) and full backward compatibility with PAYOUT_ENCRYPTION_KEY', () => {
  runIsolated(`
    ${baseMockHelper}
    const crypto = require('node:crypto');
    const keyV1Hex = crypto.randomBytes(32).toString('hex');
    const keyV2Hex = crypto.randomBytes(32).toString('hex');
    const wrongKeyB64 = crypto.randomBytes(32).toString('base64');

    const {
      isPayoutKeyConfigured,
      encryptAccountNumber,
      decryptAccountNumber,
    } = require('./dist/utils/payoutCrypto.js');

    // 1. Chưa cấu hình khóa -> isPayoutKeyConfigured() === false
    assert.equal(isPayoutKeyConfigured(), false);

    // 2. Chế độ cũ chỉ đặt PAYOUT_ENCRYPTION_KEY -> mã hóa v1: và giải mã v1:
    fakeEnv.PAYOUT_ENCRYPTION_KEY = keyV1Hex;
    assert.equal(isPayoutKeyConfigured(), true);
    const cipherV1 = encryptAccountNumber('0123456789012');
    assert.ok(cipherV1.startsWith('v1:'), 'Chế độ cũ phải gắn tiền tố v1:');
    assert.equal(decryptAccountNumber(cipherV1), '0123456789012');

    // 3. Xoay vòng đa khóa với PAYOUT_ENCRYPTION_KEYS="v2:...,v1:..."
    fakeEnv.PAYOUT_ENCRYPTION_KEY = undefined;
    fakeEnv.PAYOUT_ENCRYPTION_KEYS = 'v2:' + keyV2Hex + ',v1:' + keyV1Hex;
    assert.equal(isPayoutKeyConfigured(), true);

    const cipherV2 = encryptAccountNumber('9876543210987');
    assert.ok(cipherV2.startsWith('v2:'), 'Mã hóa mới phải dùng khóa đầu tiên (v2:)');

    // Giải mã được cả v1 cũ lẫn v2 mới
    assert.equal(decryptAccountNumber(cipherV1), '0123456789012');
    assert.equal(decryptAccountNumber(cipherV2), '9876543210987');

    // Không giải mã được nếu sai khóa override hoặc bị sửa dữ liệu hoặc thiếu phiên bản khóa
    assert.throws(() => decryptAccountNumber(cipherV2, wrongKeyB64), /Không giải mã/);
    assert.throws(() => decryptAccountNumber(cipherV2.slice(0, -4) + 'AAAA'), /Không giải mã/);
    assert.throws(() => decryptAccountNumber('v9:' + cipherV2.slice(3)), /Không giải mã/);

    // 4. Khi chỉ đưa v2 vào PAYOUT_ENCRYPTION_KEYS nhưng vẫn giữ PAYOUT_ENCRYPTION_KEY cũ -> vẫn giải mã được v1
    fakeEnv.PAYOUT_ENCRYPTION_KEYS = 'v2:' + keyV2Hex;
    fakeEnv.PAYOUT_ENCRYPTION_KEY = keyV1Hex;
    assert.equal(decryptAccountNumber(cipherV1), '0123456789012');
    assert.equal(decryptAccountNumber(cipherV2), '9876543210987');
  `);
});

test('GET /api/v1/health stays 200 liveness and GET /api/v1/health/ready returns 200/503 without leaking secrets', () => {
  runIsolated(`
    ${baseMockHelper}
    let supabaseOutcome = async () => ({ count: 1, error: null });
    mockModule('./dist/config/supabase.js', {
      supabaseAuth: { auth: {} },
      supabaseAdmin: {
        from(table) {
          assert.equal(table, 'stores');
          return {
            select(cols, opts) {
              assert.equal(cols, 'id');
              assert.deepEqual(opts, { head: true, count: 'exact' });
              return supabaseOutcome();
            },
          };
        },
      },
    });

    const express = require('express');
    const serverless = require('serverless-http');
    const { healthRoutes } = require('./dist/routes/healthRoutes.js');

    const app = express();
    app.use('/api/v1/health', healthRoutes);
    const handler = serverless(app);

    (async () => {
      // 1. Liveness /api/v1/health giữ nguyên 200
      const liveRes = await handler({
        path: '/api/v1/health',
        httpMethod: 'GET',
        headers: {},
        body: '',
        isBase64Encoded: false,
        requestContext: { identity: { sourceIp: '127.0.0.1' } },
      }, {});
      assert.equal(liveRes.statusCode, 200);
      const liveBody = JSON.parse(liveRes.body);
      assert.equal(liveBody.success, true);
      assert.equal(liveBody.data.service, 'foodsave-backend');

      // 2. Ready 200 khi Supabase OK
      const readyRes = await handler({
        path: '/api/v1/health/ready',
        httpMethod: 'GET',
        headers: {},
        body: '',
        isBase64Encoded: false,
        requestContext: { identity: { sourceIp: '127.0.0.1' } },
      }, {});
      assert.equal(readyRes.statusCode, 200);
      const readyBody = JSON.parse(readyRes.body);
      assert.equal(readyBody.success, true);
      assert.equal(readyBody.data.status, 'ready');
      assert.deepEqual(readyBody.data.checks, { supabase: 'ok' });
      assert.deepEqual(readyBody.data.features, {
        automation_enabled: true,
        push_enabled: true,
        neon_enabled: true,
      });

      // 3. Degraded 503 khi Supabase trả lỗi — tuyệt đối không lộ URL/key/message lỗi nội bộ
      supabaseOutcome = async () => ({
        count: null,
        error: { message: 'connection failed to https://secret-project-ref.supabase.co key=service-role-secret-key-xyz' },
      });
      const degradedRes = await handler({
        path: '/api/v1/health/ready',
        httpMethod: 'GET',
        headers: {},
        body: '',
        isBase64Encoded: false,
        requestContext: { identity: { sourceIp: '127.0.0.1' } },
      }, {});
      assert.equal(degradedRes.statusCode, 503);
      const degradedBody = JSON.parse(degradedRes.body);
      assert.equal(degradedBody.success, false);
      assert.equal(degradedBody.data.status, 'degraded');
      assert.deepEqual(degradedBody.data.checks, { supabase: 'error' });

      for (const secret of ['secret-project-ref', 'service-role-secret-key-xyz', 'anon-secret-key-xyz', 'supersecret', 'vapid-priv-secret', 'connection failed']) {
        assert.equal(degradedRes.body.includes(secret), false, 'health/ready bị lộ thông tin nội bộ: ' + secret);
        assert.equal(readyRes.body.includes(secret), false, 'health/ready bị lộ thông tin nội bộ: ' + secret);
      }
    })().catch((err) => { console.error(err); process.exitCode = 1; });
  `);
});

test('socketServer avoids static socket.io import and silences emitStoreStatusChanged warning on serverless runtimes', () => {
  runIsolated(`
    ${baseMockHelper}
    mockModule('./dist/config/supabase.js', {
      supabaseAuth: { auth: {} },
      supabaseAdmin: { from() { return {}; } },
    });

    const socketIoResolved = require.resolve('socket.io');
    assert.equal(require.cache[socketIoResolved], undefined, 'socket.io chưa được nạp trước khi import socketServer');

    const { emitStoreStatusChanged } = require('./dist/realtime/socketServer.js');
    assert.equal(require.cache[socketIoResolved], undefined, 'Import socketServer KHÔNG được nạp tĩnh socket.io');

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args);

    try {
      const payload = { sellerId: 'st-1', status: 'Active', trustScore: 100, updatedAt: new Date().toISOString() };

      // Trên Netlify: im lặng return, không spam warn
      process.env.NETLIFY = 'true';
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      emitStoreStatusChanged(payload);
      assert.equal(warnings.length, 0);

      // Trên AWS Lambda: im lặng return, không spam warn
      delete process.env.NETLIFY;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'netlify-api';
      emitStoreStatusChanged(payload);
      assert.equal(warnings.length, 0);

      // Trên server thường (non-serverless) khi chưa init: vẫn ghi warn bình thường
      delete process.env.NETLIFY;
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      emitStoreStatusChanged(payload);
      assert.equal(warnings.length, 1);
    } finally {
      console.warn = origWarn;
    }
  `);
});
