'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Reading files for the page, and writing them back without losing anyone's
 * work.
 */

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdx']);
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp'
};

// Past this a file is not opened as text. A notes folder has no 2 MB files;
// a repository has lockfiles and generated bundles, and drawing one of those
// into a textarea would freeze the tab to show nobody anything useful.
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

// How much of a file is looked at to decide whether it is text. Git uses the
// same test -- a NUL byte in the first 8000 -- and it is right often enough
// that a folder browser has no reason to be cleverer.
const SNIFF_BYTES = 8000;

class FileTooLargeError extends Error {
  constructor(size) {
    super(`This file is ${(size / 1024 / 1024).toFixed(1)} MB, too large to open as text here.`);
    this.name = 'FileTooLargeError';
    this.status = 413;
  }
}

class NotEditableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotEditableError';
    this.status = 400;
  }
}

/**
 * The file changed on disk since the page loaded it. Carries what is there
 * now, so the page can offer to show it rather than only refuse.
 */
class ConflictError extends Error {
  constructor(current) {
    super('This file changed on disk after you opened it. Your edit was not saved.');
    this.name = 'ConflictError';
    this.status = 409;
    this.current = current;
  }
}

/** 'markdown' | 'image' | 'file', from the name alone -- cheap enough for a listing. */
function kindOf(name) {
  const ext = path.extname(name).toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (IMAGE_TYPES[ext]) return 'image';
  return 'file';
}

function imageType(name) {
  return IMAGE_TYPES[path.extname(name).toLowerCase()] ?? null;
}

/**
 * A short fingerprint of a file's content, which is what "the version the
 * page has" means.
 *
 * Not the modification time. Two saves inside one millisecond, or a tool
 * that restores mtimes, would both look like "unchanged" to an mtime check
 * and lose an edit silently. A hash cannot be fooled that way, and for a
 * file small enough to edit in a browser it costs nothing.
 */
function versionOf(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function looksBinary(buffer) {
  return buffer.subarray(0, SNIFF_BYTES).includes(0);
}

/**
 * Everything the page needs to show one file.
 *
 * @param {string} abs an absolute path already confined to the root
 * @returns {Promise<{kind: string, size: number, content?: string, version?: string}>}
 */
async function readForView(abs) {
  const stat = await fs.stat(abs);
  // A link like [docs](docs/) names a folder. The page shows it the way
  // GitHub does -- its contents, then its README -- so this says what it is
  // rather than refusing.
  if (stat.isDirectory()) return { kind: 'folder', size: 0 };

  const kind = kindOf(abs);
  if (kind === 'image') return { kind, size: stat.size };
  if (stat.size > MAX_TEXT_BYTES) throw new FileTooLargeError(stat.size);

  const buffer = await fs.readFile(abs);
  if (looksBinary(buffer)) return { kind: 'binary', size: stat.size };

  return {
    kind: kind === 'markdown' ? 'markdown' : 'text',
    size: stat.size,
    content: buffer.toString('utf8'),
    version: versionOf(buffer)
  };
}

/**
 * Save over an existing file, if it is still the file the page loaded.
 *
 * @param {string} abs
 * @param {string} content
 * @param {string} expectedVersion what versionOf gave when the page opened it
 * @returns {Promise<{version: string}>}
 * @throws {ConflictError} when the file on disk is not that version any more
 */
async function writeChecked(abs, content, expectedVersion) {
  if (typeof content !== 'string') throw new NotEditableError('Content must be text.');
  if (Buffer.byteLength(content) > MAX_TEXT_BYTES) throw new FileTooLargeError(Buffer.byteLength(content));

  const stat = await fs.stat(abs);
  if (stat.isDirectory()) throw new NotEditableError('That is a folder.');
  if (kindOf(abs) === 'image') throw new NotEditableError('Images cannot be edited here.');

  const current = await fs.readFile(abs);
  if (looksBinary(current)) throw new NotEditableError('That file is not text.');

  // Between this read and the write below another program could still save;
  // that window is a few milliseconds and the alternative, locking files
  // other editors do not know about, is worse.
  if (versionOf(current) !== expectedVersion) {
    throw new ConflictError({ content: current.toString('utf8'), version: versionOf(current) });
  }

  // In place, not write-to-temp-and-rename. A rename replaces the file with
  // a new one: it drops hard links, resets permissions and ownership on some
  // systems, and breaks anything watching the old inode. An editor in a
  // browser has no business changing what kind of file this is.
  await fs.writeFile(abs, content, 'utf8');
  return { version: versionOf(Buffer.from(content, 'utf8')) };
}

/**
 * Create a file that does not exist yet, making folders on the way.
 *
 * @returns {Promise<{version: string}>}
 * @throws {ConflictError} when something is already there
 */
async function createNew(abs, content) {
  if (typeof content !== 'string') throw new NotEditableError('Content must be text.');

  await fs.mkdir(path.dirname(abs), { recursive: true });
  try {
    // 'wx': fail rather than overwrite. Checking for existence first and
    // then writing is the race this flag exists to close.
    await fs.writeFile(abs, content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') {
      const err = new ConflictError(null);
      err.message = 'A file with that name already exists.';
      throw err;
    }
    throw error;
  }
  return { version: versionOf(Buffer.from(content, 'utf8')) };
}

module.exports = {
  ConflictError,
  FileTooLargeError,
  MARKDOWN_EXTENSIONS,
  MAX_TEXT_BYTES,
  NotEditableError,
  createNew,
  imageType,
  kindOf,
  looksBinary,
  readForView,
  versionOf,
  writeChecked
};
