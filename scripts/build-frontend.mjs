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
