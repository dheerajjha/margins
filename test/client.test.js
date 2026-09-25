'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * The page's pure logic, lifted out of public/app.js the way reviewer tests
 * its client code: the page has no module system, and these functions touch
 * nothing but their arguments -- and InkdLinks, which is given to them.
 */

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf-8');
const context = vm.createContext({ InkdLinks: require('../lib/links') });

for (const name of ['encodePath', 'hrefFor', 'rawUrl', 'parseRoute', 'fuzzyScore', 'rankFiles', 'shortcutFor', 'uniqueSlug']) {
  const match = APP_JS.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`Could not find ${name} in app.js`);
  vm.runInContext(match[0], context);
}
const fn = name => vm.runInContext(name, context);
// Values made in the vm carry its own prototypes; compare them as plain data.
const plain = value => JSON.parse(JSON.stringify(value));

test('an address names a file and a heading, with spaces and all', () => {
  const hrefFor = fn('hrefFor');
  const parseRoute = fn('parseRoute');
  const href = hrefFor('my notes/a b.md', 'the setup');
  assert.equal(href, '#/my%20notes/a%20b.md#the%20setup');
  assert.deepEqual(plain(parseRoute(href)), { path: 'my notes/a b.md', fragment: 'the setup' });
  assert.deepEqual(plain(parseRoute('#/docs')), { path: 'docs', fragment: null });
  assert.deepEqual(plain(parseRoute('#/')), { path: '', fragment: null }, 'the root');
  assert.deepEqual(plain(parseRoute('')), { path: null, fragment: null }, 'no address at all');
});

test('a path segment with a # or ? in its name survives the round trip', () => {
  const route = fn('parseRoute')(fn('hrefFor')('C# notes/what?.md'));
  assert.equal(route.path, 'C# notes/what?.md');
});

test('images are fetched from /raw with every segment encoded', () => {
  assert.equal(fn('rawUrl')('assets/a b#1.png'), 'raw/assets/a%20b%231.png');
});

test('open-a-file matches letters in order, and prefers what people mean', () => {
  const rankFiles = fn('rankFiles');
  const paths = ['archive/old/setup.md', 'guide/setup.md', 'notes/guest-list.md', 'README.md'];

  assert.equal(fn('fuzzyScore')('xyz', 'README.md'), null, 'every letter must appear');
  assert.deepEqual(plain(rankFiles('gset', paths)), ['guide/setup.md'], 'only a path containing g…s…e…t matches');
  assert.equal(rankFiles('setup', paths)[0], 'guide/setup.md', 'the shorter path wins a tie');
  assert.equal(rankFiles('readme', paths)[0], 'README.md', 'case does not matter');
  assert.equal(rankFiles('', paths).length, paths.length);
});

test('keys are shortcuts only when nothing is being typed', () => {
  const shortcutFor = fn('shortcutFor');
  assert.equal(shortcutFor('e', {}, 'DIV'), 'edit');
  assert.equal(shortcutFor('?', {}, 'DIV'), 'help');
  assert.equal(shortcutFor('[', {}, 'BODY'), 'back');
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(shortcutFor('e', {}, tag), null, `typing e in a ${tag}`);
  }
});

test('the modifier shortcuts work everywhere, including the editor', () => {
  const shortcutFor = fn('shortcutFor');
  assert.equal(shortcutFor('s', { ctrl: true }, 'TEXTAREA'), 'save');
  assert.equal(shortcutFor('s', { meta: true }, 'TEXTAREA'), 'save');
  assert.equal(shortcutFor('p', { ctrl: true }, 'INPUT'), 'quickOpen');
  assert.equal(shortcutFor('F', { meta: true, shift: true }, 'DIV'), 'search');
  assert.equal(shortcutFor('Escape', {}, 'TEXTAREA'), 'escape');
  assert.equal(shortcutFor('p', { ctrl: true, alt: true }, 'DIV'), null, 'not with alt as well');
  assert.equal(shortcutFor('e', { ctrl: true }, 'DIV'), null, 'ctrl+e belongs to the browser');
});

test('headings get anchors that stay unique within a document', () => {
  const uniqueSlug = fn('uniqueSlug');
  const used = new Set();
  assert.equal(uniqueSlug('Notes', used), 'notes');
  assert.equal(uniqueSlug('Notes', used), 'notes-1');
  assert.equal(uniqueSlug('Notes', used), 'notes-2');
  assert.equal(uniqueSlug('!!!', used), 'section', 'a heading of only punctuation still gets one');
});
