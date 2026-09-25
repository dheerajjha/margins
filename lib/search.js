'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { MAX_TEXT_BYTES, looksBinary } = require('./files');
const { buildIndex, extractLinks, isMarkdownPath, resolveHref, resolveWikilink } = require('./links');

/**
 * Finding text across the folder, and finding what links to a file.
 *
 * Both read every file they look at, every time. There is no index on disk:
 * inkd writes nothing into the folder but what you save, and a folder of
 * notes is small enough that reading it is faster than keeping a cache
 * honest.
 */

const SEARCH_LIMIT = 200;
const LINE_PREVIEW = 240;

async function readText(abs) {
  try {
    const stat = await fs.stat(abs);
    if (stat.size > MAX_TEXT_BYTES) return null;
    const buffer = await fs.readFile(abs);
    return looksBinary(buffer) ? null : buffer.toString('utf8');
  } catch {
    return null;
  }
}

/** A line cut down around a match, so a 5,000-character line does not fill the panel. */
function preview(line, column, length) {
  if (line.length <= LINE_PREVIEW) return { text: line, start: column };
  const from = Math.max(0, column - 60);
  const text = (from > 0 ? '…' : '') + line.slice(from, from + LINE_PREVIEW) + '…';
  return { text, start: column - from + (from > 0 ? 1 : 0) };
}

/**
 * Case-insensitive search for a phrase across every text file.
 *
 * @param {string} realRoot
 * @param {{path: string}[]} files from walkFiles
 * @param {string} query
 * @returns {Promise<{results: object[], truncated: boolean, filesSearched: number}>}
 */
async function searchFiles(realRoot, files, query, { limit = SEARCH_LIMIT } = {}) {
  const needle = query.toLowerCase();
  const results = [];
  let filesSearched = 0;

  // Markdown first: in a mixed folder the notes are what someone searching
  // is looking for, and a cap reached halfway through a lockfile would hide
  // them.
  const ordered = [...files].sort((a, b) => (isMarkdownPath(b.path) ? 1 : 0) - (isMarkdownPath(a.path) ? 1 : 0));

  for (const file of ordered) {
    if (file.kind === 'image') continue;
    const content = await readText(path.join(realRoot, ...file.path.split('/')));
    if (content === null) continue;
    filesSearched += 1;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const column = lines[i].toLowerCase().indexOf(needle);
      if (column === -1) continue;

      const shown = preview(lines[i], column, needle.length);
      results.push({ path: file.path, line: i + 1, text: shown.text, start: shown.start, length: needle.length });
      if (results.length >= limit) return { results, truncated: true, filesSearched };
    }
  }
  return { results, truncated: false, filesSearched };
}

/**
 * Every place in a markdown file elsewhere in the folder that links to
 * `target` -- by relative path, as GitHub would follow it, or by
 * [[wikilink]], as Obsidian would.
 *
 * @param {string} realRoot
 * @param {{path: string}[]} files from walkFiles
 * @param {string} target a path from the root
 */
async function findBacklinks(realRoot, files, target) {
  const index = buildIndex(files.map(file => file.path));
  const backlinks = [];

  for (const file of files) {
    if (!isMarkdownPath(file.path) || file.path === target) continue;
    const content = await readText(path.join(realRoot, ...file.path.split('/')));
    if (content === null) continue;

    const seenLines = new Set();
    for (const link of extractLinks(content)) {
      let resolved = null;
      if (link.type === 'wiki' || link.type === 'embed') {
        const inner = link.target.split('|')[0].split('#')[0].trim();
        // [[#Heading]] is a link within the same note, not to another one.
        resolved = inner ? resolveWikilink(inner, file.path, index) : null;
      } else {
        resolved = resolveHref(file.path, link.target)?.path ?? null;
      }

      // One entry per line: a line linking to the same note twice is one
      // mention of it, not two.
      if (resolved === target && !seenLines.has(link.line)) {
        seenLines.add(link.line);
        backlinks.push({ path: file.path, line: link.line, text: link.text.slice(0, LINE_PREVIEW) });
      }
    }
  }
  return backlinks;
}

module.exports = { SEARCH_LIMIT, findBacklinks, searchFiles };
