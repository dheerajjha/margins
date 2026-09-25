'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { findBacklinks, searchFiles } = require('../lib/search');
const { walkFiles } = require('../lib/tree');
const { makeFolder, removeFolder } = require('./helpers/fixture');

async function filesOf(root) {
  return (await walkFiles(root)).files;
}

test('search is case-insensitive and says where each match is', async t => {
  const root = await makeFolder({ 'a.md': '# Title\nThe Indexer restarts.\n', 'b.txt': 'no match\nindexer here\n' });
  t.after(() => removeFolder(root));

  const { results, truncated } = await searchFiles(root, await filesOf(root), 'INDEXER');
  assert.deepEqual(results.map(r => `${r.path}:${r.line}:${r.start}`), ['a.md:2:4', 'b.txt:2:0']);
  assert.equal(truncated, false);
  assert.equal(results[0].text.slice(results[0].start, results[0].start + results[0].length), 'Indexer');
});

test('search skips binaries and images, and reads markdown first', async t => {
  const root = await makeFolder({
    'z.md': 'needle\n', 'a.txt': 'needle\n', 'b.bin': Buffer.from('needle\0'), 'p.png': 'needle'
  });
  t.after(() => removeFolder(root));

  const { results, filesSearched } = await searchFiles(root, await filesOf(root), 'needle');
  assert.deepEqual(results.map(r => r.path), ['z.md', 'a.txt']);
  assert.equal(filesSearched, 2);
});

test('search stops at its limit and says it did', async t => {
  const root = await makeFolder({ 'a.md': 'x\n'.repeat(50) });
  t.after(() => removeFolder(root));
  const { results, truncated } = await searchFiles(root, await filesOf(root), 'x', { limit: 10 });
  assert.equal(results.length, 10);
  assert.equal(truncated, true);
});

test('a very long line is cut down around the match', async t => {
  const root = await makeFolder({ 'a.md': 'x'.repeat(3000) + ' needle ' + 'y'.repeat(3000) });
  t.after(() => removeFolder(root));
  const [hit] = (await searchFiles(root, await filesOf(root), 'needle')).results;

  assert.ok(hit.text.length < 300);
  assert.equal(hit.text.slice(hit.start, hit.start + hit.length), 'needle');
});

test('backlinks come from relative links and from wikilinks', async t => {
  const root = await makeFolder({
    'notes/target.md': '# Target',
    'README.md': 'See [the target](notes/target.md).',
    'notes/sibling.md': 'Back to [[target]].',
    'deep/a.md': 'Up to [x](../notes/target.md#section).',
    'unrelated.md': 'Nothing here.'
  });
  t.after(() => removeFolder(root));

  const backlinks = await findBacklinks(root, await filesOf(root), 'notes/target.md');
  assert.deepEqual(backlinks.map(b => `${b.path}:${b.line}`).sort(), ['README.md:1', 'deep/a.md:1', 'notes/sibling.md:1']);
});

test('backlinks ignore links written inside code, a file linking to itself, and repeats on a line', async t => {
  const root = await makeFolder({
    'target.md': 'I am [[target]] myself.',
    'docs.md': 'Real [[target]] and again [[target]].\n\n```\n[[target]]\n```\nAnd `[[target]]`.'
  });
  t.after(() => removeFolder(root));

  const backlinks = await findBacklinks(root, await filesOf(root), 'target.md');
  assert.deepEqual(backlinks.map(b => `${b.path}:${b.line}`), ['docs.md:1']);
});
