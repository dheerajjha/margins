/* global marked, DOMPurify, InkdLinks */
'use strict';

/**
 * The inkd page. One folder, a tree of its files, and whichever one is
 * open -- rendered, or being edited.
 *
 * One rule runs through all of it: the only HTML that reaches the page is
 * what DOMPurify returns from rendering markdown, and it is inserted as a DOM
 * fragment, never re-parsed from a string. File names, search results,
 * backlinks, commit-message-like text -- everything that comes from the
 * folder -- goes in as text nodes. A hostile file can make the page show
 * something odd; it cannot make it run anything. The server's
 * Content-Security-Policy is the second lock on the same door.
 */

// --- pure helpers (lifted out and tested in test/client.test.js) -----------

/** A path split into segments and encoded, for putting in a URL. */
function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

/** The in-page address of a file, and optionally a heading in it. */
function hrefFor(path, fragment) {
  return '#/' + encodePath(path) + (fragment ? '#' + encodeURIComponent(fragment) : '');
}

/** Where an image in the folder is served from. */
function rawUrl(path) {
  return 'raw/' + encodePath(path);
}

/**
 * The file and heading an address names: "#/notes/a%20b.md#setup" ->
 * {path: "notes/a b.md", fragment: "setup"}. Null path when the address
 * names nothing.
 */
function parseRoute(hash) {
  if (typeof hash !== 'string' || hash.indexOf('#/') !== 0) return { path: null, fragment: null };
  var rest = hash.slice(2);
  var split = rest.indexOf('#');
  var encoded = split === -1 ? rest : rest.slice(0, split);
  var decode = function (text) {
    try { return decodeURIComponent(text); } catch (error) { return text; }
  };
  var path = encoded.split('/').map(decode).filter(function (part) { return part !== ''; }).join('/');
  var fragment = split === -1 ? null : decode(rest.slice(split + 1)) || null;
  return { path: path, fragment: fragment };
}

/**
 * How well a file name matches what was typed into "open a file", or null
 * if it does not match at all.
 *
 * Every typed character must appear, in order. Beyond that, what people
 * mean when they type "gset" is "guide/setup.md": characters that land at
 * the start of a word, right after the previous match, or in the file's own
 * name rather than its folder all count for more.
 */
function fuzzyScore(query, candidate) {
  var q = String(query).toLowerCase().replace(/\s+/g, '');
  var c = String(candidate);
  var lower = c.toLowerCase();
  if (!q) return 0;

  var nameStart = lower.lastIndexOf('/') + 1;
  var score = 0;
  var from = 0;
  var previous = -2;

  for (var i = 0; i < q.length; i++) {
    var at = lower.indexOf(q[i], from);
    if (at === -1) return null;

    score += 1;
    if (at === previous + 1) score += 5;
    var before = at === 0 ? '/' : c[at - 1];
    if ('/-_. '.indexOf(before) !== -1 || (c[at] !== lower[at] && before === before.toLowerCase())) score += 8;
    if (at >= nameStart) score += 3;

    previous = at;
    from = at + 1;
  }

  // A tie goes to the shorter path: "setup.md" over "archive/old/setup.md".
  return score - c.length * 0.01;
}

/** The best matches for a query among paths, best first. */
function rankFiles(query, paths, limit) {
  var scored = [];
  for (var i = 0; i < paths.length; i++) {
    var score = fuzzyScore(query, paths[i]);
    if (score !== null) scored.push({ path: paths[i], score: score });
  }
  scored.sort(function (a, b) { return b.score - a.score || (a.path < b.path ? -1 : 1); });
  return scored.slice(0, limit || 50).map(function (entry) { return entry.path; });
}

/**
 * Which action a key press means, or null. Pure, so the rules -- in
 * particular that typing in a field is never a shortcut -- can be tested.
 */
function shortcutFor(key, modifiers, targetTag) {
  var mod = Boolean(modifiers && (modifiers.meta || modifiers.ctrl));
  var shift = Boolean(modifiers && modifiers.shift);
  var alt = Boolean(modifiers && modifiers.alt);
  var k = String(key).toLowerCase();

  if (mod && !alt && !shift && k === 'p') return 'quickOpen';
  if (mod && !alt && shift && k === 'f') return 'search';
  if (mod && !alt && !shift && k === 's') return 'save';
  if (key === 'Escape') return 'escape';

  if (mod || alt) return null;
  if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return null;

  if (key === 'e') return 'edit';
  if (key === '?') return 'help';
  if (key === '[') return 'back';
  if (key === ']') return 'forward';
  return null;
}

/** Titles made unique within one document: "Notes", "Notes-1", "Notes-2". */
function uniqueSlug(text, used) {
  var base = InkdLinks.slugify(text) || 'section';
  var slug = base;
  var n = 1;
  while (used.has(slug)) slug = base + '-' + n++;
  used.add(slug);
  return slug;
}

// --- state ---------------------------------------------------------------

var state = {
  info: null,
  files: [],
  paths: [],
  index: null,
  filesTruncated: false,
  treeCache: new Map(),
  expanded: new Set(),
  current: null,
  editing: false,
  dirty: false,
  diskChanged: false,
  lastHash: '',
  poll: null
};

