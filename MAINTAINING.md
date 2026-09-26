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

### How 0.1.0 was published

npm only lets trusted publishing be configured for a package that already
exists, so 0.1.0 was published once by hand, from the owner's npm account, on
2026-09-26. The trust record was added straight after:

```bash
npx npm@latest trust github margins --file release.yml --repo dheerajjha/margins --allow-publish
```

`npm trust` needs npm 11.15 or newer (hence `npx npm@latest`) and two-factor
authentication on the account. There is no `--env`: the workflow uses no
environment, and the record has to match that. Three things must keep matching
it or the next release is rejected at publish: the repository
`dheerajjha/margins`, the *file name* `release.yml`, and the absence of an
environment. Renaming the repository or the workflow, or adding an
environment, means changing the record first, on npmjs.com under the package's
Settings, Trusted publishing.

The `v0.1.0` tag is on `ae8f18f`, the commit npm recorded as the package's
`gitHead`, not on the tip of `main` when it was pushed. Its release run found
0.1.0 already on npm and skipped the publish. Every release after it goes
through `release.yml`. 0.1.1 was the first, the same day: its publish log shows
the signed provenance statement and `+ margins@0.1.1`, and a fresh install from
npm passed the browser checks below.

### Before renaming the package

For most of a day the project was called `inkd`. `npm view inkd` answered 404,
and npm still refused the publish with a 403: "Package name too similar to
existing packages". That check runs only when you publish, so a 404 does not
mean a name is free. Publish under a new name before renaming the repository,
the docs and the issues to match it.

## Checking a release in a browser

The test suite covers the server and the page's pure logic. Rendering and
sanitising happen in the browser, so before a release, open margins on a
folder containing a hostile markdown file — `<script>`, `onerror`,
`javascript:` links, `<svg onload>`, `<iframe>`, `<form>`, `<style>`, inline
`style` — and confirm nothing runs and the page still reads.
