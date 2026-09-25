/**
 * Links between files: finding them in markdown, and working out which file
 * each one means.
 *
 * Loaded by the server, to find what links to a file, and by the page, to
 * render and follow links -- one implementation, so the two can never
 * disagree about where [[Some Note]] points. It is written so it runs in
 * both: no requires, no DOM, and it exports itself either way.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarginsLinks = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdx'];

  /**
   * The same markdown with code blanked out, character for character.
   *
   * A link inside a code block is an example of a link, not a link, and a
   * backlinks list that includes every README's "[text](url)" syntax sample
   * is wrong. Blanking rather than removing keeps every line and column where
   * it was, so what is found can still be reported by line number.
   */
  function blankCode(markdown) {
    var lines = String(markdown).split('\n');
    var fence = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var open = /^ {0,3}(`{3,}|~{3,})/.exec(line);

      if (fence) {
        // A fence closes on a run of the same character at least as long.
        if (open && open[1][0] === fence[0] && open[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) {
          fence = null;
        }
        lines[i] = line.replace(/[^\s]/g, ' ');
        continue;
      }
      if (open) {
        fence = open[1];
        lines[i] = line.replace(/[^\s]/g, ' ');
        continue;
      }

      // Inline code: a run of backticks closes on the same length run.
      lines[i] = line.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, function (match) {
        return match.replace(/[^\s]/g, ' ');
      });
    }
    return lines.join('\n');
  }

  /** "Note#Heading|Alias" -> its parts. */
  function parseWikilink(inner) {
    var text = String(inner).trim();
    var alias = null;
    var pipe = text.indexOf('|');
    if (pipe !== -1) {
      alias = text.slice(pipe + 1).trim() || null;
      text = text.slice(0, pipe).trim();
    }
    var heading = null;
    var hash = text.indexOf('#');
    if (hash !== -1) {
      heading = text.slice(hash + 1).trim() || null;
      text = text.slice(0, hash).trim();
    }
    return { target: text, heading: heading, alias: alias };
  }

  var INLINE_LINK = /(!?)\[((?:[^[\]\\]|\\.|\[[^\]]*\])*)\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;
  var REFERENCE_DEF = /^ {0,3}\[([^\]]+)\]:\s*(<[^>\n]*>|\S+)/;
  var WIKILINK = /(!?)\[\[([^[\]\n]+?)\]\]/g;

  /**
   * Every link in a markdown document.
   *
   * @param {string} markdown
   * @returns {{type: 'link'|'image'|'wiki'|'embed', target: string, line: number, text: string}[]}
   *   `line` is 1-based; `text` is that whole line, for showing context.
   */
  function extractLinks(markdown) {
    var original = String(markdown).split('\n');
    var blanked = blankCode(markdown).split('\n');
    var links = [];

    for (var i = 0; i < blanked.length; i++) {
      var line = blanked[i];
      var context = original[i].trim();
      var match;

      WIKILINK.lastIndex = 0;
      while ((match = WIKILINK.exec(line)) !== null) {
        var parsed = parseWikilink(match[2]);
        if (parsed.target || parsed.heading) {
          links.push({ type: match[1] ? 'embed' : 'wiki', target: match[2].trim(), line: i + 1, text: context });
        }
      }

      INLINE_LINK.lastIndex = 0;
      while ((match = INLINE_LINK.exec(line)) !== null) {
        var target = match[3];
        if (target.charAt(0) === '<') target = target.slice(1, -1);
        links.push({ type: match[1] ? 'image' : 'link', target: target, line: i + 1, text: context });
      }

      var def = REFERENCE_DEF.exec(line);
      if (def) {
        var href = def[2];
        if (href.charAt(0) === '<') href = href.slice(1, -1);
        links.push({ type: 'link', target: href, line: i + 1, text: context });
      }
    }
    return links;
  }

  /** Whether an href leaves the folder: a scheme, or protocol-relative. */
  function isExternal(href) {
    return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.indexOf('//') === 0;
  }

  function dirname(path) {
    var slash = path.lastIndexOf('/');
    return slash === -1 ? '' : path.slice(0, slash);
  }

  /** Join and normalise forward-slash segments; null if they climb out of the root. */
  function normalise(parts) {
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (out.length === 0) return null;
        out.pop();
      } else {
        out.push(part);
      }
    }
    return out.join('/');
  }

  function safeDecode(text) {
    try {
      return decodeURIComponent(text);
    } catch (error) {
      return text;
    }
  }

  /**
   * Where a relative href in `fromPath` points, as a path from the root.
   *
   * @returns {{path: string, fragment: string|null}|null} null for an
   *   external link, an empty one, or one that climbs out of the folder
   */
  function resolveHref(fromPath, href) {
    var raw = String(href || '').trim();
    if (!raw || isExternal(raw)) return null;

    var fragment = null;
    var hash = raw.indexOf('#');
    if (hash !== -1) {
      fragment = safeDecode(raw.slice(hash + 1)) || null;
      raw = raw.slice(0, hash);
    }
    var query = raw.indexOf('?');
    if (query !== -1) raw = raw.slice(0, query);

    // "#heading" alone is a link within the same file.
    if (raw === '') return { path: fromPath, fragment: fragment };

    var decoded = safeDecode(raw);
    var base = decoded.charAt(0) === '/' ? [] : dirname(fromPath).split('/');
    var path = normalise(base.concat(decoded.split('/')));
    return path === null ? null : { path: path, fragment: fragment };
  }

  function stripExtension(name) {
    var lower = name.toLowerCase();
    for (var i = 0; i < MARKDOWN_EXTENSIONS.length; i++) {
      if (lower.slice(-MARKDOWN_EXTENSIONS[i].length) === MARKDOWN_EXTENSIONS[i]) {
        return name.slice(0, -MARKDOWN_EXTENSIONS[i].length);
      }
    }
    return name;
  }

  function basename(path) {
    var slash = path.lastIndexOf('/');
    return slash === -1 ? path : path.slice(slash + 1);
  }

  /**
   * Look-up tables for resolving wikilinks against every file in the folder,
   * built once. Resolving by scanning the list each time is fine for one
   * link and quadratic for a backlinks pass over a few thousand notes.
   *
   * @param {string[]} paths every file, as paths from the root
   */
  function buildIndex(paths) {
    var byPath = {};
    var byName = {};
    for (var i = 0; i < paths.length; i++) {
      var path = paths[i];
      byPath[path.toLowerCase()] = path;

      // Markdown files answer to their name without the extension, which is
      // how people write [[Some Note]]; every file answers to its full name,
      // which is how [[diagram.png]] is written.
      var names = [basename(path).toLowerCase()];
      var bare = stripExtension(basename(path));
      if (bare !== basename(path)) names.push(bare.toLowerCase());
      for (var j = 0; j < names.length; j++) {
        (byName[names[j]] = byName[names[j]] || []).push(path);
      }
    }
    return { byPath: byPath, byName: byName };
  }

  function depth(path) {
    return path.split('/').length;
  }

  /**
   * Which file a wikilink means, the way Obsidian decides it: by name, not
   * by path, because notes move and [[Some Note]] should not break when they
   * do.
   *
   * An exact path wins. Otherwise, of the files with that name, the one in
   * the linking file's own folder, then the shallowest, then the first
   * alphabetically -- so the answer is always the same one, not whichever the
   * disk happened to list first.
   *
   * @param {string} target the part before any # or |
   * @param {string} fromPath the linking file
   * @param {{byPath: Object, byName: Object}} index from buildIndex
   * @returns {string|null}
   */
  function resolveWikilink(target, fromPath, index) {
    var wanted = normalise(String(target || '').trim().split('/'));
    if (!wanted) return null;
    var lower = wanted.toLowerCase();

    // A path, with or without its extension: from the linking file's own
    // folder first, then from the root. Here first, because [[Ideas]] written
    // in notes/ next to notes/Ideas.md means that one, not a root Ideas.md --
    // the same reason a relative link is resolved from its own folder.
    var here = dirname(fromPath);
    var candidates = here ? [(here + '/' + lower).toLowerCase(), lower] : [lower];
    for (var i = 0; i < candidates.length; i++) {
      if (index.byPath[candidates[i]]) return index.byPath[candidates[i]];
      for (var e = 0; e < MARKDOWN_EXTENSIONS.length; e++) {
        var withExt = candidates[i] + MARKDOWN_EXTENSIONS[e];
        if (index.byPath[withExt]) return index.byPath[withExt];
      }
    }

    // By name. "folder/Note" narrows to files whose path ends that way.
    var name = basename(lower);
    var matches = (index.byName[name] || []).slice();
    if (wanted.indexOf('/') !== -1) {
      matches = matches.filter(function (path) {
        var bare = stripExtension(path).toLowerCase();
        return bare === lower || bare.slice(-(lower.length + 1)) === '/' + lower ||
          path.toLowerCase().slice(-(lower.length + 1)) === '/' + lower;
      });
    }
    if (matches.length === 0) return null;

    matches.sort(function (a, b) {
      var aHere = dirname(a) === here ? 0 : 1;
      var bHere = dirname(b) === here ? 0 : 1;
      if (aHere !== bHere) return aHere - bHere;
      if (depth(a) !== depth(b)) return depth(a) - depth(b);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return matches[0];
  }

  /**
   * A heading's anchor, the way GitHub makes them, so links written for
   * GitHub -- README.md#installation -- land in the same place here.
   */
  function slugify(text) {
    return String(text)
      .trim()
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
  }

  function isMarkdownPath(path) {
    return stripExtension(basename(path)) !== basename(path);
  }

  return {
    MARKDOWN_EXTENSIONS: MARKDOWN_EXTENSIONS,
    blankCode: blankCode,
    buildIndex: buildIndex,
    extractLinks: extractLinks,
    isExternal: isExternal,
    isMarkdownPath: isMarkdownPath,
    normalise: normalise,
    parseWikilink: parseWikilink,
    resolveHref: resolveHref,
    resolveWikilink: resolveWikilink,
    slugify: slugify
  };
}));
