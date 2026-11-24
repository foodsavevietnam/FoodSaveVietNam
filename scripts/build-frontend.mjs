import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const backendRoot = fileURLToPath(new URL('../', import.meta.url));

await build({
  absWorkingDir: backendRoot,
  stdin: {
    contents: 'export { createRealtimeClient } from "@neon/realtime/client";',
    resolveDir: backendRoot,
    sourcefile: 'mio-realtime-browser.js',
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  outfile: 'public/frontend/neon-realtime-client.mjs',
  minify: true,
  legalComments: 'inline',
  banner: { js: '/* MIO browser SDK bundle: @neon/realtime, Apache-2.0. https://github.com/neondatabase/neon-pkgs */' },
});

console.log('Built same-origin Neon Realtime browser SDK.');

const publicSupabaseUrl = String(process.env.PUBLIC_SUPABASE_URL || '').trim();
const publicSupabaseAnonKey = String(process.env.PUBLIC_SUPABASE_ANON_KEY || '').trim();

if (publicSupabaseUrl || publicSupabaseAnonKey) {
  const configPath = path.join(backendRoot, 'public', 'frontend', 'foodsave-config.js');
  let configSource = await readFile(configPath, 'utf8');

  if (publicSupabaseUrl) {
    const urlPattern = /var\s+DEFAULT_SUPABASE_URL\s*=\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*');/;
    if (!urlPattern.test(configSource)) {
      throw new Error('Could not locate DEFAULT_SUPABASE_URL in public/frontend/foodsave-config.js');
    }
    configSource = configSource.replace(
      urlPattern,
      () => `var DEFAULT_SUPABASE_URL = ${JSON.stringify(publicSupabaseUrl)};`,
    );
  }

  if (publicSupabaseAnonKey) {
    const keyPattern = /var\s+DEFAULT_SUPABASE_ANON_KEY\s*=\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*');/;
    if (!keyPattern.test(configSource)) {
      throw new Error('Could not locate DEFAULT_SUPABASE_ANON_KEY in public/frontend/foodsave-config.js');
    }
    configSource = configSource.replace(
      keyPattern,
      () => `var DEFAULT_SUPABASE_ANON_KEY = ${JSON.stringify(publicSupabaseAnonKey)};`,
    );
  }

  await writeFile(configPath, configSource, 'utf8');
  console.log('Injected PUBLIC_SUPABASE_* overrides into public/frontend/foodsave-config.js.');
}