var $ = function (id) { return document.getElementById(id); };

// --- talking to the server ---------------------------------------------------

function api(url, options) {
  return fetch(url, options).then(function (response) {
    return response.json().catch(function () { return null; }).then(function (body) {
      if (!response.ok) {
        var error = new Error((body && body.error) || 'That did not work (' + response.status + ').');
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    });
  });
}

function sendJson(method, url, value) {
  return api(url, {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
}

function refreshFiles() {
  return api('api/files').then(function (result) {
    state.files = result.files;
    state.paths = result.files.map(function (file) { return file.path; });
    state.index = InkdLinks.buildIndex(state.paths);
    state.filesTruncated = result.truncated;
    var note = $('treeNote');
    note.textContent = result.truncated
      ? 'This folder is very large. Search and backlinks look at the first ' + result.files.length + ' files.'
      : '';
    note.classList.toggle('hidden', !result.truncated);
  });
}

// --- rendering markdown --------------------------------------------------------

/**
 * [[wikilinks]] for marked. The token only records what was written; which
 * file it means is decided after sanitising, against the folder's file list,
 * so the markup this produces never contains a resolved path from anywhere
 * but inkd itself.
 */
var wikilinkExtension = {
  name: 'wikilink',
  level: 'inline',
  start: function (src) {
    var at = src.indexOf('[[');
    return at === -1 ? undefined : (at > 0 && src[at - 1] === '!' ? at - 1 : at);
  },
  tokenizer: function (src) {
    var match = /^(!?)\[\[([^[\]\n]+?)\]\]/.exec(src);
    if (!match) return undefined;
    return { type: 'wikilink', raw: match[0], embed: Boolean(match[1]), inner: match[2] };
  },
  renderer: function (token) {
    var parsed = InkdLinks.parseWikilink(token.inner);
    var label = parsed.alias || (parsed.heading && !parsed.target ? parsed.heading : parsed.target) + (parsed.heading && parsed.target && !parsed.alias ? ' › ' + parsed.heading : '');
    var escape = function (text) {
      return String(text).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };
    return '<a class="wikilink" data-wikilink="' + escape(token.inner) + '"' +
      (token.embed ? ' data-embed="1"' : '') + '>' + escape(label) + '</a>';
  }
};

marked.use({ gfm: true, extensions: [wikilinkExtension] });

// What sanitising allows through. HTML is allowed in markdown and READMEs
// use it -- <details>, <kbd>, <img width>, <picture> -- so it is not
// stripped wholesale; what goes is anything that runs, loads a page, submits
// or restyles: script handlers are DOMPurify's default, and the rest is here.
// `style` in particular: a file must not be able to draw a convincing fake
// "Save" dialog over the page.
var PURIFY = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option', 'iframe', 'frame', 'frameset',
    'object', 'embed', 'link', 'meta', 'base', 'video', 'audio', 'dialog', 'template'],
  FORBID_ATTR: ['style'],
  RETURN_DOM_FRAGMENT: true
};

/**
 * Render markdown from `fromPath` into `target`.
 *
 * Parsed by marked, sanitised by DOMPurify straight into a DOM fragment --
 * never back into a string, which is where sanitised HTML gets mutated into
 * something else by a second parse -- and then adjusted: links and images
 * pointed at the folder, headings given anchors.
 */
function renderMarkdown(markdown, fromPath, target) {
  var fragment = DOMPurify.sanitize(marked.parse(markdown), PURIFY);
  adjustRendered(fragment, fromPath);
  target.replaceChildren(fragment);
}

function adjustRendered(root, fromPath) {
  root.querySelectorAll('a[data-wikilink]').forEach(function (anchor) {
    var parsed = InkdLinks.parseWikilink(anchor.getAttribute('data-wikilink'));
    var path = parsed.target ? InkdLinks.resolveWikilink(parsed.target, fromPath, state.index) : fromPath;
    var embed = anchor.hasAttribute('data-embed');

    if (!path) {
      // Obsidian's convention: a link to a note that does not exist yet is a
      // way to create it. Clicking one offers exactly that.
      anchor.classList.add('wikilink-missing');
      anchor.title = 'No file called ' + parsed.target + ' yet. Click to create it.';
      anchor.href = '#';
      anchor.setAttribute('data-create', parsed.target);
      return;
    }

    var file = state.files.find(function (f) { return f.path === path; });
    if (embed && file && file.kind === 'image') {
      var img = document.createElement('img');
      img.src = rawUrl(path);
      img.alt = parsed.alias || parsed.target;
      img.loading = 'lazy';
      anchor.replaceWith(img);
      return;
    }
    anchor.href = hrefFor(path, parsed.heading);
    if (embed) anchor.classList.add('wikilink-embed');
  });

  root.querySelectorAll('a[href]:not([data-wikilink])').forEach(function (anchor) {
    var href = anchor.getAttribute('href');
    if (href.indexOf('#/') === 0) return; // already an in-page address
    if (InkdLinks.isExternal(href)) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      return;
    }
    var resolved = InkdLinks.resolveHref(fromPath, href);
    if (!resolved) {
      anchor.classList.add('link-broken');
      anchor.title = 'This link points outside the folder.';
      anchor.removeAttribute('href');
      return;
    }
    anchor.href = hrefFor(resolved.path, resolved.fragment);
  });

  root.querySelectorAll('img[src]').forEach(function (img) {
    var src = img.getAttribute('src');
    img.loading = 'lazy';
    if (src.indexOf('raw/') === 0 || src.indexOf('data:') === 0 || InkdLinks.isExternal(src)) return;
    var resolved = InkdLinks.resolveHref(fromPath, src);
    if (resolved) img.src = rawUrl(resolved.path);
    else img.removeAttribute('src');
  });

  // Task lists render as checkboxes. Anything else that survived as an input
  // is noise in a document; the checkboxes are shown, not editable.
  root.querySelectorAll('input').forEach(function (input) {
    if (input.type !== 'checkbox') input.remove();
    else input.disabled = true;
  });

  var used = new Set();
  root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(function (heading) {
    heading.id = uniqueSlug(heading.textContent, used);
    var link = document.createElement('a');
    link.className = 'heading-anchor';
    link.href = hrefFor(fromPath, heading.id);
    link.setAttribute('aria-label', 'Link to this section');
    link.textContent = '#';
    heading.appendChild(link);
  });

  // Wide tables scroll inside the column instead of widening the page.
  root.querySelectorAll('table').forEach(function (table) {
    var wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.replaceWith(wrap);
    wrap.appendChild(table);
  });
}

