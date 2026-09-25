#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { USAGE, UsageError, parseArgs } = require('../lib/cli');
const { openInBrowser } = require('../lib/browser');
const { DEFAULT_HOST, DEFAULT_PORT, displayPath, startServer } = require('../server');
const { MARKDOWN_EXTENSIONS } = require('../lib/files');
const { version } = require('../package.json');

/** Everything said to the person running it goes to stderr; stdout stays clean. */
function note(line = '') {
  process.stderr.write(`${line}\n`);
}

/**
 * What to serve and what to open first, from the path given.
 *
 * A file means its folder, opened on that file. A folder means itself,
 * opened on its README or index if it has one -- the page a person would
 * start from on GitHub.
 */
async function resolveTarget(given) {
  const target = path.resolve(given ?? '.');
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    throw new UsageError(`Nothing at ${given ?? target}.`);
  }

  if (stat.isFile()) {
    return { root: path.dirname(target), initial: path.basename(target) };
  }

  const names = await fs.readdir(target);
  const start = ['readme', 'index']
    .flatMap(stem => [...MARKDOWN_EXTENSIONS].map(ext => stem + ext))
    .map(wanted => names.find(name => name.toLowerCase() === wanted))
    .find(Boolean);
  return { root: target, initial: start ?? null };
}

async function listen(port, options) {
  try {
    return await startServer({ ...options, port, host: DEFAULT_HOST });
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    note(`Port ${port} is in use, picking another.`);
    return startServer({ ...options, port: 0, host: DEFAULT_HOST });
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (options.version) {
    process.stdout.write(`${version}\n`);
    return;
  }

  const { root, initial } = await resolveTarget(options.path);

  let server;
  const stop = () => {
    server?.close(() => process.exit(0));
    // Do not wait forever on a browser holding a connection open.
    setTimeout(() => process.exit(0), 1500).unref();
  };

  server = await listen(options.port ?? (Number(process.env.PORT) || DEFAULT_PORT), {
    root,
    initial,
    hidden: options.hidden,
    onIdle: () => {
      note('\n  Browser closed. Stopping.\n');
      stop();
    }
  });

  const url = `http://${DEFAULT_HOST}:${server.address().port}/`;
  note(`\n  inkd  ${url}`);
  note(`  folder   ${displayPath(server.realRoot)}`);
  note('\n  Close the tab when you are done, or press Ctrl+C.\n');

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  if (options.open && !(await openInBrowser(url))) {
    note('  Could not open a browser; open the address above yourself.\n');
  }
}

main(process.argv.slice(2)).catch(error => {
  if (error instanceof UsageError) {
    note(`inkd: ${error.message}`);
    note('Run inkd --help for usage.');
    process.exit(2);
  }
  note(`inkd: ${error.message}`);
  process.exit(1);
});
