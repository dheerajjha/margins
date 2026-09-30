'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { openCommand, openInBrowser } = require('../lib/browser');

const URL = 'http://127.0.0.1:4600/';

test('Windows gives start an empty window title before the URL', () => {
  assert.deepEqual(openCommand('win32', URL), {
    command: 'cmd', args: ['/c', 'start', '', URL]
  });
});

test('macOS opens the URL with open', () => {
  assert.deepEqual(openCommand('darwin', URL), { command: 'open', args: [URL] });
});

test('Linux opens the URL with xdg-open', () => {
  assert.deepEqual(openCommand('linux', URL), { command: 'xdg-open', args: [URL] });
});

test('opening waits for the opener to spawn, then releases its process handle', async () => {
  const child = new EventEmitter();
  let unrefCalls = 0;
  child.unref = () => { unrefCalls += 1; };
  const calls = [];
  const result = openInBrowser(URL, {
    platform: 'win32',
    spawn: (...args) => { calls.push(args); return child; }
  });

  assert.deepEqual(calls, [
    ['cmd', ['/c', 'start', '', URL], { stdio: 'ignore', detached: true }]
  ]);
  let settled = false;
  result.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(unrefCalls, 0);

  child.emit('spawn');
  assert.equal(await result, true);
  assert.equal(unrefCalls, 1);
});

test('an opener error returns false so the caller can show the address', async () => {
  const child = new EventEmitter();
  let unrefCalls = 0;
  child.unref = () => { unrefCalls += 1; };
  const result = openInBrowser(URL, { platform: 'win32', spawn: () => child });

  queueMicrotask(() => child.emit('error', new Error('opener unavailable')));
  assert.equal(await result, false);
  assert.equal(unrefCalls, 0);
});

test('a synchronous spawn error also returns false', async () => {
  assert.equal(await openInBrowser(URL, {
    platform: 'win32',
    spawn: () => { throw new Error('cannot spawn opener'); }
  }), false);
});
