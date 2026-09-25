'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const { versionOf } = require('../lib/files');
const { makeFolder, removeFolder, startTestServer } = require('./helpers/fixture');

/** A folder and a server on it, torn down after the test. */
async function serve(t, files, options) {
  const root = await makeFolder(files);
  const app = await startTestServer(root, options);
  t.after(async () => { await app.close(); await removeFolder(root); });
  return { root, ...app };
}

/**
 * A raw request, for headers fetch will not let a test set -- fetch always
 * sends the real Host, and the DNS-rebinding check is about a fake one.
 */
function rawRequest(port, { method = 'GET', path: route = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: route, headers }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// --- reading ---------------------------------------------------------------------

test('the page and its scripts are served, each with the security headers', async t => {
  const app = await serve(t, {});
  for (const route of ['/', '/app.js', '/style.css', '/links.js', '/vendor/marked.js', '/vendor/purify.js', '/favicon.svg']) {
    const response = await app.get(route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/, route);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', route);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer', route);
  }
});

test('the policy allows no script inkd did not ship, and no forms or framing', async t => {
  const app = await serve(t, {});
  const policy = (await app.get('/')).headers.get('content-security-policy');
  assert.match(policy, /script-src 'self'(;|$)/, 'no unsafe-inline, no unsafe-eval');
  assert.match(policy, /form-action 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /object-src 'none'/);
});

test('info names the folder and the file to open first', async t => {
  const app = await serve(t, { 'README.md': '# Hi' }, { initial: 'README.md' });
  const { body } = await app.getJson('/api/info');
  assert.equal(body.initial, 'README.md');
  assert.equal(body.name, path.basename(app.root));
  assert.equal(typeof body.version, 'string');
});

test('the tree, the file list and a file', async t => {
  const app = await serve(t, { 'notes/a.md': '# A\n', 'b.md': 'b' });

  assert.deepEqual((await app.getJson('/api/tree?path=')).body.entries.map(e => e.name), ['notes', 'b.md']);
  assert.deepEqual((await app.getJson('/api/files')).body.files.map(f => f.path), ['b.md', 'notes/a.md']);
  const { body } = await app.getJson('/api/file?path=notes/a.md');
  assert.deepEqual(body, { path: 'notes/a.md', kind: 'markdown', size: 4, content: '# A\n', version: versionOf(Buffer.from('# A\n')) });
});

test('a missing file is 404 and a path out of the folder is 403', async t => {
  const app = await serve(t, {});
  assert.equal((await app.getJson('/api/file?path=nope.md')).status, 404);
  assert.equal((await app.getJson('/api/file?path=../../etc/passwd')).status, 403);
  assert.equal((await app.getJson('/api/file?path=.git/config')).status, 403);
  assert.equal((await app.getJson('/api/tree?path=..')).status, 403);
});

test('the version endpoint changes when the file does', async t => {
  const app = await serve(t, { 'a.md': 'one' });
  const before = (await app.getJson('/api/version?path=a.md')).body.version;
  await fs.writeFile(path.join(app.root, 'a.md'), 'two');
  const after = (await app.getJson('/api/version?path=a.md')).body.version;
  assert.notEqual(before, after);
  assert.equal(after, versionOf(Buffer.from('two')));
});

test('search and backlinks answer over HTTP', async t => {
  const app = await serve(t, { 'a.md': 'links to [[b]]', 'b.md': 'the needle' });
  const search = (await app.getJson('/api/search?q=needle')).body;
  assert.deepEqual(search.results.map(r => r.path), ['b.md']);
  assert.deepEqual((await app.getJson('/api/search?q=n')).body.results, [], 'one character is not a search');
  assert.deepEqual((await app.getJson('/api/backlinks?path=b.md')).body.backlinks.map(b => b.path), ['a.md']);
});

// --- images ------------------------------------------------------------------------

test('images are served raw, in a sandbox that stops an SVG running script', async t => {
  const app = await serve(t, { 'a.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>', 'p.png': 'png' });
  const svg = await app.get('/raw/a.svg');
  assert.equal(svg.status, 200);
  assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
  assert.match(svg.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await app.get('/raw/p.png')).headers.get('content-type'), 'image/png');
});

test('raw serves images only -- an HTML file served raw would be a page in inkd\'s origin', async t => {
  const app = await serve(t, { 'page.html': '<script>x()</script>', 'a.md': 'x' });
  assert.equal((await app.get('/raw/page.html')).status, 404);
  assert.equal((await app.get('/raw/a.md')).status, 404);
  assert.equal((await app.get('/raw/..%2F..%2Fetc%2Fpasswd')).status, 403);
});

// --- writing ---------------------------------------------------------------------

test('saving the version that was read writes the file', async t => {
  const app = await serve(t, { 'a.md': 'old' });
  const { version } = (await app.getJson('/api/file?path=a.md')).body;
  const saved = await app.send('PUT', '/api/file', { path: 'a.md', content: 'new', version });
  assert.equal(saved.status, 200);
  assert.equal(await fs.readFile(path.join(app.root, 'a.md'), 'utf8'), 'new');
});

