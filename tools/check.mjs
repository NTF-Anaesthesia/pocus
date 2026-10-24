// Repo checks. Run before merging: node tools/check.mjs
// 1. Every relative href/src/url() in the pages and CSS points at a file that exists.
// 2. wrangler.jsonc keeps preview links and the workers.dev address off.
// 3. The Worker's tests pass.
// (The lecture content and numerical-model checks are pocus/test/content.py and model.test.cjs; checks.yml runs them.)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = m => errors.push(m);

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? (e.name === 'test' ? [] : walk(p)) : [p];
});
const files = walk(path.join(ROOT, 'pocus')).filter(f => /\.(html|css)$/.test(f));

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const refs = [...src.matchAll(/(?:href|src)="([^"#?$]+)[^"]*"|url\(['"]?([^'")?#]+)/g)].map(m => m[1] || m[2]);
  for (const r of refs) {
    if (/^(https?:|mailto:|data:|%|\/\/|\.\/?$)/.test(r) || r.includes('${')) continue;
    if (!fs.existsSync(path.join(path.dirname(f), r))) fail(`${path.relative(ROOT, f)}: missing ${r}`);
  }
}

const wr = fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
if (!/"preview_urls":\s*false/.test(wr)) fail('wrangler.jsonc: preview_urls must be false');
if (!/"workers_dev":\s*false/.test(wr)) fail('wrangler.jsonc: workers_dev must be false');

try { execFileSync('node', ['--test', ...fs.readdirSync(path.join(ROOT, 'worker/test')).map(f => `worker/test/${f}`)], { cwd: ROOT, stdio: 'pipe' }); }
catch (e) { fail(`worker tests failed:\n${e.stdout}${e.stderr}`); }

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`checks passed (${files.length} pages and stylesheets)`);
