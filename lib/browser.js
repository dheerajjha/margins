'use strict';

const childProcess = require('node:child_process');

/**
 * Opening a URL in the default browser, with no dependency for it.
 * The same approach reviewer uses, and for the same reasons.
 */

function openCommand(platform, url) {
  switch (platform) {
    case 'darwin':
      return { command: 'open', args: [url] };
    case 'win32':
      // `start` is a cmd builtin, and its first quoted argument is the window
      // title -- so an empty one comes first, or the URL is swallowed as it.
      return { command: 'cmd', args: ['/c', 'start', '', url] };
    default:
      return { command: 'xdg-open', args: [url] };
  }
}

/**
 * @returns {Promise<boolean>} whether an opener was launched. A missing
 *   opener fails asynchronously -- spawn does not throw for it -- so this
 *   waits for the 'spawn' event instead of assuming.
 */
function openInBrowser(url, { platform = process.platform, spawn = childProcess.spawn } = {}) {
  const { command, args } = openCommand(platform, url);
  return new Promise(resolve => {
    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true });
      child.on('error', () => resolve(false));
      child.on('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

module.exports = { openCommand, openInBrowser };
