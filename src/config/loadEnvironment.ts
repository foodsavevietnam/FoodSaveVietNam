import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const BACKEND_ROOT = path.resolve(__dirname, "..", "..");
const MAX_PARENT_ENV_SEARCH_LEVELS = 3;

const isNonEmpty = (value: string | undefined): value is string => Boolean(value && value.trim());

const readEnvFile = (filePath: string): Record<string, string> => {
  if (!fs.existsSync(filePath)) return {};
  return dotenv.parse(fs.readFileSync(filePath));
};

const isNeonConnection = (value: string | undefined): value is string => {
  if (!isNonEmpty(value)) return false;
  try {
    return new URL(value).hostname.toLowerCase().endsWith(".neon.tech");
  } catch {
    return false;
  }
};

/**
 * Find the nearest `.env.local` in `MIO_ENV_DIR` (if set) or by walking up at most
 * `maxParentLevels` parent directories above `backendRoot` (supporting `.worktrees/*`
 * and `.release/*` layouts).
 */
export const findNearestEnvLocal = (
  backendRoot: string = BACKEND_ROOT,
  environment: NodeJS.ProcessEnv = process.env,
  maxParentLevels: number = MAX_PARENT_ENV_SEARCH_LEVELS,
): string | null => {
  if (isNonEmpty(environment.MIO_ENV_DIR)) {
    const explicitCandidate = path.join(path.resolve(environment.MIO_ENV_DIR.trim()), ".env.local");
    if (fs.existsSync(explicitCandidate)) {
      return explicitCandidate;
    }
  }

  let currentDir = path.resolve(backendRoot);
  for (let level = 1; level <= maxParentLevels; level += 1) {
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    const candidate = path.join(parentDir, ".env.local");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    currentDir = parentDir;
  }

  return null;
};

/** Merge parsed environment sources without logging or returning their values. */
export const configureEnvironment = (
  environment: NodeJS.ProcessEnv,
  backendValues: Record<string, string>,
  rootValues: Record<string, string>,
): void => {
  const processDatabaseUrl = environment.DATABASE_URL;
  const rootNeonValues = Object.fromEntries(Object.entries(rootValues).filter(([name]) =>
    name === "DATABASE_URL" || name === "DATABASE_URL_UNPOOLED" ||
    name === "NEON_REALTIME_URL" || name === "NEON_REALTIME_SECRET",
  ));

  for (const [name, value] of Object.entries(backendValues)) {
    if (name === "DATABASE_URL" || isNonEmpty(environment[name])) continue;
    environment[name] = value;
  }

  // Preserve a legacy Supabase direct connection separately from a Neon
  // DATABASE_URL that may have been injected by the host environment.
  const supabaseDatabaseUrl = [processDatabaseUrl, backendValues.DATABASE_URL]
    .find((value) => isNonEmpty(value) && !isNeonConnection(value));
  if (!isNonEmpty(environment.SUPABASE_DATABASE_URL) && isNonEmpty(supabaseDatabaseUrl)) {
    environment.SUPABASE_DATABASE_URL = supabaseDatabaseUrl;
  }

  const neonDatabaseUrl = isNeonConnection(processDatabaseUrl)
    ? processDatabaseUrl
    : isNeonConnection(backendValues.DATABASE_URL)
      ? backendValues.DATABASE_URL
      : rootNeonValues.DATABASE_URL;
  if (isNonEmpty(neonDatabaseUrl) && !isNonEmpty(environment.NEON_DATABASE_URL)) {
    environment.NEON_DATABASE_URL = neonDatabaseUrl;
  }
  if (isNonEmpty(rootNeonValues.DATABASE_URL_UNPOOLED) && !isNonEmpty(environment.DATABASE_URL_UNPOOLED)) {
    environment.DATABASE_URL_UNPOOLED = rootNeonValues.DATABASE_URL_UNPOOLED;
  }
  if (isNonEmpty(rootNeonValues.NEON_REALTIME_URL) && !isNonEmpty(environment.NEON_REALTIME_URL)) {
    environment.NEON_REALTIME_URL = rootNeonValues.NEON_REALTIME_URL;
  }
  if (isNonEmpty(rootNeonValues.NEON_REALTIME_SECRET) && !isNonEmpty(environment.NEON_REALTIME_SECRET)) {
    environment.NEON_REALTIME_SECRET = rootNeonValues.NEON_REALTIME_SECRET;
  }
};

export interface LoadEnvironmentOptions {
  backendRoot?: string;
  environment?: NodeJS.ProcessEnv;
}

/**
 * Load only the backend .env and the workspace Neon .env.local. Existing process
 * variables always win. Neon is kept separate from legacy Supabase Postgres so
 * merely adding a Neon URL cannot redirect seller-reputation writes.
 */
export const loadEnvironment = (options: LoadEnvironmentOptions = {}): void => {
  const environment = options.environment ?? process.env;
  const backendRoot = path.resolve(options.backendRoot ?? BACKEND_ROOT);

  if (environment.AWS_LAMBDA_FUNCTION_NAME || environment.NETLIFY) {
    configureEnvironment(environment, {}, {});
    return;
  }

  const explicitEnvDir = isNonEmpty(environment.MIO_ENV_DIR)
    ? path.resolve(environment.MIO_ENV_DIR.trim())
    : null;
  const explicitBackendEnv = explicitEnvDir ? readEnvFile(path.join(explicitEnvDir, ".env")) : {};
  const backendEnvValues = {
    ...explicitBackendEnv,
    ...readEnvFile(path.join(backendRoot, ".env")),
  };

  const ancestorNeonEnvPath = findNearestEnvLocal(backendRoot, environment, MAX_PARENT_ENV_SEARCH_LEVELS);
  const rootNeonValues = ancestorNeonEnvPath ? readEnvFile(ancestorNeonEnvPath) : {};
  const localNeonValues = readEnvFile(path.join(backendRoot, ".env.local"));

  configureEnvironment(environment, backendEnvValues, {
    ...rootNeonValues,
    ...localNeonValues,
  });
};