// --- the tree ---------------------------------------------------------------

function loadLevel(dirPath) {
  if (state.treeCache.has(dirPath)) return Promise.resolve(state.treeCache.get(dirPath));
  return api('api/tree?path=' + encodeURIComponent(dirPath)).then(function (result) {
    state.treeCache.set(dirPath, result.entries);
    return result.entries;
  });
}

function saveExpanded() {
  try {
    localStorage.setItem('inkd:expanded:' + (state.info && state.info.root), JSON.stringify(Array.from(state.expanded)));
  } catch (error) { /* private window: the tree just starts collapsed */ }
}

function restoreExpanded() {
  try {
    var saved = JSON.parse(localStorage.getItem('inkd:expanded:' + state.info.root) || '[]');
    if (Array.isArray(saved)) saved.forEach(function (path) { state.expanded.add(path); });
  } catch (error) { /* nothing saved, or storage blocked */ }
}

function fileIcon(kind) {
  return kind === 'markdown' ? '¶' : kind === 'image' ? '▣' : '·';
}

/** Draw one folder's entries, and the folders below it that are open. */
function buildLevel(entries, depth) {
  var list = document.createDocumentFragment();
  entries.forEach(function (entry) {
    var item = document.createElement('li');
    item.setAttribute('role', 'treeitem');
    var row = document.createElement(entry.type === 'dir' ? 'button' : 'a');
    row.className = 'tree-row tree-' + (entry.type === 'dir' ? 'dir' : entry.kind);
    row.style.setProperty('--depth', depth);
    row.title = entry.path;

    var icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.setAttribute('aria-hidden', 'true');
    var name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = entry.name;

    if (entry.type === 'dir') {
      var open = state.expanded.has(entry.path);
      row.type = 'button';
      row.setAttribute('aria-expanded', String(open));
      icon.textContent = open ? '▾' : '▸';
      row.addEventListener('click', function () { toggleFolder(entry.path); });
      row.append(icon, name);
      item.appendChild(row);
      if (open && state.treeCache.has(entry.path)) {
        var sub = document.createElement('ul');
        sub.setAttribute('role', 'group');
        sub.appendChild(buildLevel(state.treeCache.get(entry.path), depth + 1));
        item.appendChild(sub);
      }
    } else {
      row.href = hrefFor(entry.path);
      icon.textContent = fileIcon(entry.kind);
      if (state.current && state.current.path === entry.path) {
        row.classList.add('tree-active');
        row.setAttribute('aria-current', 'page');
      }
      row.append(icon, name);
      item.appendChild(row);
    }
    list.appendChild(item);
  });
  return list;
}

function renderTree() {
  return loadLevel('').then(function (entries) {
    // Every open folder's contents are needed before drawing, or an open
    // folder draws empty and then jumps.
    var open = Array.from(state.expanded);
    return Promise.all(open.map(function (path) { return loadLevel(path).catch(function () { state.expanded.delete(path); }); }))
      .then(function () {
        $('tree').replaceChildren(buildLevel(entries, 0));
        var active = $('tree').querySelector('.tree-active');
        if (active) active.scrollIntoView({ block: 'nearest' });
      });
  });
}

function toggleFolder(path) {
  if (state.expanded.has(path)) state.expanded.delete(path);
  else state.expanded.add(path);
  saveExpanded();
  renderTree();
}

/** Open every folder above a file, so the file can be seen in the tree. */
function revealInTree(path) {
  var parts = path.split('/');
  for (var i = 1; i < parts.length; i++) state.expanded.add(parts.slice(0, i).join('/'));
  saveExpanded();
  return renderTree();
}

/** Forget cached folder contents and draw again -- after a new file, or on focus. */
function refreshTree() {
  state.treeCache.clear();
  return renderTree();
}

