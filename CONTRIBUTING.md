# Contributing

Thanks for looking. margins is small on purpose, and the most useful
contributions keep it that way.

## Before you start

- **Say you are taking an issue** in its thread, so two people do not write
  the same patch.
- **Keep to one change.** A bug fix and a refactor are two pull requests.

## Setting up

```bash
git clone https://github.com/dheerajjha/margins.git
cd margins && npm install
npm test
node bin/margins.js path/to/some/markdown
```

## House rules

- **No new dependencies** without an issue first. The server uses none, and
  the page uses two. That is a feature people choose it for.
- **Tests never touch the network**, and every file a test reads is written by
  the test. `test/helpers/fixture.js` makes a throwaway folder.
- **Anything that comes from the folder goes into the page as text.** The only
  HTML the page inserts is DOMPurify's output from rendering markdown. A pull
  request that builds markup from a file name, a search result or a heading
  with `innerHTML` will be asked to change, however safe it looks.
- **A security check keeps its test.** If you change one, show that its test
  fails without it.
- The README states the test count; `test/readme.test.js` fails until it
  matches. Count `test(` declarations, not what `node --test` prints.

## Reporting a security problem

Please open a private report through GitHub's security advisories on this
repository rather than a public issue.
