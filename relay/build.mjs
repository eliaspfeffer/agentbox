// BUILDS WHAT THE RELAY SERVES (npm run relay:build), into relay/dist/assets.mjs,
// which relay/worker.mjs imports: the phone's service worker, the first page,
// and the home-screen icon. One generated module, so the worker needs no
// bundler rules of its own and wrangler deploys it as it is.
//
// - the service worker is relay/phone/sw.mjs bundled, then main/phone-sw.js,
//   so alerts are handled by the same code as on the Wi-Fi;
// - the first page is relay/phone/bootstrap.html with bootstrap.mjs inlined,
//   and the hash of that script, so the page may run it and nothing else.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Name } from '../shared/product-name.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);

async function bundle(entry) {
  const out = await build({ entryPoints: [path.join(here, entry)], bundle: true, format: 'iife', platform: 'browser', target: 'es2020', write: false, minify: true, legalComments: 'none' });
  return out.outputFiles[0].text;
}

export async function buildRelay({ outDir = path.join(here, 'dist') } = {}) {
  const alerts = fs.readFileSync(path.join(root, 'main', 'phone-sw.js'), 'utf8').replaceAll('__APP_NAME__', Name);
  const sw = `${await bundle('phone/sw.mjs')}\n${alerts}`;
  const script = (await bundle('phone/bootstrap.mjs')).trim();
  const boot = fs.readFileSync(path.join(here, 'phone', 'bootstrap.html'), 'utf8').replace('/*BOOTSTRAP*/', () => script);
  const scriptHash = `sha256-${crypto.createHash('sha256').update(script).digest('base64')}`;
  const icon = fs.readFileSync(path.join(root, 'main', 'phone-icon.png')).toString('base64');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'assets.mjs');
  fs.writeFileSync(file, [
    '// Made by relay/build.mjs. Do not edit; run npm run relay:build.',
    `export const SW = ${JSON.stringify(sw)};`,
    `export const BOOT = ${JSON.stringify(boot)};`,
    `export const BOOT_SCRIPT_HASH = ${JSON.stringify(scriptHash)};`,
    `export const ICON_B64 = ${JSON.stringify(icon)};`,
    '',
  ].join('\n'));
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = await buildRelay();
  console.log(`Built ${path.relative(root, file)}`);
}