// --- showing a file ---------------------------------------------------------

function setVisible(id, visible) {
  $(id).classList.toggle('hidden', !visible);
}

/** Where a path is: each folder above it, clickable, then its name. */
function renderBreadcrumbs(path) {
  var crumbs = $('breadcrumbs');
  crumbs.replaceChildren();
  var root = document.createElement('a');
  root.href = '#/';
  root.textContent = state.info ? state.info.name : '/';
  crumbs.appendChild(root);

  var parts = path ? path.split('/') : [];
  parts.forEach(function (part, i) {
    var sep = document.createElement('span');
    sep.className = 'crumb-sep';
    sep.textContent = '/';
    crumbs.appendChild(sep);
    if (i === parts.length - 1) {
      var here = document.createElement('span');
      here.className = 'crumb-current';
      here.textContent = part;
      crumbs.appendChild(here);
    } else {
      var link = document.createElement('a');
      link.href = hrefFor(parts.slice(0, i + 1).join('/'));
      link.textContent = part;
      crumbs.appendChild(link);
    }
  });
}

/** A short explanation in place of a file: not found, not text, too big. */
function showMessage(title, detail) {
  var doc = $('document');
  doc.replaceChildren();
  var box = document.createElement('div');
  box.className = 'empty-state';
  var h = document.createElement('h2');
  h.textContent = title;
  box.appendChild(h);
  if (detail) {
    var p = document.createElement('p');
    p.textContent = detail;
    box.appendChild(p);
  }
  doc.appendChild(box);
  setVisible('context', false);
}

function isEditable(file) {
  return Boolean(file) && (file.kind === 'markdown' || file.kind === 'text');
}

function updateDocBar() {
  var file = state.current;
  setVisible('docBar', Boolean(file));
  if (!file) return;
  renderBreadcrumbs(file.path);
  setVisible('editButton', isEditable(file) && !state.editing);
  setVisible('saveButton', state.editing);
  setVisible('doneButton', state.editing);
  $('saveButton').disabled = !state.dirty;
  $('saveState').textContent = state.editing ? (state.dirty ? 'Unsaved changes' : 'Saved') : '';
}

/** Draw the open file in the reading view. */
function renderCurrent(fragment) {
  var file = state.current;
  var doc = $('document');
  document.title = (file.path ? file.path.split('/').pop() + ' — ' : '') + (state.info ? state.info.name : 'inkd');

  if (file.kind === 'markdown') {
    renderMarkdown(file.content, file.path, doc);
    buildOutline(doc);
    loadBacklinks(file.path);
  } else if (file.kind === 'text') {
    doc.replaceChildren(sourceView(file.content));
    setVisible('context', false);
  } else if (file.kind === 'image') {
    var figure = document.createElement('figure');
    figure.className = 'image-view';
    var img = document.createElement('img');
    img.src = rawUrl(file.path);
    img.alt = file.path;
    figure.appendChild(img);
    doc.replaceChildren(figure);
    setVisible('context', false);
  } else {
    showMessage('This file is not text', 'inkd shows markdown, text and images. Open this one with the program it belongs to.');
  }

  if (fragment) scrollToFragment(fragment);
  else $('main').scrollTop = 0;
}

/** Plain text, with line numbers, as text nodes -- never markup. */
function sourceView(content) {
  var pre = document.createElement('pre');
  pre.className = 'source-view';
  var lines = content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  lines.forEach(function (line, i) {
    var row = document.createElement('span');
    row.className = 'source-line';
    var number = document.createElement('span');
    number.className = 'source-number';
    number.textContent = String(i + 1);
    var text = document.createElement('span');
    text.className = 'source-text';
    text.textContent = line + '\n';
    row.append(number, text);
    pre.appendChild(row);
  });
  return pre;
}

function scrollToFragment(fragment) {
  var target = document.getElementById(fragment) || document.getElementById(InkdLinks.slugify(fragment));
  if (target) target.scrollIntoView({ block: 'start' });
}

/** "On this page": the document's h1-h3, for long files. */
function buildOutline(doc) {
  var headings = Array.from(doc.querySelectorAll('h1, h2, h3'));
  var outline = $('outline');
  outline.replaceChildren();
  headings.forEach(function (heading) {
    var item = document.createElement('li');
    item.className = 'outline-' + heading.tagName.toLowerCase();
    var link = document.createElement('a');
    link.href = hrefFor(state.current.path, heading.id);
    // The heading's own text, without the "#" anchor appended to it.
    link.textContent = heading.firstChild ? Array.from(heading.childNodes)
      .filter(function (node) { return !(node.classList && node.classList.contains('heading-anchor')); })
      .map(function (node) { return node.textContent; }).join('').trim() : '';
    item.appendChild(link);
    outline.appendChild(item);
  });
  // One heading is a title, not an outline.
  setVisible('outlineSection', headings.length > 1);
  refreshContextVisibility();
}

function refreshContextVisibility() {
  var any = !$('outlineSection').classList.contains('hidden') || !$('backlinksSection').classList.contains('hidden');
  setVisible('context', any);
}

