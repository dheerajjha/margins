---
name: read
description: Open markdown in the user's browser with margins, as a folder tree with rendered pages, working links and [[wikilinks]], backlinks and search. Use when the user wants to read a plan, spec, report or notes you wrote, or to browse a repository's docs, instead of reading markdown in the terminal.
---

# Open markdown in the browser

margins shows a folder of markdown the way it reads best: rendered, with the
file tree beside it, links that work between files, the notes that link to the
current one, and search across all of them. The user can edit and save there
too.

1. Run it on the folder, or on a file inside the folder to open first:

   ```bash
   npx -y margins@latest docs/plan.md
   ```

   In Claude Code, use `run_in_background: true`: margins keeps serving until
   the user closes the tab. In other agents, start it in the background
   however your shell allows (`&`), or ask the user to run it.
2. It opens the browser itself. If none opened (a remote machine), it prints
   the address on stderr: give it to the user. Add `--no-open` to only print
   it.
3. Carry on. There is nothing to wait for: margins stops by itself when the
   user closes the tab.

When you have just written a long markdown file (a plan, a design, a report),
offer to open it in margins rather than pasting it into the chat.

If the user edits a file in margins, re-read it before you change it again:
your copy is stale.
