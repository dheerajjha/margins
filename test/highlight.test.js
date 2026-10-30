'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf-8');

test('the Markdown extension renders highlights and preserves inline parsing', async () => {
  // marked 18 is ESM-only; require() of it fails on Node 18, so load it with import().
  const { marked } = await import('marked');
  const matcher = APP_JS.match(/function highlightMatch\([^)]*\) \{[\s\S]*?\n\}/);
  const extension = APP_JS.match(/var highlightExtension = \{[\s\S]*?\n\};/);
  assert.ok(matcher, 'app.js defines the highlight matcher');
  assert.ok(extension, 'app.js registers a highlight extension');
  const markdown = vm.createContext({ marked });
  vm.runInContext(matcher[0] + '\n' + extension[0] + '\nmarked.use({ gfm: true, extensions: [highlightExtension] });', markdown);
  const render = source => vm.runInContext(`marked.parse(${JSON.stringify(source)})`, markdown);
  assert.equal(render('Some ==important== text.').trim(), '<p>Some <mark>important</mark> text.</p>');
  assert.equal(render('==**bold** and *emphasis*==').trim(), '<p><mark><strong>bold</strong> and <em>emphasis</em></mark></p>');
  assert.equal(render('`==x==`').trim(), '<p><code>==x==</code></p>');
});