/** What links here -- by relative path, or by [[wikilink]]. */
function loadBacklinks(path) {
  setVisible('backlinksSection', false);
  api('api/backlinks?path=' + encodeURIComponent(path)).then(function (result) {
    if (!state.current || state.current.path !== path) return; // moved on meanwhile
    var list = $('backlinks');
    list.replaceChildren();
    result.backlinks.forEach(function (link) {
      var item = document.createElement('li');
      var anchor = document.createElement('a');
      anchor.href = hrefFor(link.path);
      var name = document.createElement('span');
      name.className = 'backlink-path';
      name.textContent = link.path;
      var context = document.createElement('span');
      context.className = 'backlink-text';
      context.textContent = link.text;
      anchor.append(name, context);
      item.appendChild(anchor);
      list.appendChild(item);
    });
    $('backlinkCount').textContent = String(result.backlinks.length);
    setVisible('backlinksSection', result.backlinks.length > 0);
    refreshContextVisibility();
  }).catch(function () { /* backlinks are extra; the file is already shown */ });
}

/** A folder: what is in it, and its README underneath -- as GitHub shows one. */
function showFolder(path) {
  state.current = null;
  stopEditing(true);
  // Open the folder in the tree too, and drop the previous file's highlight.
  if (path) state.expanded.add(path);
  revealInTree(path ? path + '/' : '');
  setVisible('docBar', true);
  renderBreadcrumbs(path);
  setVisible('editButton', false);
  $('saveState').textContent = '';
  document.title = (path || (state.info ? state.info.name : '')) + ' — inkd';

  return loadLevel(path).then(function (entries) {
    var doc = $('document');
    doc.replaceChildren();
    var list = document.createElement('ul');
    list.className = 'folder-list';
    entries.forEach(function (entry) {
      var item = document.createElement('li');
      var link = document.createElement('a');
      link.href = hrefFor(entry.path);
      link.textContent = entry.name + (entry.type === 'dir' ? '/' : '');
      link.className = entry.type === 'dir' ? 'folder-dir' : 'folder-file';
      item.appendChild(link);
      list.appendChild(item);
    });
    if (entries.length === 0) {
      var none = document.createElement('li');
      none.className = 'folder-empty';
      none.textContent = 'Nothing here yet.';
      list.appendChild(none);
    }
    doc.appendChild(list);
    setVisible('context', false);

    var readme = entries.find(function (entry) {
      return entry.type === 'file' && /^(readme|index)\.(md|markdown|mdown|mkd|mkdn|mdx)$/i.test(entry.name);
    });
    if (!readme) return;
    return api('api/file?path=' + encodeURIComponent(readme.path)).then(function (file) {
      var article = document.createElement('div');
      article.className = 'folder-readme';
      renderMarkdown(file.content, file.path, article);
      doc.appendChild(article);
    });
  }).catch(function (error) {
    showMessage('Could not open this folder', error.message);
  });
}

/** Open whatever an address names: a file, a folder, or nothing. */
function openRoute(route) {
  var path = route.path || '';
  if (path === '') return showFolder('');

  return api('api/file?path=' + encodeURIComponent(path)).then(function (file) {
    if (file.kind === 'folder') return showFolder(path);
    stopEditing(true);
    state.current = file;
    state.diskChanged = false;
    hideBanner();
    updateDocBar();
    renderCurrent(route.fragment);
    revealInTree(path);
    // On a phone the tree covers the page; having picked a file, it goes.
    if (window.matchMedia('(max-width: 760px)').matches && !document.body.classList.contains('sidebar-hidden')) {
      toggleSidebar();
    }
  }).catch(function (error) {
    state.current = null;
    updateDocBar();
    setVisible('docBar', true);
    renderBreadcrumbs(path);
    setVisible('editButton', false);
    showMessage(error.status === 404 ? 'No file here' : 'Could not open this', error.message);
  });
}

// --- editing ------------------------------------------------------------------

var previewTimer = null;

function startEditing() {
  if (!isEditable(state.current) || state.editing) return;
  state.editing = true;
  state.dirty = false;
  $('source').value = state.current.content;
  $('editor').classList.toggle('editor-text', state.current.kind !== 'markdown');
  setVisible('viewer', false);
  setVisible('editor', true);
  setVisible('context', false);
  updateDocBar();
  renderPreview();
  $('source').focus();
}

/**
 * Leave the editor. `force` skips the question -- used when the file being
 * shown is changing anyway and the caller has already asked.
 */
function stopEditing(force) {
  if (!state.editing) return true;
  if (!force && state.dirty && !window.confirm('Discard your unsaved changes?')) return false;
  state.editing = false;
  state.dirty = false;
  setVisible('editor', false);
  setVisible('viewer', true);
  hideBanner();
  if (state.current && !force) renderCurrent(null);
  updateDocBar();
  return true;
}

function renderPreview() {
  if (!state.editing || state.current.kind !== 'markdown') return;
  renderMarkdown($('source').value, state.current.path, $('preview'));
}

function onSourceInput() {
  state.dirty = $('source').value !== state.current.content;
  updateDocBar();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 120);
}

/** Tab indents instead of leaving the editor; the one key a textarea gets wrong for writing. */
function onSourceKeydown(event) {
  if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey) return;
  event.preventDefault();
  var area = event.target;
  var start = area.selectionStart;
  area.setRangeText('  ', start, area.selectionEnd, 'end');
  onSourceInput();
}

