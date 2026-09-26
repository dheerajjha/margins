'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { PROTECTED_DIRS, isInside, toRel } = require('./paths');
const { kindOf } = require('./files');

/**
 * What a folder contains, for the sidebar, and every file below it, for
 * quick open, search and backlinks.
 */

// A folder of notes has hundreds of files; a repository opened by accident
// can have hundreds of thousands. Past this, walking stops and says so,
// rather than making the page wait on a scan of someone's home directory.
const WALK_LIMIT = 20000;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Whether a name is hidden from listings unless hidden files were asked for. */
function isHiddenName(name) {
  return name.startsWith('.');
}

/**
 * Resolve a directory entry to what it really is, following one symlink and
 * dropping anything that leads outside the root -- a sidebar should not list
 * what margins would then refuse to open.
 *
 * @returns {Promise<'dir'|'file'|null>}
 */
async function entryType(realRoot, abs, dirent) {
  if (dirent.isDirectory()) return 'dir';
  if (dirent.isFile()) return 'file';
  if (!dirent.isSymbolicLink()) return null;

  try {
    const real = await fs.realpath(abs);
    if (!isInside(realRoot, real)) return null;
    const stat = await fs.stat(real);
    return stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : null;
  } catch {
    return null; // a dangling link
  }
}

/**
 * The entries of one folder: folders first, then files, each in the order a
 * person sorts them -- "note 2" before "note 10".
 *
 * @param {string} realRoot
 * @param {string} absDir already confined to the root
 * @param {{hidden?: boolean}} [options]
 */
async function listDir(realRoot, absDir, { hidden = false } = {}) {
  const dirents = await fs.readdir(absDir, { withFileTypes: true });
  const entries = [];

  for (const dirent of dirents) {
    if (PROTECTED_DIRS.has(dirent.name)) continue;
    if (!hidden && isHiddenName(dirent.name)) continue;

    const abs = path.join(absDir, dirent.name);
    const type = await entryType(realRoot, abs, dirent);
    if (!type) continue;

    entries.push({
      name: dirent.name,
      path: toRel(realRoot, abs),
      type,
      ...(type === 'file' ? { kind: kindOf(dirent.name) } : {})
    });
  }

  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}

/**
 * Every file below the root, depth first, skipping protected and (unless
 * asked) hidden folders.
 *
 * Symlinked folders are not followed. A link back up the tree is a loop, and
 * a link sideways into a large tree is a surprise; the sidebar still shows
 * them, and opening one lists it on demand.
 *
 * @param {string} realRoot
 * @param {{hidden?: boolean, limit?: number}} [options]
 * @returns {Promise<{files: {path: string, kind: string}[], truncated: boolean}>}
 */
async function walkFiles(realRoot, { hidden = false, limit = WALK_LIMIT } = {}) {
  const files = [];
  const pending = [realRoot];

  while (pending.length > 0) {
    const dir = pending.pop();
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable: skip it, do not fail the whole walk
    }

    dirents.sort((a, b) => collator.compare(a.name, b.name));
    for (const dirent of dirents) {
      if (PROTECTED_DIRS.has(dirent.name)) continue;
      if (!hidden && isHiddenName(dirent.name)) continue;

      const abs = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        pending.push(abs);
      } else if (dirent.isFile()) {
        files.push({ path: toRel(realRoot, abs), kind: kindOf(dirent.name) });
        if (files.length >= limit) return { files, truncated: true };
      }
    }
  }

  files.sort((a, b) => collator.compare(a.path, b.path));
  return { files, truncated: false };
}

module.exports = { WALK_LIMIT, isHiddenName, listDir, walkFiles };
