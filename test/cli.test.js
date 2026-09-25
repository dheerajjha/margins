'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

const { USAGE, UsageError, parseArgs } = require('../lib/cli');
const { version } = require('../package.json');

const run = promisify(execFile);
const BIN = path.join(__dirname, '..', 'bin', 'inkd.js');

test('no arguments means the current folder, opened in a browser', () => {
  assert.deepEqual(parseArgs([]), { path: null, port: null, hidden: false, open: true, help: false, version: false });
});

test('a path, a port and the switches are read', () => {
  assert.deepEqual(parseArgs(['notes', '--port', '5000', '--hidden', '--no-open']),
    { path: 'notes', port: 5000, hidden: true, open: false, help: false, version: false });
  assert.equal(parseArgs(['-p', '0']).port, 0);
});

test('bad input is a usage error that says what was wrong', () => {
  assert.throws(() => parseArgs(['--port']), /needs a port number/);
  assert.throws(() => parseArgs(['--port', 'abc']), UsageError);
  assert.throws(() => parseArgs(['--port', '70000']), UsageError);
  assert.throws(() => parseArgs(['--frobnicate']), /Unknown option: --frobnicate/);
  assert.throws(() => parseArgs(['a', 'b']), /not several/);
});

test('the usage text mentions every option', () => {
  for (const option of ['--port', '--hidden', '--no-open', '--version', '--help']) {
    assert.ok(USAGE.includes(option), option);
  }
});

test('--version and --help print and exit without starting anything', async () => {
  assert.equal((await run('node', [BIN, '--version'])).stdout.trim(), version);
  assert.match((await run('node', [BIN, '--help'])).stdout, /^inkd — open a folder of markdown/);
});

test('a path that does not exist is a clear error, exit 2', async () => {
  await assert.rejects(run('node', [BIN, '/definitely/not/here']), error => {
    assert.equal(error.code, 2);
    assert.match(error.stderr, /inkd: Nothing at \/definitely\/not\/here\./);
    return true;
  });
});
