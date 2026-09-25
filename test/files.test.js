'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  ConflictError, FileTooLargeError, MAX_TEXT_BYTES, NotEditableError, createNew, kindOf, readForView, versionOf, writeChecked
} = require('../lib/files');
const { makeFolder, removeFolder } = require('./helpers/fixture');

test('kinds come from the name, for listings that do not open every file', () => {
  assert.equal(kindOf('a.md'), 'markdown');
  assert.equal(kindOf('A.MARKDOWN'), 'markdown');
  assert.equal(kindOf('x.mdx'), 'markdown');
  assert.equal(kindOf('logo.PNG'), 'image');
  assert.equal(kindOf('diagram.svg'), 'image');
  assert.equal(kindOf('service.yaml'), 'file');
});

test('a markdown file is read with a version to save against', async t => {
  const root = await makeFolder({ 'a.md': '# A\n' });
  t.after(() => removeFolder(root));
  const view = await readForView(path.join(root, 'a.md'));

  assert.equal(view.kind, 'markdown');
  assert.equal(view.content, '# A\n');
  assert.equal(view.version, versionOf(Buffer.from('# A\n')));
});

test('other text is text; a NUL byte makes it binary', async t => {
  const root = await makeFolder({ 'a.yaml': 'x: 1\n', 'b.bin': Buffer.from([0x50, 0, 0x51]) });
  t.after(() => removeFolder(root));

  assert.equal((await readForView(path.join(root, 'a.yaml'))).kind, 'text');
  const binary = await readForView(path.join(root, 'b.bin'));
  assert.equal(binary.kind, 'binary');
  assert.equal('content' in binary, false, 'binary content is never sent to the page');
});

test('an image is described, not read -- the page loads it from /raw', async t => {
  const root = await makeFolder({ 'p.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  t.after(() => removeFolder(root));
  assert.deepEqual(await readForView(path.join(root, 'p.png')), { kind: 'image', size: 4 });
});

test('a folder says it is one', async t => {
  const root = await makeFolder({ 'docs/a.md': 'a' });
  t.after(() => removeFolder(root));
  assert.deepEqual(await readForView(path.join(root, 'docs')), { kind: 'folder', size: 0 });
});

test('a file too large to edit in a browser is refused as text', async t => {
  const root = await makeFolder({ 'big.md': Buffer.alloc(MAX_TEXT_BYTES + 1, 0x61) });
  t.after(() => removeFolder(root));
  await assert.rejects(readForView(path.join(root, 'big.md')), FileTooLargeError);
});

// --- saving ---------------------------------------------------------------------

test('saving the version that was read writes the file', async t => {
  const root = await makeFolder({ 'a.md': 'old\n' });
  t.after(() => removeFolder(root));
  const abs = path.join(root, 'a.md');
  const { version } = await readForView(abs);

  const saved = await writeChecked(abs, 'new\n', version);
  assert.equal(await fs.readFile(abs, 'utf8'), 'new\n');
  assert.equal(saved.version, versionOf(Buffer.from('new\n')));
});

test('saving over a file that changed since it was read writes nothing', async t => {
  // The hash, not the mtime: this test changes the file within the same
  // millisecond it was read, which an mtime check could miss.
  const root = await makeFolder({ 'a.md': 'mine\n' });
  t.after(() => removeFolder(root));
  const abs = path.join(root, 'a.md');
  const { version } = await readForView(abs);
  await fs.writeFile(abs, 'theirs\n');

  await assert.rejects(writeChecked(abs, 'mine, edited\n', version), error => {
    assert.ok(error instanceof ConflictError);
    assert.equal(error.status, 409);
    assert.deepEqual(error.current, { content: 'theirs\n', version: versionOf(Buffer.from('theirs\n')) });
    return true;
  });
  assert.equal(await fs.readFile(abs, 'utf8'), 'theirs\n', 'their change is still there');
});

test('saving writes in place, so hard links and permissions survive', async t => {
  const root = await makeFolder({ 'a.md': 'a\n' });
  t.after(() => removeFolder(root));
  const abs = path.join(root, 'a.md');
  await fs.chmod(abs, 0o640);
  await fs.link(abs, path.join(root, 'linked.md'));
  const before = await fs.stat(abs);

  await writeChecked(abs, 'b\n', (await readForView(abs)).version);
  const after = await fs.stat(abs);

  assert.equal(after.ino, before.ino, 'the same file, not a replacement');
  assert.equal(after.mode & 0o777, 0o640);
  assert.equal(await fs.readFile(path.join(root, 'linked.md'), 'utf8'), 'b\n');
});

test('images, binaries and folders cannot be saved over', async t => {
  const root = await makeFolder({ 'p.png': 'x', 'b.bin': Buffer.from([1, 0, 2]), 'd/a.md': 'a' });
  t.after(() => removeFolder(root));
  await assert.rejects(writeChecked(path.join(root, 'p.png'), 'x', versionOf(Buffer.from('x'))), NotEditableError);
  await assert.rejects(writeChecked(path.join(root, 'b.bin'), 'x', 'v'), NotEditableError);
  await assert.rejects(writeChecked(path.join(root, 'd'), 'x', 'v'), NotEditableError);
});

test('a new file is created, with any folders it needs', async t => {
  const root = await makeFolder({});
  t.after(() => removeFolder(root));
  await createNew(path.join(root, 'a', 'b', 'note.md'), '# Note\n');
  assert.equal(await fs.readFile(path.join(root, 'a', 'b', 'note.md'), 'utf8'), '# Note\n');
});

test('creating never overwrites', async t => {
  const root = await makeFolder({ 'note.md': 'keep me' });
  t.after(() => removeFolder(root));
  await assert.rejects(createNew(path.join(root, 'note.md'), 'replaced'), /already exists/);
  assert.equal(await fs.readFile(path.join(root, 'note.md'), 'utf8'), 'keep me');
});
