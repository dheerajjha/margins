'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const { ForbiddenPathError, NotFoundError, normaliseRel, resolveExisting, resolveNew, toRel } = require('./lib/paths');
const { ConflictError, createNew, imageType, kindOf, readForView, versionOf, writeChecked } = require('./lib/files');
const { listDir, walkFiles } = require('./lib/tree');
const { findBacklinks, searchFiles } = require('./lib/search');
const { RAW_CONTENT_SECURITY_POLICY, baseHeaders, hostIsAllowed, originIsAllowed } = require('./lib/security');
const { version } = require('./package.json');

/**
 * The margins server: one folder, served to one browser on this machine.
 *
 * No framework. It answers a dozen routes, and every dependency a local tool
 * ships is one more thing in someone's supply chain -- the page's two
 * libraries are the only packages margins installs, and the server uses
 * neither.
 */

const DEFAULT_PORT = 4600;
const DEFAULT_HOST = '127.0.0.1';
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const PUBLIC = path.join(__dirname, 'public');

/**
 * The root of an installed package, from its entry point. The browser builds
 * the page needs are not in either package's export map, so they cannot be
 * required by subpath; the package root can be found from the file that can.
 */
function packageRoot(name) {
  let dir = path.dirname(require.resolve(name));
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Cannot find the ${name} package.`);
    dir = parent;
  }
  return dir;
}

const STATIC = {
  '/': { file: path.join(PUBLIC, 'index.html'), type: 'text/html; charset=utf-8' },
  '/app.js': { file: path.join(PUBLIC, 'app.js'), type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: path.join(PUBLIC, 'style.css'), type: 'text/css; charset=utf-8' },
  '/favicon.svg': { file: path.join(PUBLIC, 'favicon.svg'), type: 'image/svg+xml' },
  '/links.js': { file: path.join(__dirname, 'lib', 'links.js'), type: 'text/javascript; charset=utf-8' },
  '/vendor/marked.js': { file: path.join(packageRoot('marked'), 'lib', 'marked.umd.js'), type: 'text/javascript; charset=utf-8' },
  '/vendor/purify.js': { file: path.join(packageRoot('dompurify'), 'dist', 'purify.min.js'), type: 'text/javascript; charset=utf-8' }
};

class BadRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...baseHeaders(), ...headers });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
}

function fail(res, error) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status === 500) console.error('margins:', error);
  const body = { error: status === 500 ? 'Something went wrong reading that.' : error.message };
  // A conflict carries what is on disk now, so the page can show it rather
  // than only refuse.
  if (error instanceof ConflictError && error.current) body.current = error.current;
  sendJson(res, status, body);
}

async function readJsonBody(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  // Only JSON. An HTML form can post text/plain or form-encoded bodies
  // without any script, and requiring a type no form can send closes that
  // route to the write API on top of the Origin check.
  if (type !== 'application/json') throw new BadRequestError('Send JSON.', 415);

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BadRequestError('That is too large to save here.', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BadRequestError('That was not valid JSON.');
  }
}

/**
 * Build the server for one folder. It is not listening yet; see startServer.
 *
 * @param {object} options
 * @param {string} options.root the folder to serve
 * @param {boolean} [options.hidden] list files and folders whose names start with a dot
 * @param {string|null} [options.initial] a file, relative to the root, to open first
 * @param {() => void} [options.onIdle] called once the last tab has been gone for idleGraceMs
 * @param {number} [options.idleGraceMs]
 * @returns {Promise<http.Server>}
 */
async function createServer({ root, hidden = false, initial = null, onIdle = null, idleGraceMs = 5000 } = {}) {
  // Resolved once. Every confinement check compares against the real path,
  // so a root reached through a symlink is still a root.
  const realRoot = await fsp.realpath(root);
  const displayRoot = displayPath(realRoot);

  // --- the tab-lifecycle bookkeeping, as in reviewer -------------------------
  let watching = 0;
  let idleTimer = null;

  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => fail(res, error));
  });

  const port = () => server.address()?.port;

  async function handle(req, res) {
    // (3) in lib/security.js: nothing is answered for a name margins does not
    // listen on -- the DNS-rebinding defence.
    if (!hostIsAllowed(req, port())) {
      return send(res, 421, 'Misdirected request', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = url.pathname;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // (2) in lib/security.js: writes only from margins' own page.
      if (!originIsAllowed(req, port())) {
        return sendJson(res, 403, { error: 'Changes are only accepted from the margins page itself.' });
      }
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && STATIC[route]) {
      return serveStatic(res, STATIC[route]);
    }
    if (req.method === 'GET' && route.startsWith('/raw/')) return serveRaw(res, route.slice('/raw/'.length));

    const query = name => url.searchParams.get(name) ?? '';

    switch (`${req.method} ${route}`) {
      case 'GET /api/info':
        return sendJson(res, 200, {
          name: path.basename(realRoot),
          root: displayRoot,
          hidden,
          initial,
          version
        });

      case 'GET /api/tree': {
        const rel = normaliseRel(query('path'));
        const abs = await resolveExisting(realRoot, rel);
        return sendJson(res, 200, { path: rel, entries: await listDir(realRoot, abs, { hidden }) });
      }

      case 'GET /api/files':
        return sendJson(res, 200, await walkFiles(realRoot, { hidden }));

      case 'GET /api/file': {
        const rel = normaliseRel(query('path'));
        const abs = await resolveExisting(realRoot, rel);
        return sendJson(res, 200, { path: rel, ...(await readForView(abs)) });
      }

      case 'GET /api/version': {
        // What the page polls to notice a file changing under it -- edited in
        // another editor, or by an agent. The content hash, not mtime, for
        // the same reason saving uses it.
        const rel = normaliseRel(query('path'));
        const abs = await resolveExisting(realRoot, rel);
        const view = await readForView(abs);
        return sendJson(res, 200, { path: rel, version: view.version ?? null });
      }

      case 'PUT /api/file': {
        const body = await readJsonBody(req);
        const rel = normaliseRel(body.path);
        if (typeof body.version !== 'string') throw new BadRequestError('Say which version you are replacing.');
        const abs = await resolveExisting(realRoot, rel);
        return sendJson(res, 200, { path: rel, ...(await writeChecked(abs, body.content, body.version)) });
      }

      case 'POST /api/file': {
        const body = await readJsonBody(req);
        const rel = normaliseRel(body.path);
        if (!rel) throw new BadRequestError('A new file needs a name.');
        const abs = await resolveNew(realRoot, rel);
        const created = await createNew(abs, typeof body.content === 'string' ? body.content : '');
        return sendJson(res, 201, { path: rel, kind: kindOf(rel), ...created });
      }

      case 'GET /api/search': {
        const q = query('q').trim();
        if (q.length < 2) return sendJson(res, 200, { query: q, results: [], truncated: false, filesSearched: 0 });
        const { files } = await walkFiles(realRoot, { hidden });
        return sendJson(res, 200, { query: q, ...(await searchFiles(realRoot, files, q)) });
      }

      case 'GET /api/backlinks': {
        const rel = normaliseRel(query('path'));
        const { files } = await walkFiles(realRoot, { hidden });
        return sendJson(res, 200, { path: rel, backlinks: await findBacklinks(realRoot, files, rel) });
      }

      case 'GET /api/alive':
        return holdAlive(req, res);

      default:
        return sendJson(res, 404, { error: 'No such route.' });
    }
  }

  async function serveStatic(res, { file, type }) {
    const body = await fsp.readFile(file);
    send(res, 200, body, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  }

  /**
   * An image from the folder, for markdown that shows one. Images only: an
   * HTML file served raw would be a page in margins' origin, and serving it
   * is not what a markdown browser is for.
   */
  async function serveRaw(res, encoded) {
    let rel;
    try {
      rel = normaliseRel(decodeURIComponent(encoded));
    } catch (error) {
      if (error instanceof ForbiddenPathError) throw error;
      throw new BadRequestError('That path is not valid.');
    }
    const type = imageType(rel);
    if (!type) throw new NotFoundError(rel);

    const abs = await resolveExisting(realRoot, rel);
    const body = await fsp.readFile(abs);
    send(res, 200, body, {
      'Content-Type': type,
      'Content-Security-Policy': RAW_CONTENT_SECURITY_POLICY,
      'Cache-Control': 'no-cache'
    });
  }

  /**
   * Held open for as long as a tab is watching; the connection closing is
   * the signal. See reviewer's /api/alive for the reasoning, which applies
   * unchanged: a reload closes and reopens within milliseconds, so the last
   * one leaving starts a timer the next arrival cancels, and a server no tab
   * ever opened is not idle.
   */
  function holdAlive(req, res) {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    watching += 1;

    res.writeHead(200, {
      ...baseHeaders(),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write(': watching\n\n');

    res.on('close', () => {
      watching -= 1;
      if (watching > 0 || !onIdle) return;
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (watching === 0) onIdle();
      }, idleGraceMs);
      idleTimer.unref();
    });
  }

  server.realRoot = realRoot;
  return server;
}

/** A path for showing people: under the home directory, written with ~. */
function displayPath(abs) {
  const home = require('node:os').homedir();
  const rel = path.relative(home, abs);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? `~${path.sep}${rel}` : abs;
}

/**
 * Create the server and listen on 127.0.0.1 -- never on every interface.
 * Anyone who could reach the port could read the folder.
 *
 * @returns {Promise<http.Server>}
 */
async function startServer(options = {}) {
  const { port = DEFAULT_PORT, host = DEFAULT_HOST, ...rest } = options;
  const server = await createServer(rest);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

module.exports = { DEFAULT_HOST, DEFAULT_PORT, createServer, displayPath, startServer, versionOf, toRel };
