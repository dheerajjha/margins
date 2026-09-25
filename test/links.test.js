'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  blankCode, buildIndex, extractLinks, isExternal, parseWikilink, resolveHref, resolveWikilink, slugify
} = require('../lib/links');

const found = markdown => extractLinks(markdown).map(link => `${link.type}:${link.target}@${link.line}`);

test('links, images, wikilinks, embeds and reference definitions are all found, with their lines', () => {
  const markdown = [
    '# Title',
    'See [the guide](guide.md#setup "Guide") and ![a pic](img/a.png).',
    'Also [[Ideas]], [[sub/Plan|the plan]] and ![[diagram.png]].',
    '[spaced](<my notes/a b.md>)',
    '[ref]: ../other.md'
  ].join('\n');

  assert.deepEqual(found(markdown), [
    'link:guide.md#setup@2', 'image:img/a.png@2',
    'wiki:Ideas@3', 'wiki:sub/Plan|the plan@3', 'embed:diagram.png@3',
    'link:my notes/a b.md@4',
    'link:../other.md@5'
  ]);
});

test('links inside code are examples, not links', () => {
  // A README that documents link syntax should not appear to link to
  // everything it mentions.
  const markdown = [
    'Real [[One]].',
    '```md',
    '[fake](fake.md) [[Fake]]',
    '```',
    '~~~',
    '[[AlsoFake]]',
    '~~~',
    'Inline `[[Nope]]` and ``[x](nope.md)`` but [[Two]].'
  ].join('\n');

  assert.deepEqual(found(markdown), ['wiki:One@1', 'wiki:Two@8']);
});

test('blanking code keeps every line and column where it was', () => {
  const markdown = 'a `code` b\n```\nx\n```';
  const blanked = blankCode(markdown);
  assert.equal(blanked.length, markdown.length);
  assert.equal(blanked.split('\n').length, 4);
  assert.equal(blanked.split('\n')[0], 'a        b');
});

test('a wikilink splits into its target, heading and alias', () => {
  assert.deepEqual(parseWikilink('Note'), { target: 'Note', heading: null, alias: null });
  assert.deepEqual(parseWikilink('Note#Setup|read this'), { target: 'Note', heading: 'Setup', alias: 'read this' });
  assert.deepEqual(parseWikilink('#Local heading'), { target: '', heading: 'Local heading', alias: null });
});

test('a relative href resolves from the linking file, as GitHub follows it', () => {
  assert.deepEqual(resolveHref('notes/a.md', 'b.md'), { path: 'notes/b.md', fragment: null });
  assert.deepEqual(resolveHref('notes/a.md', '../README.md#install'), { path: 'README.md', fragment: 'install' });
  assert.deepEqual(resolveHref('notes/a.md', '/docs/x.md'), { path: 'docs/x.md', fragment: null }, 'a leading / is the root');
  assert.deepEqual(resolveHref('notes/a.md', '#here'), { path: 'notes/a.md', fragment: 'here' });
  assert.deepEqual(resolveHref('a.md', 'my%20notes/b%20c.md?x=1'), { path: 'my notes/b c.md', fragment: null });
});

test('an href that is external, empty, or climbs out of the folder resolves to nothing', () => {
  assert.equal(resolveHref('a.md', 'https://example.com/x.md'), null);
  assert.equal(resolveHref('a.md', 'mailto:someone@example.com'), null);
  assert.equal(resolveHref('a.md', '//cdn.example.com/x'), null);
  assert.equal(resolveHref('a.md', ''), null);
  assert.equal(resolveHref('notes/a.md', '../../etc/passwd'), null);
  assert.equal(isExternal('javascript:alert(1)'), true, 'a scheme is external, whatever it is');
});

test('a wikilink means a file by name, the way Obsidian decides', () => {
  const index = buildIndex(['Ideas.md', 'notes/Ideas.md', 'deep/er/Ideas.md', 'sub/Plan.md', 'img/diagram.png', 'Zeta.md']);

  assert.equal(resolveWikilink('Ideas', 'notes/x.md', index), 'notes/Ideas.md', 'the linking file\'s own folder first');
  assert.equal(resolveWikilink('Ideas', 'root.md', index), 'Ideas.md');
  assert.equal(resolveWikilink('Ideas', 'sub/y.md', index), 'Ideas.md', 'then the shallowest');
  assert.equal(resolveWikilink('ideas', 'root.md', index), 'Ideas.md', 'names are case-insensitive');
  assert.equal(resolveWikilink('sub/Plan', 'x.md', index), 'sub/Plan.md', 'a path narrows it');
  assert.equal(resolveWikilink('Plan.md', 'x.md', index), 'sub/Plan.md', 'with its extension too');
  assert.equal(resolveWikilink('diagram.png', 'x.md', index), 'img/diagram.png', 'any file answers to its full name');
  assert.equal(resolveWikilink('Missing', 'x.md', index), null);
});

test('the same ambiguous wikilink always resolves the same way', () => {
  // Not whichever file the disk listed first: shallowest, then alphabetical.
  const a = buildIndex(['b/Note.md', 'a/Note.md']);
  const b = buildIndex(['a/Note.md', 'b/Note.md']);
  assert.equal(resolveWikilink('Note', 'x.md', a), 'a/Note.md');
  assert.equal(resolveWikilink('Note', 'x.md', b), 'a/Note.md');
});

test('heading anchors match GitHub\'s, so README.md#installation lands in the same place', () => {
  assert.equal(slugify('Getting Started'), 'getting-started');
  assert.equal(slugify('What\'s new in 2.0?'), 'whats-new-in-20');
  assert.equal(slugify('  API: reference  '), 'api-reference');
  assert.equal(slugify('Café & crème'), 'café--crème');
});
