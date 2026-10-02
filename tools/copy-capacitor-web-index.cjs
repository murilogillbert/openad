/**
 * Angular 21 client output uses `index.csr.html`; Capacitor requires `index.html` in webDir.
 * Run after `nx run openad-ad-client:build` and before `cap sync`.
 */
const fs = require('fs');
const path = require('path');

const browser = path.join(
  __dirname,
  '..',
  'dist',
  'app',
  'openad-ad-client',
  'browser'
);
const csr = path.join(browser, 'index.csr.html');
const idx = path.join(browser, 'index.html');

if (!fs.existsSync(csr)) {
  console.error(`copy-capacitor-web-index: missing ${csr} — build the app first.`);
  process.exit(1);
}
fs.copyFileSync(csr, idx);
console.log(`copy-capacitor-web-index: ${path.basename(csr)} → index.html`);
