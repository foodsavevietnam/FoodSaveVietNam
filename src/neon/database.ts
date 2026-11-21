import { Pool, type PoolConfig } from "pg";
import { neon } from "@neondatabase/serverless";

let pool: Pool | undefined;
let httpQuery: ReturnType<typeof neon<false, true>> | undefined;

/** Netlify's Lambda runtime does not guarantee build-only NETLIFY is present. */
export const isNeonHttpRuntime = (environment: NodeJS.ProcessEnv = process.env): boolean =>
  Boolean(environment.NETLIFY || environment.AWS_LAMBDA_FUNCTION_NAME);

const getDatabaseUrl = (): string => {
  const value = process.env.NEON_DATABASE_URL;
  if (!value) {
    throw new Error("Neon Postgres is not configured.");
  }

  let connectionUrl: URL;
  try {
    connectionUrl = new URL(value);
  } catch {
    throw new Error("Neon Postgres connection URL is invalid.");
  }

  if (!/^postgres(?:ql)?:$/i.test(connectionUrl.protocol) || !connectionUrl.hostname) {
    throw new Error("Neon Postgres connection URL is invalid.");
  }

  // Keep full certificate verification enabled with current and upcoming pg versions.
  connectionUrl.searchParams.set("sslmode", "verify-full");
  return connectionUrl.toString();
};

/** A small shared pool for this separate Neon data slice; legacy Supabase Postgres stays untouched. */
export const getNeonPool = (): Pool => {
  if (pool) return pool;

  const config: PoolConfig = {
    connectionString: getDatabaseUrl(),
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
    statement_timeout: 10_000,
    ssl: { rejectUnauthorized: true },
    allowExitOnIdle: false,
  };
  pool = new Pool(config);
  pool.on("error", (error: Error & { code?: string }) => {
    console.warn("Neon Postgres idle connection error", { code: error.code });
  });
  return pool;
};

/**
 * Run a single Neon query through HTTP on Netlify Functions, and through the
 * existing node-postgres pool in a long-lived local Node process.
 */
export const query = async <Row = Record<string, unknown>>(
  text: string,
  parameters: unknown[] = [],
): Promise<{ rows: Row[] }> => {
  if (isNeonHttpRuntime()) {
    if (!httpQuery) {
      httpQuery = neon(getDatabaseUrl(), { fullResults: true });
    }
    const result = await httpQuery.query(text, parameters, {
      fetchOptions: { signal: AbortSignal.timeout(10_000) },
    });
    return { rows: result.rows as Row[] };
  }

  const result = await getNeonPool().query(text, parameters);
  return { rows: result.rows as Row[] };
};

export const getNeonDatabaseName = (): string => {
  const connectionUrl = new URL(getDatabaseUrl());
  const databaseName = decodeURIComponent(connectionUrl.pathname.replace(/^\//u, ""));
  if (!databaseName || !/^[A-Za-z0-9_-]+$/u.test(databaseName)) {
    throw new Error("Neon Postgres database name is invalid.");
  }
  return databaseName;
};

export const closeNeonPool = async (): Promise<void> => {
  if (!pool) return;
  const currentPool = pool;
  pool = undefined;
  await currentPool.end();
};
