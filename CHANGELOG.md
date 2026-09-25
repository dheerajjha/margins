# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-25

The first release.

### Added

- `margins [path]` opens a folder of markdown in the browser: a file tree,
  rendered GitHub-flavoured markdown, and the file's outline.
- Links followed the way GitHub reads them and the way Obsidian does:
  relative paths with heading anchors, and `[[wikilinks]]` with headings,
  aliases and image embeds, resolved by name.
- Backlinks: every note lists the notes that link to it.
- Editing with a live preview, and saving that refuses to overwrite a file
  changed on disk since it was opened — by content hash, not timestamp.
- New notes from the sidebar, or by clicking a link to one that does not exist.
- Open a file by name (`Ctrl/Cmd+P`) and search every file
  (`Ctrl/Cmd+Shift+F`).
- The open file follows changes made by other programs.
- A folder link shows the folder and its README, as GitHub does.
- Light and dark themes, following the system.
- Stops when its last tab closes; a reload or a second tab keeps it running.
- Safety for folders you did not write: sanitised rendering under a strict
  Content-Security-Policy, confinement to the folder including through
  symlinks, `.git` and `node_modules` never opened, and refusal of requests
  from other websites or other host names.

[Unreleased]: https://github.com/dheerajjha/margins/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dheerajjha/margins/releases/tag/v0.1.0
