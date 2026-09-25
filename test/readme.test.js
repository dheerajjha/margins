'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The README states the test count in two places, by hand. This keeps both
 * honest -- a badge is a claim, and a stale one is a small lie on the front
 * page. Counted as `test(` declarations, not what `node --test` prints: that
 * one is higher, because it also counts test/helpers/fixture.js as a file.
 */

const TEST_DIR = __dirname;
const README = fs.readFileSync(path.join(TEST_DIR, '..', 'README.md'), 'utf-8');

function declaredTests() {
  return fs.readdirSync(TEST_DIR)
    .filter(name => name.endsWith('.test.js'))
    .reduce((sum, name) => sum + (fs.readFileSync(path.join(TEST_DIR, name), 'utf-8').match(/^test\(/gm) || []).length, 0);
}

test('every test count in the README matches the suite', () => {
  const declared = declaredTests();
  for (const [what, pattern] of [['the tests badge', /badge\/tests-(\d+)-/], ['the Development block', /npm test\s+#\s*(\d+) tests/]]) {
    const found = README.match(pattern);
    assert.ok(found, `README no longer states the count in ${what}`);
    assert.equal(Number(found[1]), declared, `README says ${found[1]} in ${what}; the suite declares ${declared}.`);
  }
});

test('the README names every option the command accepts', () => {
  const { USAGE } = require('../lib/cli');
  for (const option of USAGE.match(/--[a-z-]+/g)) {
    assert.ok(README.includes(option), `${option} is in --help but not the README`);
  }
});
