import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Pool } from 'pg';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));

const localEnvPath = path.join(projectRoot, '.env.local');
const rootEnvPath = await readFile(localEnvPath, 'utf8').then(() => localEnvPath).catch((error) => {
  if (error.code === 'ENOENT') return path.join(workspaceRoot, '.env.local');
  throw error;
});
const rootEnv = await readFile(rootEnvPath, 'utf8').then((text) => dotenv.parse(text)).catch((error) => {
  if (error.code === 'ENOENT') return {};
  throw error;
});

const rawConnectionString = rootEnv.DATABASE_URL_UNPOOLED || rootEnv.DATABASE_URL;
let connectionString;
try {
  if (rawConnectionString) {
    const parsed = new URL(rawConnectionString);
    parsed.searchParams.set('sslmode', 'verify-full');
    connectionString = parsed.toString();
  }
} catch {
  console.error('Neon connection URL is invalid.');
  process.exitCode = 1;
}

if (!connectionString) {
  console.error('Thiếu kết nối Neon. Hãy chạy neon env pull trong thư mục dự án.');
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 15000 });
  try {
    const migration = await readFile(
      path.join(projectRoot, 'database', 'Neon', '001_mio_activity.sql'),
      'utf8',
    );
    await pool.query(migration);
    console.log('Applied Neon migration 001_mio_activity.sql.');
  } catch (error) {
    console.error(`Neon migration failed (${error.code || error.name || 'unknown error'}).`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
