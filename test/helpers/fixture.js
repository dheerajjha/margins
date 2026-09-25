'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createServer } = require('../../server');

/**
 * A throwaway folder with the given files in it. Content is written here, in
 * the test, never copied from a real folder -- the same rule reviewer keeps.
 *
 * @param {Record<string, string|Buffer>} files path -> content
 * @returns {Promise<string>} the folder, through realpath (macOS reports /var
 *   as a symlink, and paths the tests compute must match the server's)
 */
async function makeFolder(files = {}) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'inkd-test-')));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  return dir;
}

async function removeFolder(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * The server on an ephemeral port, with helpers that send what a browser
 * would -- including the Host and Origin headers the security checks read.
 */
async function startTestServer(root, options = {}) {
  const server = await createServer({ root, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;

  const get = (route, headers = {}) => fetch(url + route, { headers });
  const getJson = async route => {
    const response = await get(route);
    return { status: response.status, body: await response.json() };
  };
  const send = async (method, route, body, headers = {}) => {
    const response = await fetch(url + route, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: url, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    });
    let json = null;
    try { json = await response.json(); } catch { /* not JSON */ }
    return { status: response.status, body: json };
  };

  return {
    url,
    port,
    server,
    get,
    getJson,
    send,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

module.exports = { makeFolder, removeFolder, startTestServer };
