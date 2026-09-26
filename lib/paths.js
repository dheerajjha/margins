'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Keeping every file margins touches inside the folder it was opened on.
 *
 * margins writes files, and people open folders they did not write -- a
 * cloned repository, a colleague's notes. So a path from the page is never
 * trusted as a path. It is a list of names below the root, each checked, and
 * the result is checked again after symlinks are followed, because a link
 * inside the folder can point anywhere on the disk.
 */

/** A request for something outside the root, or somewhere margins will not go. */
class ForbiddenPathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ForbiddenPathError';
    this.status = 403;
  }
}

/** A path inside the root that names nothing. */
class NotFoundError extends Error {
  constructor(rel) {
    super(`Nothing at ${rel || 'the root'}`);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}

// Folders that are never listed, searched or written. `.git` is not merely
// noise: writing `.git/hooks/pre-commit` is running code the next time the
// user commits, and a page that can write files must not be able to reach it.
const PROTECTED_DIRS = new Set(['.git', 'node_modules']);

/** Whether `candidate` is `root` or somewhere below it. */
function isInside(root, candidate) {
  const rel = path.relative(root, candidate);
  if (rel === '') return true;
  // A folder may legitimately be called "..notes"; only a leading ".." path
  // segment means "above the root".
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * The names in a page-supplied relative path, or a ForbiddenPathError.
 *
 * Paths from the page are always forward-slash separated and relative to the
 * root. Anything that could climb out -- `..`, an absolute path, a NUL byte,
 * a backslash that Windows would read as a separator -- is refused rather
 * than normalised away, because normalising is how "a/../../etc" becomes
 * a path that looked fine.
 *
 * @param {unknown} rel
 * @returns {string[]}
 */
function segmentsOf(rel) {
  if (typeof rel !== 'string') throw new ForbiddenPathError('A path must be a string.');
  if (rel.includes('\0')) throw new ForbiddenPathError('A path cannot contain a NUL byte.');
  if (rel.includes('\\')) throw new ForbiddenPathError('Use forward slashes in paths.');
  if (rel.startsWith('/')) throw new ForbiddenPathError('Paths are relative to the folder margins opened.');

  const segments = rel.split('/').filter(segment => segment !== '' && segment !== '.');
  for (const segment of segments) {
    if (segment === '..') throw new ForbiddenPathError('Paths cannot climb out of the folder.');
    if (PROTECTED_DIRS.has(segment)) {
      throw new ForbiddenPathError(`margins does not open anything inside ${segment}/.`);
    }
  }
  return segments;
}

/** Normalise a page-supplied path to the canonical form used everywhere else. */
function normaliseRel(rel) {
  return segmentsOf(rel).join('/');
}

/**
 * The real, absolute path of something that exists inside the root.
 *
 * @param {string} realRoot the root, already through fs.realpath
 * @param {string} rel
 * @returns {Promise<string>}
 * @throws {ForbiddenPathError|NotFoundError}
 */
async function resolveExisting(realRoot, rel) {
  const segments = segmentsOf(rel);
  const target = path.join(realRoot, ...segments);

  let real;
  try {
    real = await fs.realpath(target);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new NotFoundError(segments.join('/'));
    throw error;
  }

  // The check that matters. `target` was inside by construction; `real` is
  // where it actually is once symlinks are followed.
  if (!isInside(realRoot, real)) {
    throw new ForbiddenPathError('That path leads outside the folder through a symlink.');
  }
  return real;
}

/**
 * The absolute path a new file would be created at, inside the root.
 *
 * The file does not exist yet, so its own realpath cannot be checked. Its
 * nearest existing ancestor can, and must be inside the root: otherwise a
 * symlinked folder inside the root is a way to create files anywhere.
 *
 * @param {string} realRoot
 * @param {string} rel
 * @returns {Promise<string>}
 */
async function resolveNew(realRoot, rel) {
  const segments = segmentsOf(rel);
  if (segments.length === 0) throw new ForbiddenPathError('A new file needs a name.');

  const target = path.join(realRoot, ...segments);
  let probe = path.dirname(target);
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      if (!isInside(realRoot, real)) {
        throw new ForbiddenPathError('That path leads outside the folder through a symlink.');
      }
      break;
    } catch (error) {
      if (error instanceof ForbiddenPathError) throw error;
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(probe);
      if (parent === probe) throw new ForbiddenPathError('No existing folder above that path.');
      probe = parent;
    }
  }
  return target;
}

/** The forward-slash path of `abs` relative to the root, as the page names it. */
function toRel(realRoot, abs) {
  return path.relative(realRoot, abs).split(path.sep).join('/');
}

module.exports = {
  ForbiddenPathError,
  NotFoundError,
  PROTECTED_DIRS,
  isInside,
  normaliseRel,
  resolveExisting,
  resolveNew,
  segmentsOf,
  toRel
};
