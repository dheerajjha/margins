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
npm publish --access public          # from a clean checkout of the v0.1.0 tag
npm trust github margins --file release.yml --repository dheerajjha/margins
```

After that, every release goes through `release.yml` and no one needs to be
logged in. Three things must keep matching the trust record: the repository,
the *file name* `release.yml`, and the absence of an environment.

## Checking a release in a browser

The test suite covers the server and the page's pure logic. Rendering and
sanitising happen in the browser, so before a release, open margins on a
folder containing a hostile markdown file — `<script>`, `onerror`,
`javascript:` links, `<svg onload>`, `<iframe>`, `<form>`, `<style>`, inline
`style` — and confirm nothing runs and the page still reads.