/**
 * Save, if the file on disk is still the one that was opened. If it is not
 * -- another editor, a git checkout, an agent -- nothing is written, and the
 * choice is put to the person rather than made for them.
 */
function save(overVersion) {
  if (!state.editing || !state.current) return;
  var content = $('source').value;
  $('saveState').textContent = 'Saving…';

  return sendJson('PUT', 'api/file', {
    path: state.current.path,
    content: content,
    version: overVersion || state.current.version
  }).then(function (result) {
    state.current.content = content;
    state.current.version = result.version;
    state.dirty = false;
    state.diskChanged = false;
    hideBanner();
    updateDocBar();
  }).catch(function (error) {
    if (error.status === 409 && error.body && error.body.current) {
      var disk = error.body.current;
      showBanner(
        'This file changed on disk after you opened it, so your edit was not saved.',
        'Keep my version', function () { save(disk.version); },
        'Use the version on disk', function () { takeDiskVersion(disk); }
      );
    } else {
      showBanner('Could not save: ' + error.message, 'Try again', function () { save(); }, 'Dismiss', hideBanner);
    }
    updateDocBar();
  });
}

function takeDiskVersion(disk) {
  state.current.content = disk.content;
  state.current.version = disk.version;
  $('source').value = disk.content;
  state.dirty = false;
  state.diskChanged = false;
  hideBanner();
  renderPreview();
  updateDocBar();
}

function showBanner(text, primaryLabel, onPrimary, secondaryLabel, onSecondary) {
  $('bannerText').textContent = text;
  var primary = $('bannerPrimary');
  var secondary = $('bannerSecondary');
  primary.textContent = primaryLabel;
  secondary.textContent = secondaryLabel;
  primary.onclick = onPrimary;
  secondary.onclick = onSecondary;
  setVisible('banner', true);
}

function hideBanner() {
  setVisible('banner', false);
}

// --- noticing changes made elsewhere ------------------------------------------

/**
 * Every couple of seconds, ask whether the open file is still the version
 * shown. Polling rather than a file watcher: editors that save by writing a
 * new file and renaming it over the old one break most watchers, and one
 * small request to a server on this machine costs nothing.
 */
function checkForChanges() {
  var file = state.current;
  if (document.hidden || !file || !file.version) return;

  api('api/version?path=' + encodeURIComponent(file.path)).then(function (result) {
    if (state.current !== file || !result.version || result.version === file.version) return;

    if (!state.editing || !state.dirty) {
      // Nothing of the reader's to lose: show what is there now, in place.
      var scroll = $('main').scrollTop;
      return api('api/file?path=' + encodeURIComponent(file.path)).then(function (fresh) {
        if (state.current !== file) return;
        state.current = fresh;
        if (state.editing) {
          $('source').value = fresh.content;
          renderPreview();
        } else {
          renderCurrent(null);
          $('main').scrollTop = scroll;
        }
      });
    }

    if (state.diskChanged) return;
    state.diskChanged = true;
    showBanner(
      'This file changed on disk while you were editing. Your changes are still here; saving will ask before replacing it.',
      'Load the disk version', function () {
        api('api/file?path=' + encodeURIComponent(file.path)).then(takeDiskVersion);
      },
      'Keep editing', hideBanner
    );
  }).catch(function () { /* the file may be mid-save elsewhere; the next check will see */ });
}

// --- open a file by name ------------------------------------------------------

var quickSelection = 0;

function openQuickOpen() {
  var dialog = $('quickOpen');
  if (dialog.open) return;
  $('quickOpenInput').value = '';
  renderQuickOpen();
  dialog.showModal();
  $('quickOpenInput').focus();
}

function renderQuickOpen() {
  var query = $('quickOpenInput').value;
  // With nothing typed, the files people most often want: the markdown.
  var paths = query ? rankFiles(query, state.paths, 50) : state.paths.filter(InkdLinks.isMarkdownPath).slice(0, 50);
  var results = $('quickOpenResults');
  results.replaceChildren();
  quickSelection = 0;

  paths.forEach(function (path, i) {
    var item = document.createElement('li');
    item.setAttribute('role', 'option');
    item.dataset.path = path;
    var slash = path.lastIndexOf('/');
    var name = document.createElement('span');
    name.className = 'result-name';
    name.textContent = path.slice(slash + 1);
    var where = document.createElement('span');
    where.className = 'result-where';
    where.textContent = slash === -1 ? '' : path.slice(0, slash);
    item.append(name, where);
    item.addEventListener('mousedown', function (event) {
      event.preventDefault();
      pickQuickOpen(i);
    });
    results.appendChild(item);
  });
  if (paths.length === 0) {
    var none = document.createElement('li');
    none.className = 'result-none';
    none.textContent = query ? 'No file matches “' + query + '”.' : 'No markdown files here.';
    results.appendChild(none);
  }
  highlightQuick();
}

function highlightQuick() {
  var items = $('quickOpenResults').querySelectorAll('li[data-path]');
  items.forEach(function (item, i) {
    item.classList.toggle('selected', i === quickSelection);
    item.setAttribute('aria-selected', String(i === quickSelection));
  });
  if (items[quickSelection]) items[quickSelection].scrollIntoView({ block: 'nearest' });
}

