'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const { listDir, walkFiles } = require('../lib/tree');
const { makeFolder, removeFolder } = require('./helpers/fixture');

const names = entries => entries.map(entry => `${entry.type === 'dir' ? '/' : ''}${entry.name}`);

test('folders come first, then files, in the order a person sorts them', async t => {
  const root = await makeFolder({
    'note 10.md': '', 'note 2.md': '', 'Apple.md': '', 'banana.md': '', 'zeta/x.md': '', 'alpha/x.md': ''
  });
  t.after(() => removeFolder(root));

  assert.deepEqual(names(await listDir(root, root)),
    ['/alpha', '/zeta', 'Apple.md', 'banana.md', 'note 2.md', 'note 10.md']);
});

test('hidden entries are left out unless asked for, and .git never appears', async t => {
  const root = await makeFolder({ '.obsidian/app.json': '{}', '.env': 'x', 'a.md': '', '.git/HEAD': 'ref', 'node_modules/p/i.js': '' });
  t.after(() => removeFolder(root));

  assert.deepEqual(names(await listDir(root, root)), ['a.md']);
  assert.deepEqual(names(await listDir(root, root, { hidden: true })), ['/.obsidian', '.env', 'a.md'],
    '.git and node_modules stay out even with hidden files shown');
});

test('entries carry their kind and their path from the root', async t => {
  const root = await makeFolder({ 'docs/guide.md': '', 'docs/logo.png': '', 'docs/conf.yml': '' });
  t.after(() => removeFolder(root));

  assert.deepEqual(await listDir(root, path.join(root, 'docs')), [
    { name: 'conf.yml', path: 'docs/conf.yml', type: 'file', kind: 'file' },
    { name: 'guide.md', path: 'docs/guide.md', type: 'file', kind: 'markdown' },
    { name: 'logo.png', path: 'docs/logo.png', type: 'file', kind: 'image' }
  ]);
});

test('a symlink that leads out of the folder is not listed', async t => {
  // Listing what inkd would then refuse to open is a trap.
  const outside = await makeFolder({ 'x.md': '' });
  const root = await makeFolder({ 'a.md': '', 'real/b.md': '' });
  t.after(async () => { await removeFolder(root); await removeFolder(outside); });
  await fs.symlink(outside, path.join(root, 'away'));
  await fs.symlink(path.join(outside, 'x.md'), path.join(root, 'x.md'));
  await fs.symlink(path.join(root, 'real'), path.join(root, 'alias'));
  await fs.symlink(path.join(root, 'gone.md'), path.join(root, 'dangling.md'));

  assert.deepEqual(names(await listDir(root, root)), ['/alias', '/real', 'a.md'],
    'links out and dangling links are gone; a link within stays');
});

test('the walk finds every file below, and skips what the listing skips', async t => {
  const root = await makeFolder({ 'a.md': '', 'd/e/f.md': '', '.hidden/h.md': '', '.git/x': '', 'node_modules/m/r.md': '' });
  t.after(() => removeFolder(root));

  const { files, truncated } = await walkFiles(root);
  assert.deepEqual(files.map(f => f.path), ['a.md', 'd/e/f.md']);
  assert.equal(truncated, false);
  assert.deepEqual((await walkFiles(root, { hidden: true })).files.map(f => f.path), ['.hidden/h.md', 'a.md', 'd/e/f.md']);
});

test('the walk stops at its limit and says so', async t => {
  const files = {};
  for (let i = 0; i < 12; i++) files[`n${i}.md`] = '';
  const root = await makeFolder(files);
  t.after(() => removeFolder(root));

  const result = await walkFiles(root, { limit: 5 });
  assert.equal(result.files.length, 5);
  assert.equal(result.truncated, true);
});

test('the walk does not follow symlinked folders, so a loop cannot hang it', async t => {
  const root = await makeFolder({ 'a/b.md': '' });
  t.after(() => removeFolder(root));
  await fs.symlink(root, path.join(root, 'a', 'loop'));

  const { files } = await walkFiles(root);
  assert.deepEqual(files.map(f => f.path), ['a/b.md']);
});
