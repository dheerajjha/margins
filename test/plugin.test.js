'use strict';

// The agent-plugin manifests must agree with the package and with each other.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const MANIFESTS = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.cursor-plugin/plugin.json', '.github/plugin/plugin.json'];

test('every plugin manifest carries the package version and one name', () => {
  const { version } = json('package.json');
  for (const f of MANIFESTS) {
    const m = json(f);
    assert.equal(m.name, 'margins', f);
    assert.equal(m.version, version, f);
  }
  for (const p of json('.claude-plugin/marketplace.json').plugins) {
    assert.equal(p.name, 'margins');
    assert.equal(p.version, version);
    assert.equal(p.source, './');
  }
});

test('the read skill has the frontmatter agents need and only real flags', () => {
  const text = fs.readFileSync(path.join(root, 'skills', 'read', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(fm);
  assert.match(fm[1], /^name: read$/m);
  const desc = /^description: (.+)$/m.exec(fm[1]);
  assert.ok(desc && desc[1].length > 40 && desc[1].length <= 1024);
  const help = spawnSync(process.execPath, [path.join(root, 'bin', 'margins.js'), '--help'], { encoding: 'utf8' }).stdout;
  for (const flag of text.match(/--[a-z][a-z-]+/g) || []) assert.ok(help.includes(flag), `--help should list ${flag}`);
});
