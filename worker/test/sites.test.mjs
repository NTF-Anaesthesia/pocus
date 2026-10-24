// worker/sites.js with a stand-in for the static assets. Run: node --test 'worker/test/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../sites.js';

const FILES = { '/pocus/index.html': '<h1>hi</h1>' };
const env = { ASSETS: { fetch: async req => {
  const p = new URL(req.url).pathname;
  return p in FILES ? new Response(FILES[p], { status: 200 }) : new Response('', { status: 404 });
} } };
const get = (url, method = 'GET') => worker.fetch(new Request(url, { method }), env);

test('serves the folder index, noindex', async () => {
  const r = await get('https://pocus.anantf.com/');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<h1>hi</h1>');
  assert.equal(r.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});

test('folder without a slash redirects; missing files 404; unknown hosts 404', async () => {
  assert.equal((await get('https://pocus.anantf.com/pocus')).status, 301);
  assert.equal((await get('https://pocus.anantf.com/nope.js')).status, 404);
  assert.equal((await get('https://x.workers.dev/pocus/')).status, 404);
});

test('only GET and HEAD', async () => {
  assert.equal((await get('https://pocus.anantf.com/', 'POST')).status, 405);
});
