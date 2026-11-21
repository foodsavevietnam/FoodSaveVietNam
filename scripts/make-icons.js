/** Regenerate MIO PWA icons from the supplied logo on Windows. */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32') {
  console.error('Regenerate logo icons on Windows with scripts/make-brand-icons.ps1.');
  process.exitCode = 1;
} else {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'make-brand-icons.ps1'),
  ], { stdio: 'inherit', windowsHide: true });
  if (result.error) console.error('Cannot start the MIO icon generator.');
  process.exitCode = result.status ?? 1;
}
