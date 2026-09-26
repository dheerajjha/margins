# Maintaining margins

## Releasing

Releases publish to npm from a `v*` tag, over OIDC trusted publishing. There is
no npm token in this repository and there must not be one.

```bash
npm version <patch|minor|major> --no-git-tag-version   # and move Unreleased in CHANGELOG.md
# PR, green CI, merge; then tag the merge commit:
git tag -a vX.Y.Z -m "X.Y.Z" <merge-sha> && git push origin vX.Y.Z
```

Two guards, both learned on reviewer:

- **CI must be green on the exact commit you tag** — by conclusion, not by
  status. "Completed" includes failures.
- **Verify by installing the published package fresh**, not by reading the
  green tick: `npm install -g margins@X.Y.Z --prefer-online`, then run it.

Docs-only and test-only changes do not need a release of their own.

### The first publish

npm only lets trusted publishing be configured for a package that already
exists, so 0.1.0 has to be published once by the owner, from a logged-in npm:

```bash
git checkout main && npm ci && npm test
npm publish --access public
npx npm@latest trust github margins --file release.yml --repo dheerajjha/margins --allow-publish
```

`npm trust` needs npm 11.15 or newer (hence `npx npm@latest`), two-factor
authentication on the account, and the package to exist -- which the publish
just before it takes care of. No `--env`: the workflow uses no environment, and
the trust record has to match that. The same can be done on npmjs.com, under
the package's Settings, Trusted publishing.

Then push the `v0.1.0` tag. `release.yml` sees 0.1.0 is already on npm and
skips publishing it again, so the tag and the GitHub release exist without a
red run. After that, every release goes through `release.yml` and no one needs
to be logged in. Three things must keep matching the trust record: the repository,
the *file name* `release.yml`, and the absence of an environment.

## Checking a release in a browser

The test suite covers the server and the page's pure logic. Rendering and
sanitising happen in the browser, so before a release, open margins on a
folder containing a hostile markdown file — `<script>`, `onerror`,
`javascript:` links, `<svg onload>`, `<iframe>`, `<form>`, `<style>`, inline
`style` — and confirm nothing runs and the page still reads.
