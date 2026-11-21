import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
const require = createRequire(import.meta.url);
const { loadEnvironment } = require('../dist/config/loadEnvironment.js');
const { getNeonPool } = require('../dist/neon/database.js');
const { recordActivity } = require('../dist/neon/activityService.js');
const { createRealtimeClient } = await import('@neon/realtime/client');

loadEnvironment();

const apiOrigin = process.env.MIO_API_ORIGIN || 'http://127.0.0.1:5500';
const apiBase = `${apiOrigin.replace(/\/+$/u, '')}/api/v1`;
const sourceId = `mio-e2e-${randomUUID()}`;
const pool = getNeonPool();
const realtimeUrl = process.env.NEON_REALTIME_URL;
let liveClient;
let subscription;
const sockets = new Set();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(predicate, timeoutMilliseconds = 20000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the Neon activity feed.');
}

async function run() {
  assert(typeof realtimeUrl === 'string' && realtimeUrl.startsWith('wss://'), 'Neon Realtime URL is missing.');

  const health = await fetch(`${apiBase}/health`);
  assert(health.ok, `MIO API health returned ${health.status}.`);
  const healthBody = await health.json();
  assert(healthBody.success === true, 'MIO API health did not return success.');
  console.log('PASS: MIO API is running.');

  const latestResponse = await fetch(`${apiBase}/activity`, { cache: 'no-store' });
  assert(latestResponse.ok, `Neon activity API returned ${latestResponse.status}.`);
  const latestBody = await latestResponse.json();
  assert(latestBody.success === true && Array.isArray(latestBody.data?.items), 'Neon activity API returned an invalid feed.');
  console.log('PASS: MIO API reads activity rows from Neon Postgres.');

  const liveResponse = await fetch(`${apiBase}/activity/live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    cache: 'no-store',
  });
  assert(liveResponse.ok, `Neon Realtime seal endpoint returned ${liveResponse.status}.`);
  const liveBody = await liveResponse.json();
  const subscriptionInfo = liveBody.data;
  assert(liveBody.success === true && subscriptionInfo?.url === realtimeUrl, 'Neon Realtime returned an invalid endpoint.');
  assert(typeof subscriptionInfo.sealedQuery?.capability === 'string', 'Neon Realtime did not return a sealed query.');

  liveClient = createRealtimeClient({
    url: subscriptionInfo.url,
    logLevel: 'error',
    webSocketFactory(url, protocols) {
      const socket = new WebSocket(url, protocols);
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      return socket;
    },
  });
  subscription = liveClient.subscribe(subscriptionInfo.sealedQuery);
  let latestSnapshot = [];
  let hasInitialSnapshot = false;
  subscription.onChange((snapshot) => {
    if (!Array.isArray(snapshot.data)) return;
    latestSnapshot = snapshot.data;
    hasInitialSnapshot = true;
  });
  await waitFor(() => hasInitialSnapshot);

  const inserted = await recordActivity('product_created', sourceId);
  assert(inserted?.id && inserted?.txid, 'Neon Postgres did not return the committed activity and transaction ID.');
  console.log('PASS: Neon Postgres committed a new activity row.');

  await waitFor(() => latestSnapshot.some((row) => row.id === inserted.id));
  console.log('PASS: Neon Realtime delivered the committed Postgres change to a live subscriber.');

  await waitFor(async () => {
    const response = await fetch(`${apiBase}/activity`, { cache: 'no-store' });
    if (!response.ok) return false;
    const body = await response.json();
    return body.success === true && body.data.items.some((row) => row.id === inserted.id);
  });
  console.log('PASS: MIO API returns the same committed activity row.');
}

try {
  await run();
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'E2E_FAILED';
  console.error(`Neon end-to-end check failed (${code}).`);
  process.exitCode = 1;
} finally {
  let cleanupSucceeded = true;
  if (subscription && typeof subscription.unsubscribe === 'function') subscription.unsubscribe();
  if (liveClient && typeof liveClient.close === 'function') liveClient.close();
  for (const socket of sockets) socket.terminate();
  try {
    await pool.query('DELETE FROM mio.activity_events WHERE source_id = $1', [sourceId]);
  } catch {
    cleanupSucceeded = false;
    if (process.exitCode !== 1) process.exitCode = 1;
    console.error('Neon test-row cleanup failed.');
  }
  await pool.end();
  if (cleanupSucceeded) console.log('PASS: Neon test activity was removed and connections closed.');
}
