'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  ForbiddenPathError, NotFoundError, isInside, normaliseRel, resolveExisting, resolveNew, segmentsOf, toRel
} = require('../lib/paths');
const { makeFolder, removeFolder } = require('./helpers/fixture');

// --- what a path from the page may say ------------------------------------------

test('a path from the page is a list of names below the root', () => {
  assert.deepEqual(segmentsOf('notes/a.md'), ['notes', 'a.md']);
  assert.deepEqual(segmentsOf(''), []);
  assert.deepEqual(segmentsOf('./notes//a.md'), ['notes', 'a.md'], 'empty and "." segments are dropped');
  assert.equal(normaliseRel('notes/./a.md'), 'notes/a.md');
});

test('anything that could climb out is refused, not normalised', () => {
  // Normalising "a/../../x" is how a path that looked fine ends up above the
  // root, so ".." is refused wherever it appears.
  for (const bad of ['../x', 'notes/../../x', 'notes/..', '..']) {
    assert.throws(() => segmentsOf(bad), ForbiddenPathError, bad);
  }
});

test('absolute paths, backslashes and NUL bytes are refused', () => {
  assert.throws(() => segmentsOf('/etc/passwd'), ForbiddenPathError);
  assert.throws(() => segmentsOf('notes\\..\\x'), ForbiddenPathError, 'a separator on Windows');
  assert.throws(() => segmentsOf('a.md\0.txt'), ForbiddenPathError);
  assert.throws(() => segmentsOf(42), ForbiddenPathError);
});

test('.git and node_modules are never opened, anywhere in the path', () => {
  // Writing .git/hooks/pre-commit is running code on the next commit.
  assert.throws(() => segmentsOf('.git/hooks/pre-commit'), /inside \.git/);
  assert.throws(() => segmentsOf('pkg/node_modules/x/README.md'), /inside node_modules/);
});

test('a folder whose name merely starts with two dots is inside the root', () => {
  assert.equal(isInside('/r', '/r/..notes/a.md'), true);
  assert.equal(isInside('/r', '/r'), true);
  assert.equal(isInside('/r', '/other'), false);
  assert.equal(isInside('/r', '/r2/a'), false, 'a sibling that shares a prefix is not inside');
});

// --- symlinks -----------------------------------------------------------------

test('a symlink inside the folder that points outside it is refused', async t => {
  const outside = await makeFolder({ 'secret.md': 'secret' });
  const root = await makeFolder({ 'a.md': 'a' });
  t.after(async () => { await removeFolder(root); await removeFolder(outside); });

  await fs.symlink(outside, path.join(root, 'away'));
  await fs.symlink(path.join(outside, 'secret.md'), path.join(root, 'secret.md'));

  await assert.rejects(resolveExisting(root, 'away/secret.md'), /outside the folder through a symlink/);
  await assert.rejects(resolveExisting(root, 'secret.md'), /outside the folder through a symlink/);
});

test('a symlink that stays inside the folder is followed', async t => {
  const root = await makeFolder({ 'real/a.md': 'a' });
  t.after(() => removeFolder(root));
  await fs.symlink(path.join(root, 'real'), path.join(root, 'alias'));

  assert.equal(await resolveExisting(root, 'alias/a.md'), path.join(root, 'real', 'a.md'));
});

test('something that does not exist is a 404, not a 403', async t => {
  const root = await makeFolder({});
  t.after(() => removeFolder(root));
  await assert.rejects(resolveExisting(root, 'nope.md'), NotFoundError);
});

test('a new file cannot be created through a symlinked folder that leads out', async t => {
  // The new file has no realpath yet, so its nearest existing ancestor is
  // what gets checked -- otherwise a symlinked folder is a way to create
  // files anywhere on the disk.
  const outside = await makeFolder({});
  const root = await makeFolder({});
  t.after(async () => { await removeFolder(root); await removeFolder(outside); });
  await fs.symlink(outside, path.join(root, 'away'));

  await assert.rejects(resolveNew(root, 'away/new.md'), /outside the folder through a symlink/);
  await assert.rejects(resolveNew(root, 'away/deeper/new.md'), /outside the folder through a symlink/);
  assert.equal(await resolveNew(root, 'fresh/dir/new.md'), path.join(root, 'fresh', 'dir', 'new.md'));
});

test('paths come back forward-slashed, relative to the root', () => {
  assert.equal(toRel('/r', path.join('/r', 'a', 'b.md')), 'a/b.md');
  assert.equal(toRel(os.tmpdir(), os.tmpdir()), '');
});
