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

## Tree graph

A second view (ribbon icon *network*, command **Open tree graph**) draws the same links as a graph seen from one root note:

- **Root = the active note** (default): the graph redraws from each note you open. A note opened *from the graph* keeps the root, so you can follow a route. **Pin** (header button, or *Set as tree graph root*) fixes a root such as `note/TOP.md`; the list of unreachable notes appears only with a pinned root.

- **One row per link distance** from the root (shortest path). Every note appears **once**; a note linked from several notes in the row above gets a line from each, so the lines merge instead of the note being repeated.
- Notes are **dots**, coloured like the core Graph view. **Names**: every note, or only the route from the root to the open note (others on hover). A faint band behind each row shows where a row begins and ends.
- **Groups**: the notes linked from the same note one row up sit together, in the order that note links them, each group on a grey background, a darker and a paler grey in turn, so groups side by side differ (in a wrapped row a small group can sit beside several, and two of one grey may then meet). A note linked from several goes with the first of them in the row above: the top one left to right, the left one top to bottom. The header button (or *Group by linking note* in the settings) turns this off; rows are then ordered to cross fewer lines.
- **Direction**: top to bottom, or left to right (names beside the dots — the readable choice when rows get long). Each layer sits only as far from the next as its own longest name needs; lines run out past the names, bend only in the gap between layers, and run straight in to their dot, so they do not cross other names.
- **Long rows wrap**: a row longer than the limit (default 1200 px) folds into several rows, keeping its order, so the graph stays within a screen's width.
- The header buttons switch direction, names, groups and the flowing light on the spot.
- **Colours**: the tree graph tab alone can be light or dark, whatever Obsidian's theme. The header button (sun / moon) flips it; flipping back to Obsidian's colours follows Obsidian again. The setting *Colours* offers Follow Obsidian, Light and Dark. Other tabs keep Obsidian's colours.
- **Name length**: a slider in the header (and the setting *Name length*) sets how many characters of a name are shown before the rest is cut short with "…" (4–60, default 10). Each layer sits only as far from the next as its own longest name, so the layers draw closer or apart as you drag; the view keeps its place, and the value is saved when you let go.
- Links **within a row** or **back up** to a shallower row are always drawn, but thin and dashed with an arrowhead, so they read as secondary.
- The **routes from the root to the open note** stand out by colour strength as well as width: every shortest route thick in the full accent colour, its dots and names too (the names in a near-black purple edged in white, as the route runs under them), all alike since they are equally short, and the remaining lines step back. The open note's name is marked like the current file in the File Explorer, and the graph pans to it when it is off screen (auto-reveal).
- **Everything the open note reaches by links** (the notes it links to, the notes those link to, and so on, in any row) takes a second colour, the accent turned a third of the way round the colour wheel, so where the note leads reads apart from the route coming in. Each hop further is paler and thinner (1, 2, 3, then 4 and more share the last shade), so the legend's numbers read as "this many links away", and each of those dots, a little larger, carries its own number of hops (in black or white, whichever reads on its shade). The walk does not go on through the route: a link back to the root is coloured, but what the root links to is not, or a note that links back to TOP would colour the whole graph. A CSS snippet can set `--ldg-link` on `.ldg` to choose another colour.
- A short **light runs along each coloured line**, from base to tip, so the direction reads at a glance. On the paler links and the dashed ones, where white hardly shows, it is the link colour at full strength instead, a little thicker than those thin lines (still thinner than the route's light). It passes under the dots and names as the lines do. It runs whatever the system's reduced-motion setting; turn it off with the header button (sparkles) or in the settings. At most 150 lines carry it, the route first.
- **Focus** (header button, or *Only the route and its links* in the settings) hides every note that is neither on a route from the root to the open note nor linked from a note on it, and lays the rest out again: a large graph shrinks to the path and what branches off it. Beside the button, choose how far to follow the open note's own links: 1 hop (the notes it links to), up to 5, or all hops; the notes it reaches that far stay too, walked as the colours are (not on through the route). Rows keep their link distance. Without a route (no note open, or one the root cannot reach) it shows the root and its links; the legend counts the hidden notes.
- Notes in the root's folder (or a folder you choose) that the root **cannot reach** are listed under the graph, newest first. Opening one shows a notice and highlights it in the list; no route is drawn.
- Drag to pan, wheel or pinch to zoom, the *Fit* button shows everything. Click a node to open it beside the graph, in the tab you used last, whatever it shows (a note, a drawing, a base, a new tab), as the File Explorer does; a pinned tab is kept and the note opens in a new tab beside it, and Ctrl/Cmd-click opens a new tab. Click an unresolved node to create the note. Right-click / long-press: *Set as tree graph root*, *Open in new tab*, file menu.
- It opens in a split next to your notes, so the highlight follows you as you navigate.

## Installation

- **BRAT**: install [BRAT](https://github.com/TfTHacker/obsidian42-brat), run *BRAT: Add a beta plugin for testing* and enter `6r1ntry52o/obsidian-link-directory`.
- **Manual**: download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/link-directory/`, then enable *Link Directory* under Community plugins.

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
| Search limit | 10000 | notes explored during reveal, and in the tree graph |
| Tree graph → Root note | Follow active note | or a fixed note |
| Tree graph → Fixed root path | (empty) | fixed root only |
| Tree graph → Folder for unreachable notes | (empty) | fixed root only; empty = the root note's folder |
| Tree graph → Direction | top to bottom | or left to right |
| Tree graph → Note names | every note | or route only (others on hover) |
| Tree graph → Name length | 10 | characters shown before "…" (4–60); also in the header |
| Tree graph → Wrap long rows (px) | 1200 | 0 = never wrap |
| Tree graph → Group by linking note | on | notes linked from the same note together, on a grey background; off = ordered to cross fewer lines |
| Tree graph → Colours | Follow Obsidian | or light / dark for the tree graph tab alone; also the header button |
| Tree graph → Only the route and its links | off | hide notes off the route and the notes it links to |
| Tree graph → Hops from the open note | 1 | with the above on: also the notes the open note reaches by this many links (1–5, or all) |
| Tree graph → Flowing light on the coloured lines | on | runs even with the system's reduced motion; also the header button |

## Development

```bash
npm install
npm test          # unit tests for the tree model (vitest)
npm run build     # typecheck + bundle to main.js
npm run deploy    # bundle and copy into test-vault/.obsidian/plugins/link-directory
```

`test-vault/` is a small vault with cycles, a diamond, aliases, embeds, markdown links, an unresolved link and a deep chain. Open it in Obsidian and enable the plugin to try things out. `test-vault/tg/` is the tree-graph scenario: root `根`, four branches, leaves that merge from up to four branches, a same-row link, a link back to the root, an unresolved link, a long name, and two notes the root cannot reach. `test-vault/tgw/` is the wide one: root `幹`, six branches, 90 notes in row 2 and 36 in row 3, for checking wrapping and the two directions.

## Design notes

The design follows conventions found in IDE call hierarchies (IntelliJ), dependency trees (`cargo tree`, Gradle, npm) and research on unfolding graphs into trees:

- cycles are detected by **ancestor path**, not a global visited set (a global set hides diamonds);
- second occurrences are **shown but not expanded**, with a short marker and a legend that appears only when needed;
- reveal follows **one canonical (shortest) path** and highlights every occurrence.

The tree graph is a layered (Sugiyama-style) drawing with the layers fixed by BFS depth. Because a link from row d can only land in row d+1, d or above, no edge skips a row, so no dummy nodes are needed; the only layout work is ordering each row. With groups on, each row follows the one above: a note goes with the first note above that links to it, in that note's link order (on the whole graph, the order the walk found the notes in), so the lines into one group never cross another group's. Off, rows are ordered to reduce crossings (barycenter sweeps, keeping the best), and row 1 keeps the root's link order. A long row wraps column-major (order kept, a parent's children stay in one block), with sub-rows staggered so lines reach the lower ones between the dots above; rows are added until the folded row really fits the limit. Layers are spaced by how far their names reach (`place()` takes a per-node depth and returns where each layer starts and where its lines leave).

A tab of its own colours: Obsidian sets a theme's base colours on `.theme-light` / `.theme-dark`, which works on any element, but derives the rest (`--background-primary: var(--color-base-00)`, the text colour, …) on `body`, where they are resolved once and inherited as they are. So the tab gets the theme class, and the declarations of body's rules that use `var()` are repeated under `:where(.ldg-themed)` (rebuilt when the CSS changes), to be resolved again from the tab's own base colours. A theme that writes colours for `body.theme-dark` only is not followed.

The flowing light is a set of short HTML strips between two SVGs (lines below, dots and names above), each moved by `transform` / `opacity` keyframes sampled along its line, so the compositor runs it without repainting anything: about 3% of one core for 18 lines on a desktop, against five times that for a dash animated inside the SVG, which repaints the whole graph every frame.
