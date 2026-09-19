# Link Directory

Browse the **outgoing-link structure** of your notes as a directory tree, styled exactly like Obsidian's File Explorer.

A note is a "folder"; the notes it links to are its "files". Expand a note to see what it links to, expand those, and so on. Links are listed in the order they appear in the note, so the tree reflects how you actually wrote your index / MOC / project notes.

## Features

- **Explorer look & feel** — reuses the File Explorer markup (`nav-folder`, `tree-item`, …), so every theme styles it identically. No custom colours.
- **Root = the active note** (default), or **pin** any note as a fixed root. Opening a note *from the tree* never re-roots the tree, so you can browse a subtree without losing your place.
- **Order of appearance** (or by name). Frontmatter links first, then body links and embeds by position.
- **Cycles are safe** — a note that already appears on the current branch is shown with a ↺ marker and cannot be expanded. Click the marker to jump to where it is open.
- **Repeated notes are deduplicated** (cargo-tree style) — the 2nd+ occurrence is shown as a stub with a ⧉ marker. Expand it by hand if you want, or turn deduplication off in settings to see the full subtree under every parent.
- **Lazy expansion** — children are computed only when you expand a node, so large vaults stay fast. No depth limit needed; a node-count limit guards reveal searches.
- **Unresolved links** are shown in italics. Clicking one creates the note (like clicking the link in the editor).
- **Auto-reveal** — with a pinned root, opening a note expands the tree along the shortest link path to it.
- **Click model** — click a name to open it; the chevron expands/collapses. A setting flips this to *click = expand, double-click = open*. Works on mobile (long-press for the context menu).
- **Keyboard** — ↑ ↓ move, → expands, ← collapses / goes to parent, Enter opens.
- Right-click menu: *Set as root*, *Open in new tab*, plus the standard file menu.
- Live updates when notes are edited, renamed or deleted.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Root note | Follow active note | or a fixed vault path |
| Click on a row | Open the note | or expand/collapse with double-click to open |
| Deduplicate repeated notes | on | off = full subtree under every parent |
| Sort children | order of appearance | or by name |
| Include embeds / frontmatter links | on | |
| Show unresolved links | on | click creates the note |
| Auto-reveal active note | on | fixed root only |
| Initial expand depth | 1 | levels opened when the root changes |
| Search limit | 10000 | notes explored during reveal |

## Development

```bash
npm install
npm test          # unit tests for the tree model (vitest)
npm run build     # typecheck + bundle to main.js
npm run deploy    # bundle and copy into test-vault/.obsidian/plugins/link-directory
```

`test-vault/` is a small vault with cycles, a diamond, aliases, embeds, markdown links, an unresolved link and a deep chain. Open it in Obsidian and enable the plugin to try things out.

## Design notes

The design follows conventions found in IDE call hierarchies (IntelliJ), dependency trees (`cargo tree`, Gradle, npm) and research on unfolding graphs into trees:

- cycles are detected by **ancestor path**, not a global visited set (a global set hides diamonds);
- second occurrences are **shown but not expanded**, with a short marker and a legend that appears only when needed;
- reveal follows **one canonical (shortest) path** and highlights every occurrence.