function pickQuickOpen(index) {
  var items = $('quickOpenResults').querySelectorAll('li[data-path]');
  var item = items[index === undefined ? quickSelection : index];
  if (!item) return;
  $('quickOpen').close();
  location.hash = hrefFor(item.dataset.path);
}

function onQuickOpenKeydown(event) {
  var count = $('quickOpenResults').querySelectorAll('li[data-path]').length;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    quickSelection = Math.min(count - 1, quickSelection + 1);
    highlightQuick();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    quickSelection = Math.max(0, quickSelection - 1);
    highlightQuick();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    pickQuickOpen();
  }
}

// --- search every file ----------------------------------------------------------

var searchTimer = null;
var searchSequence = 0;

function openSearch() {
  var dialog = $('search');
  if (dialog.open) return;
  dialog.showModal();
  var input = $('searchInput');
  input.focus();
  input.select();
}

function runSearch() {
  var query = $('searchInput').value.trim();
  var summary = $('searchSummary');
  var results = $('searchResults');
  if (query.length < 2) {
    summary.textContent = query ? 'Keep typing…' : '';
    results.replaceChildren();
    return;
  }

  // Answers can arrive out of order; only the latest question's is drawn.
  var sequence = ++searchSequence;
  summary.textContent = 'Searching…';
  api('api/search?q=' + encodeURIComponent(query)).then(function (result) {
    if (sequence !== searchSequence) return;
    results.replaceChildren();

    var byFile = new Map();
    result.results.forEach(function (hit) {
      if (!byFile.has(hit.path)) byFile.set(hit.path, []);
      byFile.get(hit.path).push(hit);
    });

    byFile.forEach(function (hits, path) {
      var group = document.createElement('li');
      group.className = 'search-file';
      var heading = document.createElement('a');
      heading.className = 'search-file-name';
      heading.href = hrefFor(path);
      heading.textContent = path;
      group.appendChild(heading);

      hits.forEach(function (hit) {
        var line = document.createElement('a');
        line.className = 'search-hit';
        line.href = hrefFor(path);
        var number = document.createElement('span');
        number.className = 'search-line';
        number.textContent = hit.line;
        // The match marked out of text nodes: the file's own words, never
        // parsed as markup.
        var text = document.createElement('span');
        text.className = 'search-text';
        text.append(
          document.createTextNode(hit.text.slice(0, hit.start)),
          Object.assign(document.createElement('mark'), { textContent: hit.text.slice(hit.start, hit.start + hit.length) }),
          document.createTextNode(hit.text.slice(hit.start + hit.length))
        );
        line.append(number, text);
        group.appendChild(line);
      });
      results.appendChild(group);
    });

    var files = byFile.size;
    summary.textContent = result.results.length === 0
      ? 'Nothing matches “' + query + '” in ' + result.filesSearched + ' files.'
      : result.results.length + (result.truncated ? '+' : '') + ' matches in ' + files + ' file' + (files === 1 ? '' : 's') +
        (result.truncated ? ' — showing the first ' + result.results.length + '.' : '.');
  }).catch(function (error) {
    if (sequence === searchSequence) summary.textContent = error.message;
  });
}

// --- a new file ---------------------------------------------------------------