test('saving over a change made elsewhere is 409, and carries what is there now', async t => {
  const app = await serve(t, { 'a.md': 'old' });
  const { version } = (await app.getJson('/api/file?path=a.md')).body;
  await fs.writeFile(path.join(app.root, 'a.md'), 'theirs');

  const response = await app.send('PUT', '/api/file', { path: 'a.md', content: 'mine', version });
  assert.equal(response.status, 409);
  assert.equal(response.body.current.content, 'theirs');
  assert.equal(await fs.readFile(path.join(app.root, 'a.md'), 'utf8'), 'theirs');
});

test('a save must say which version it replaces', async t => {
  const app = await serve(t, { 'a.md': 'old' });
  assert.equal((await app.send('PUT', '/api/file', { path: 'a.md', content: 'x' })).status, 400);
});

test('creating a file, and not overwriting one', async t => {
  const app = await serve(t, { 'taken.md': 'keep' });
  const created = await app.send('POST', '/api/file', { path: 'new/note.md', content: '# Note\n' });
  assert.equal(created.status, 201);
  assert.equal(await fs.readFile(path.join(app.root, 'new', 'note.md'), 'utf8'), '# Note\n');
  assert.equal((await app.send('POST', '/api/file', { path: 'taken.md', content: 'x' })).status, 409);
});

test('nothing can be written into .git, out of the folder, or through a symlink that leads out', async t => {
  const outside = await makeFolder({});
  t.after(() => removeFolder(outside));
  const app = await serve(t, { 'a.md': 'a' });
  await fs.symlink(outside, path.join(app.root, 'away'));

  assert.equal((await app.send('POST', '/api/file', { path: '.git/hooks/pre-commit', content: 'x' })).status, 403);
  assert.equal((await app.send('POST', '/api/file', { path: '../escaped.md', content: 'x' })).status, 403);
  assert.equal((await app.send('POST', '/api/file', { path: 'away/escaped.md', content: 'x' })).status, 403);
  await assert.rejects(fs.access(path.join(outside, 'escaped.md')), 'nothing was written outside');
});

// --- who may ask -----------------------------------------------------------------

test('a request addressed to another name is refused -- DNS rebinding', async t => {
  const app = await serve(t, { 'a.md': 'secret' });
  const response = await rawRequest(app.port, { path: '/api/file?path=a.md', headers: { Host: `attacker.example:${app.port}` } });
  assert.equal(response.status, 421);
  assert.doesNotMatch(response.body, /secret/);
  const ok = await rawRequest(app.port, { path: '/api/file?path=a.md', headers: { Host: `localhost:${app.port}` } });
  assert.equal(ok.status, 200, 'localhost is inkd too');
});

test('a write from another website is refused, and so is one with no Origin', async t => {
  const app = await serve(t, { 'a.md': 'a' });
  const { version } = (await app.getJson('/api/file?path=a.md')).body;

  const foreign = await app.send('PUT', '/api/file', { path: 'a.md', content: 'pwned', version }, { Origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  const none = await rawRequest(app.port, {
    method: 'PUT', path: '/api/file',
    headers: { Host: `127.0.0.1:${app.port}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'a.md', content: 'pwned', version })
  });
  assert.equal(none.status, 403);
  assert.equal(await fs.readFile(path.join(app.root, 'a.md'), 'utf8'), 'a');
});

test('a write that is not JSON is refused -- what an HTML form could send', async t => {
  const app = await serve(t, {});
  const response = await app.send('POST', '/api/file', 'path=x.md', { 'Content-Type': 'text/plain' });
  assert.equal(response.status, 415);
  await assert.rejects(fs.access(path.join(app.root, 'x.md')));
});

test('no CORS header is ever sent, so another site cannot read an answer', async t => {
  const app = await serve(t, { 'a.md': 'a' });
  const response = await app.get('/api/file?path=a.md', { Origin: 'https://evil.example' });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

// --- the tab's lifetime ------------------------------------------------------------

const GRACE = 300;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Open /api/alive the way a tab does. The response and a pending read are
 * held on the handle: Node's fetch closes the socket of an unconsumed
 * response when it is garbage-collected, which the server would see as the
 * tab closing. reviewer learned that one on a CI runner.
 */
async function openTab(url) {
  const controller = new AbortController();
  const response = await fetch(`${url}/api/alive`, { signal: controller.signal });
  const reader = response.body.getReader();
  reader.read().catch(() => {});
  return { close: () => controller.abort(), response, reader };
}

test('the last tab closing stops inkd, after a grace period', async t => {
  let idle = 0;
  const app = await serve(t, {}, { onIdle: () => { idle += 1; }, idleGraceMs: GRACE });
  const tab = await openTab(app.url);
  tab.close();
  await wait(GRACE / 3);
  assert.equal(idle, 0, 'not the instant it closes');
  await wait(GRACE * 3);
  assert.equal(idle, 1);
});

test('a reload, or a second tab, keeps it running', async t => {
  let idle = 0;
  const app = await serve(t, {}, { onIdle: () => { idle += 1; }, idleGraceMs: GRACE });
  const first = await openTab(app.url);
  first.close();
  const second = await openTab(app.url);
  const third = await openTab(app.url);
  second.close();
  await wait(GRACE * 3);
  assert.equal(idle, 0);
  third.close();
  await wait(GRACE * 3);
  assert.equal(idle, 1);
});

test('a server no tab ever opened keeps serving', async t => {
  let idle = 0;
  await serve(t, {}, { onIdle: () => { idle += 1; }, idleGraceMs: GRACE });
  await wait(GRACE * 3);
  assert.equal(idle, 0);
});
