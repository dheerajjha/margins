'use strict';

/**
 * Reading the command line. Pure, so it can be tested without starting
 * anything.
 */

const USAGE = `margins — open a folder of markdown in your browser

Usage:
  margins [path] [options]

Browse, read, edit and search the markdown in a folder, and follow the links
between files, [[wikilinks]] included. Close the tab when you are done and it
stops. Nothing is written into the folder except the files you save.

Arguments:
  path              A folder, or a file inside the folder to open first.
                    Defaults to the current directory.

Options:
  -p, --port <n>    Port to listen on (default 4600; if it is taken, a free
                    one is picked)
      --hidden      Show hidden files and folders (names starting with a dot)
      --no-open     Print the address instead of opening a browser
  -v, --version     Print the version
  -h, --help        Print this

Keys, once it is open:
  Ctrl/Cmd+P  open a file by name      Ctrl/Cmd+Shift+F  search every file
  e           edit this file            Ctrl/Cmd+S        save
  ?           every shortcut
`;

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * @param {string[]} argv the arguments after `margins`
 * @returns {{path: string|null, port: number|null, hidden: boolean, open: boolean, help: boolean, version: boolean}}
 * @throws {UsageError}
 */
function parseArgs(argv) {
  const options = { path: null, port: null, hidden: false, open: true, help: false, version: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-v':
      case '--version':
        options.version = true;
        break;
      case '--hidden':
        options.hidden = true;
        break;
      case '--no-open':
        options.open = false;
        break;
      case '-p':
      case '--port': {
        const value = argv[++i];
        const port = Number(value);
        if (value === undefined || !Number.isInteger(port) || port < 0 || port > 65535) {
          throw new UsageError(`${arg} needs a port number between 0 and 65535.`);
        }
        options.port = port;
        break;
      }
      default:
        if (arg.startsWith('-')) throw new UsageError(`Unknown option: ${arg}`);
        if (options.path !== null) throw new UsageError('Give one folder or file, not several.');
        options.path = arg;
    }
  }
  return options;
}

module.exports = { USAGE, UsageError, parseArgs };