function openNewFile(suggested) {
  var dialog = $('newFile');
  var here = state.current ? state.current.path.split('/').slice(0, -1).join('/') : '';
  $('newFileInput').value = suggested || (here ? here + '/' : '');
  setVisible('newFileError', false);
  dialog.showModal();
  var input = $('newFileInput');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function createFile(event) {
  event.preventDefault();
  var path = $('newFileInput').value.trim().replace(/^\/+/, '');
  if (!path || /\/$/.test(path)) {
    $('newFileError').textContent = 'Give the file a name.';
    setVisible('newFileError', true);
    return;
  }
  // A name with no extension is a note: people type "ideas" and mean ideas.md.
  if (!/\.[^/]+$/.test(path)) path += '.md';

  var title = path.split('/').pop().replace(/\.[^.]+$/, '');
  var content = InkdLinks.isMarkdownPath(path) ? '# ' + title + '\n\n' : '';
  sendJson('POST', 'api/file', { path: path, content: content }).then(function (created) {
    $('newFile').close();
    return refreshFiles().then(refreshTree).then(function () {
      location.hash = hrefFor(created.path);
      // Open it for writing: nobody creates an empty file to read it.
      var wait = setInterval(function () {
        if (state.current && state.current.path === created.path) {
          clearInterval(wait);
          startEditing();
          var source = $('source');
          source.setSelectionRange(source.value.length, source.value.length);
        }
      }, 50);
      setTimeout(function () { clearInterval(wait); }, 3000);
    });
  }).catch(function (error) {
    $('newFileError').textContent = error.message;
    setVisible('newFileError', true);
  });
}

// --- the page: keys, navigation, start ----------------------------------------

function closeTopDialog() {
  var open = Array.from(document.querySelectorAll('dialog[open]'));
  if (open.length === 0) return false;
  open[open.length - 1].close();
  return true;
}

function onKeydown(event) {
  var action = shortcutFor(event.key, {
    meta: event.metaKey, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey
  }, event.target && event.target.tagName);
  if (!action) return;

  if (action === 'quickOpen') { event.preventDefault(); closeTopDialog(); openQuickOpen(); }
  else if (action === 'search') { event.preventDefault(); closeTopDialog(); openSearch(); }
  else if (action === 'save') { event.preventDefault(); if (state.editing) save(); }
  else if (action === 'escape') {
    // Dialogs close themselves on Escape; leaving the editor is the one
    // Escape inkd handles.
    if (!document.querySelector('dialog[open]') && state.editing) stopEditing(false);
  }
  else if (document.querySelector('dialog[open]')) return;
  else if (action === 'edit') { event.preventDefault(); startEditing(); }
  else if (action === 'help') { event.preventDefault(); $('help').showModal(); }
  else if (action === 'back') history.back();
  else if (action === 'forward') history.forward();
}

function onHashChange() {
  if (state.editing && state.dirty && !window.confirm('Leave this file? Your unsaved changes will be lost.')) {
    // Put the address back without adding a history entry.
    history.replaceState(null, '', state.lastHash);
    return;
  }
  state.lastHash = location.hash;
  openRoute(parseRoute(location.hash));
}

/** Show ⌘ on a Mac and Ctrl elsewhere, in every shortcut hint on the page. */
function labelShortcuts() {
  var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  document.querySelectorAll('kbd[data-mod]').forEach(function (kbd) {
    var key = kbd.textContent.trim();
    kbd.textContent = (mac ? '⌘' : 'Ctrl+') + (kbd.hasAttribute('data-shift') ? (mac ? '⇧' : 'Shift+') : '') + key;
  });
}

function toggleSidebar() {
  var hidden = document.body.classList.toggle('sidebar-hidden');
  $('sidebarToggle').setAttribute('aria-expanded', String(!hidden));
  try { localStorage.setItem('inkd:sidebar-hidden', hidden ? '1' : ''); } catch (error) { /* fine */ }
}

/**
 * Hold a connection open for as long as this tab exists, so closing the last
 * tab stops the server -- as in reviewer. EventSource reconnects on its own
 * after a blip, which is what the server's grace period relies on.
 */
function watchFromThisTab() {
  try { new EventSource('api/alive'); } catch (error) { /* no automatic stop, nothing worse */ }
}

function wire() {
  labelShortcuts();
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('beforeunload', function (event) {
    if (state.editing && state.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  var lastRefresh = 0;
  window.addEventListener('focus', function () {
    // Back from another window, where files may have been added or removed.
    if (Date.now() - lastRefresh < 3000) return;
    lastRefresh = Date.now();
    refreshFiles().then(refreshTree).catch(function () {});
  });

  $('sidebarToggle').addEventListener('click', toggleSidebar);
  $('quickOpenButton').addEventListener('click', openQuickOpen);
  $('searchButton').addEventListener('click', openSearch);
  $('helpButton').addEventListener('click', function () { $('help').showModal(); });
  $('newFileButton').addEventListener('click', function () { openNewFile(); });
  $('editButton').addEventListener('click', startEditing);
  $('saveButton').addEventListener('click', function () { save(); });
  $('doneButton').addEventListener('click', function () { stopEditing(false); });
  $('source').addEventListener('input', onSourceInput);
  $('source').addEventListener('keydown', onSourceKeydown);
  $('quickOpenInput').addEventListener('input', renderQuickOpen);
  $('quickOpenInput').addEventListener('keydown', onQuickOpenKeydown);
  $('searchInput').addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 200);
  });
  $('newFileForm').addEventListener('submit', createFile);

  // A missing [[wikilink]] creates its note, next to the one linking to it.
  document.addEventListener('click', function (event) {
    var anchor = event.target.closest && event.target.closest('a[data-create]');
    if (!anchor) return;
    event.preventDefault();
    var here = state.current ? state.current.path.split('/').slice(0, -1).join('/') : '';
    openNewFile((here ? here + '/' : '') + anchor.getAttribute('data-create'));
  });

  // Clicking outside a dialog's box closes it, as people expect of a palette.
  document.querySelectorAll('dialog').forEach(function (dialog) {
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) dialog.close();
    });
  });

  try {
    if (localStorage.getItem('inkd:sidebar-hidden')) toggleSidebar();
  } catch (error) { /* fine */ }
}

function start() {
  wire();
  watchFromThisTab();

  return api('api/info').then(function (info) {
    state.info = info;
    $('rootName').textContent = info.root;
    $('rootName').title = info.root;
    restoreExpanded();
    return refreshFiles();
  }).then(renderTree).then(function () {
    var route = parseRoute(location.hash);
    if (route.path === null && state.info.initial) {
      location.replace(hrefFor(state.info.initial));
      return;
    }
    state.lastHash = location.hash;
    return openRoute(route);
  }).then(function () {
    state.poll = setInterval(checkForChanges, 2000);
  }).catch(function (error) {
    showMessage('inkd could not start', error.message);
  });
}

if (typeof document !== 'undefined' && document.getElementById('tree')) start();
