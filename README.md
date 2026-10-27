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
- The header buttons switch direction, names, groups, focus, the hops, which backlinks are coloured (the open note's or the route's) and the flowing light on the spot.
- **Colours**: the tree graph tab alone can be light or dark, whatever Obsidian's theme. The header button (sun / moon) flips it; flipping back to Obsidian's colours follows Obsidian again. The setting *Colours* offers Follow Obsidian, Light and Dark. Other tabs keep Obsidian's colours.
- **Name length**: a slider in the header (and the setting *Name length*) sets how many characters of a name are shown before the rest is cut short with "…" (4–60, default 10). Each layer sits only as far from the next as its own longest name, so the layers draw closer or apart as you drag; the view keeps its place, and the value is saved when you let go.
- Links **within a row** or **back up** to a shallower row are always drawn, but thin and dashed with an arrowhead, so they read as secondary. A link back up comes in past the names of the target's row (bowed, so it does not hide under a down link between the same two notes), then runs straight on behind the target's name to its dot; there it lies along the target's own outgoing lines, which leave the dot the same way.
- The **routes from the root to the open note** stand out by colour strength as well as width: every shortest route thick in the full accent colour, its dots and names too (the names in a near-black purple edged in white, as the route runs under them), all alike since they are equally short, and the remaining lines step back. The open note's name is marked like the current file in the File Explorer, and the graph pans to it when it is off screen (auto-reveal).
- **Around the open note**, two more colours, so the route, where the note leads and what leads to it read apart: its **outgoing links** (the notes it links to, the notes those link to, and so on, in any row) take the accent turned a third of the way round the colour wheel, and its **backlinks** (the notes that link to it, the notes that link to those, and so on) the accent turned a third of the way the other way. The outgoing links are coloured all the way while every note is shown, and as far as the hops chosen beside the focus button while it is on (→: none, 1–5 or all; 1 by default). The backlinks are coloured as far as the hops chosen in the header (←, the same choices), focus on or off. The route button beside them (or *Backlink colour* in the settings) colours the backlinks of **every note on the route** instead, the root's too, each counted from the nearest note on the route. (Every note shown has its backlinks drawn that far, below; these are the ones coloured.) Each hop further is paler and thinner (1, 2, 3, then 4 and more share the last shade), so the legend's numbers read as "this many links away"; pointing at a note shows its hops. *Hops in the dots* in the settings (off by default: a note found several ways shows only one number, which can mislead) also writes them in the dots, a little larger (in black or white, whichever reads on its shade). Neither walk goes on through the route: a link back to the root is coloured, but what the root links to is not, or a note that links back to TOP would colour the whole graph; the notes linking down to the open note are its backlinks too, but they keep the route's colour. A note both walks find (a loop through the open note) takes the nearer, the outgoing one on a tie. A CSS snippet can set `--ldg-link` and `--ldg-back` on `.ldg` to choose other colours.
- A short **light runs along each coloured line**, from base to tip, so the direction reads at a glance. On the paler links and the dashed ones, where white hardly shows, it is the link colour at full strength instead, a little thicker than those thin lines (still thinner than the route's light). It passes under the dots and names as the lines do. It runs whatever the system's reduced-motion setting; turn it off with the header button (sparkles) or in the settings. At most 150 lines carry it, the route first.
- **Backlinks of every note shown**, as far as the backlinks' hops: inside the graph every link is drawn already (focus keeps these backlinks too, below), and a note the root cannot reach that links to a note shown (or to one of its backlinks, as far as the hops chosen) is drawn too, in a block of its own below the graph (to its right when the graph grows down), each a column before the note it links to, as in a sketch of where the links come from: one link back sits a column before the note it links to, two links back two columns before, and so on, before the root's column if need be (always, when the root follows the open note, or for a link to the root). Each is tied by a line to every note drawn that it links to, the links on a shortest way back running forward. Those leading to the open note (or to the route) take the backlink colour; the rest are drawn as the graph's other links are (grey; within a column or back, thin and dashed with an arrowhead). Opening one from the graph keeps the colours (it is marked as the open note among them).
- **Focus** (header button, or *Only the route and its links* in the settings) hides every note that is neither on a route from the root to the open note nor linked from a note on it, and lays the rest out again: a large graph shrinks to the path and what branches off it. The open note's outgoing links stay too, as far as the hops chosen beside the button, and then the backlinks of every note kept, as far as theirs: the notes shown as links bring theirs as the route's notes do. Rows keep their link distance: a backlink from far down stays in its own row, and a row focus empties in between is left as a gap. Without a route (no note open, or one the root cannot reach) it shows the root, its links and their backlinks; the legend counts the hidden notes.
- **Search** (the box under the header buttons): a part of a note's name, or `#tag` (a tag starting so: `#pro` finds `#project` and `#project/a`, `#` alone any tag); several words must all match, e.g. `meeting #project`. Each hit gets a ring round its dot and its name on Obsidian's yellow (shown even when only the route's names are), as do the hits among the unreachable notes listed below; the accent is left to the route. Beside the box: how many, and how many of them focus hides. Enter pans to the next hit, Shift+Enter to the one before.
- Notes in the root's folder (or a folder you choose) that the root **cannot reach** are listed under the graph, newest first (those drawn as backlinks too). Opening one that is not drawn shows a notice and highlights it in the list; no route is drawn.
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
| Tree graph → Hops of backlinks | 1 | how far the links into every note shown are followed (none, 1–5, or all), focus on or off, notes the root cannot reach included; also in the header |
| Tree graph → Backlink colour | the open note | which backlinks are coloured: those to the open note, or to every note on the route, the root's too (hops from the nearest); also the header button beside the backlinks' hops |
| Tree graph → Only the route and its links | off | hide notes off the route, the notes it links to, and the hops chosen |
| Tree graph → Hops from the open note: outgoing links | 1 | with the above on: how far the open note's own links are followed (none, 1–5, or all); off, every hop is coloured; also in the header |
| Tree graph → Hops in the dots | off | write each coloured note's hops in its dot (they show on hover either way) |
| Tree graph → Flowing light on the coloured lines | on | runs even with the system's reduced motion; also the header button |

## Development

```bash
npm install
npm test          # unit tests for the tree model (vitest)
npm run build     # typecheck + bundle to main.js
npm run deploy    # bundle and copy into test-vault/.obsidian/plugins/link-directory
```

To release, bump the version in `manifest.json`, `package.json` and `versions.json`, then push an annotated tag named after it (`git tag -a 0.9.0 --cleanup=verbatim -F notes.md && git push origin 0.9.0`), or run the *Release* workflow by hand (Actions → Release → Run workflow) with the version and the notes: it tests, builds and publishes `main.js`, `manifest.json` and `styles.css`, with the tag's message (or the notes given) as the release notes.

`test-vault/` is a small vault with cycles, a diamond, aliases, embeds, markdown links, an unresolved link and a deep chain. Open it in Obsidian and enable the plugin to try things out. `test-vault/tg/` is the tree-graph scenario: root `根`, four branches, leaves that merge from up to four branches, a same-row link, a link back to the root, an unresolved link, a long name, two notes the root cannot reach, tags to search for (`#葉`, `#project`, `#project/alpha`), a note four rows down (`最も深い葉`) linking back up to `枝B` (open `枝B` with focus on to see a backlink across an emptied row), and three notes the root cannot reach linking back to `葉3` one after another (`外から1` → `葉3`, `外から2` → `外から1`, `外から3` → `外から2`): open `葉3` to see them below the graph, the last before the root's column. `根を外から` links to the root: open `葉1` to see it before the root's column, with `落ち葉2` (→ `枝A` and `葉5`) and `外から1` (→ `葉3`, a note shown as a link), all grey; switch the colour to the whole route and `根を外から`, `落ち葉2` → `枝A` and `葉3` → `枝A` take the backlink colour, `落ち葉2` → `葉5` staying grey. `test-vault/tgw/` is the wide one: root `幹`, six branches, 90 notes in row 2 and 36 in row 3, for checking wrapping and the two directions.

## Design notes

The design follows conventions found in IDE call hierarchies (IntelliJ), dependency trees (`cargo tree`, Gradle, npm) and research on unfolding graphs into trees:

- cycles are detected by **ancestor path**, not a global visited set (a global set hides diamonds);
- second occurrences are **shown but not expanded**, with a short marker and a legend that appears only when needed;
- reveal follows **one canonical (shortest) path** and highlights every occurrence.

The tree graph is a layered (Sugiyama-style) drawing with the layers fixed by BFS depth. Because a link from row d can only land in row d+1, d or above, no edge skips a row, so no dummy nodes are needed; the only layout work is ordering each row. With groups on, each row follows the one above: a note goes with the first note above that links to it, in that note's link order (on the whole graph, the order the walk found the notes in), so the lines into one group never cross another group's. Off, rows are ordered to reduce crossings (barycenter sweeps, keeping the best), and row 1 keeps the root's link order. A long row wraps column-major (order kept, a parent's children stay in one block), with sub-rows staggered so lines reach the lower ones between the dots above; rows are added until the folded row really fits the limit. Layers are spaced by how far their names reach (`place()` takes a per-node depth and returns where each layer starts and where its lines leave).

Around the open note are two breadth-first walks from it, one along the links and one against them (`reachFrom(…, back)`), each cut at its own hops and stopped at the route (`around()`); a note or link both reach goes with the nearer, so each has one colour and one number. For the route's backlinks the walk against the links starts from every note on the route at once, so a hop counts from the nearest of them and the route's own links are never walked. What is drawn is decided apart from the colours: every note the root reaches, or with focus `focusCore()` (the route, its links and the open note's outgoing hops), then the backlinks of all of those, walked from all of them at once (`focusOn()` keeps those inside the graph). That walk goes on past the graph's notes into the vault (Obsidian's resolved links, each checked against the link filters), and `addBacklinks()` adds the notes it finds there, each in the column before the nearest note it links to on the way (so the columns can start before the root's), ordered by the notes they link to in the next column, and then tied to every other note drawn that they link to; `place()` lays them out per column as a second block along the cross axis, past the widest layer, a column as deep as the deeper of its two parts. A backlink inside the graph can sit any number of rows below the open note, so a focused graph can have empty rows between; `place()` leaves a gap for each, and the crossing sweeps treat an empty neighbour row as no pull either way.

A tab of its own colours: Obsidian sets a theme's base colours on `.theme-light` / `.theme-dark`, which works on any element, but derives the rest (`--background-primary: var(--color-base-00)`, the text colour, …) on `body`, where they are resolved once and inherited as they are. So the tab gets the theme class, and the declarations of body's rules that use `var()` are repeated under `:where(.ldg-themed)` (rebuilt when the CSS changes), to be resolved again from the tab's own base colours. A theme that writes colours for `body.theme-dark` only is not followed.

The flowing light is a set of short HTML strips between two SVGs (lines below, dots and names above), each moved by `transform` / `opacity` keyframes sampled along its line, so the compositor runs it without repainting anything: about 3% of one core for 18 lines on a desktop, against five times that for a dash animated inside the SVG, which repaints the whole graph every frame.
