import { filterLinks, linkKey, type TreeOptions } from "./graph";
import type { ChildLink, LinkSource } from "./types";

/** down = to the next layer; same = within a layer; up = back to a shallower layer. */
export type EdgeKind = "down" | "same" | "up";

export interface GraphNode {
	/** Vault path, or `?target` for a link to a note that does not exist yet. */
	id: string;
	path: string | null;
	target: string;
	display: string;
	/**
	 * Shortest link distance from the root (the layer). For a note outside the
	 * graph (`outside`) its column instead: one before the notes it links to.
	 */
	depth: number;
	/** Nodes one layer up that link here, in discovery order. `parents[0]` is the BFS tree parent. */
	parents: string[];
	/** Note that first linked here (source for creating an unresolved note). */
	via: string | null;
	/** A backlink of the open note that the root does not reach (addBacklinks). */
	outside?: boolean;
}

export interface GraphEdge {
	from: string;
	to: string;
	kind: EdgeKind;
}

export interface LayeredGraph {
	root: string;
	nodes: Map<string, GraphNode>;
	/** Node ids per depth, left to right. */
	layers: string[][];
	/**
	 * Notes outside the graph per column, in order (addBacklinks), drawn apart
	 * from the layers. A column can come before the root's (negative).
	 */
	outside: Map<number, string[]>;
	edges: GraphEdge[];
	/** The walk stopped at `maxNodes`. */
	truncated: boolean;
}

export type LayerOptions = Pick<TreeOptions, "includeEmbeds" | "includeFrontmatter" | "showUnresolved" | "maxNodes">;

/**
 * Lays the outgoing-link graph out in layers by shortest link distance from
 * the root. Every note appears once: a note linked from several notes in the
 * layer above gets one edge from each, so the lines merge instead of the note
 * being repeated.
 *
 * BFS depth guarantees that a link from layer d lands in layer d+1, d, or
 * above — never further down — so no edge skips a layer.
 */
export function buildLayers(src: LinkSource, rootPath: string, opts: LayerOptions): LayeredGraph {
	const nodes = new Map<string, GraphNode>();
	nodes.set(rootPath, {
		id: rootPath,
		path: rootPath,
		target: rootPath,
		display: src.basename(rootPath),
		depth: 0,
		parents: [],
		via: null,
	});
	const layers: string[][] = [[rootPath]];
	const outgoing = new Map<string, ChildLink[]>();
	let truncated = false;

	for (let frontier = [rootPath]; frontier.length > 0; ) {
		const next: string[] = [];
		for (const id of frontier) {
			const node = nodes.get(id) as GraphNode;
			if (node.path === null) continue;
			const links = filterLinks(src.getChildren(node.path), opts);
			outgoing.set(id, links);
			for (const link of links) {
				const cid = linkKey(link);
				if (cid === id || nodes.has(cid)) continue;
				if (nodes.size >= opts.maxNodes) {
					truncated = true;
					continue;
				}
				nodes.set(cid, {
					id: cid,
					path: link.path,
					target: link.target,
					display: link.path ? src.basename(link.path) : link.target,
					depth: node.depth + 1,
					parents: [],
					via: node.path,
				});
				next.push(cid);
			}
		}
		if (next.length > 0) layers.push(next);
		frontier = next;
	}

	// Classify once every depth is final. `outgoing` is in BFS order, so the
	// first parent pushed is the one that discovered the child.
	const edges: GraphEdge[] = [];
	for (const [from, links] of outgoing) {
		const depth = (nodes.get(from) as GraphNode).depth;
		for (const link of links) {
			const to = linkKey(link);
			const child = nodes.get(to);
			if (!child || to === from) continue;
			const kind: EdgeKind = child.depth === depth + 1 ? "down" : child.depth === depth ? "same" : "up";
			if (kind === "down") child.parents.push(from);
			edges.push({ from, to, kind });
		}
	}
	return { root: rootPath, nodes, layers, outside: new Map(), edges, truncated };
}

/** Number of crossing pairs among the down edges between adjacent layers. */
export function countCrossings(g: LayeredGraph): number {
	const pos = positions(g);
	const byLayer = new Map<number, [number, number][]>();
	for (const e of g.edges) {
		if (e.kind !== "down") continue;
		const d = (g.nodes.get(e.from) as GraphNode).depth;
		if (!byLayer.has(d)) byLayer.set(d, []);
		byLayer.get(d)?.push([pos.get(e.from) as number, pos.get(e.to) as number]);
	}
	let total = 0;
	for (const pairs of byLayer.values()) {
		for (let i = 0; i < pairs.length; i++) {
			for (let j = i + 1; j < pairs.length; j++) {
				const [a1, b1] = pairs[i] as [number, number];
				const [a2, b2] = pairs[j] as [number, number];
				if ((a1 - a2) * (b1 - b2) < 0) total++;
			}
		}
	}
	return total;
}

/**
 * Reorders layers 2+ to reduce edge crossings (barycenter heuristic: a few
 * down/up sweeps, keeping the best ordering seen). Layer 1 keeps the root's
 * link order, which is how the author arranged the root note.
 */
export function orderLayers(g: LayeredGraph, sweeps = 4): void {
	const parentsOf = new Map<string, string[]>();
	const childrenOf = new Map<string, string[]>();
	for (const e of g.edges) {
		if (e.kind !== "down") continue;
		push(parentsOf, e.to, e.from);
		push(childrenOf, e.from, e.to);
	}
	const pos = positions(g);

	const reorder = (d: number, neighbourLayer: number, neighbours: Map<string, string[]>) => {
		const layer = g.layers[d] as string[];
		// An empty neighbour layer (focus can leave one) must not turn the order round.
		const scale = Math.max(0, (g.layers[neighbourLayer]?.length ?? 1) - 1) / Math.max(1, layer.length - 1);
		const bary = new Map<string, number>();
		for (const id of layer) {
			const ns = neighbours.get(id) ?? [];
			const own = (pos.get(id) as number) * scale;
			bary.set(id, ns.length > 0 ? ns.reduce((s, n) => s + (pos.get(n) as number), 0) / ns.length : own);
		}
		layer.sort((a, b) => (bary.get(a) as number) - (bary.get(b) as number) || (pos.get(a) as number) - (pos.get(b) as number));
		layer.forEach((id, i) => pos.set(id, i));
	};

	let best = countCrossings(g);
	let bestLayers = g.layers.map((l) => [...l]);
	for (let s = 0; s < sweeps && best > 0; s++) {
		for (let d = 2; d < g.layers.length; d++) reorder(d, d - 1, parentsOf);
		for (let d = g.layers.length - 2; d >= 2; d--) reorder(d, d + 1, childrenOf);
		const c = countCrossings(g);
		if (c < best) {
			best = c;
			bestLayers = g.layers.map((l) => [...l]);
		}
	}
	g.layers = bestLayers;
}

/**
 * Orders layers 1+ into groups: each note sits with the other notes linked
 * from the same note one layer up, in the order that note links them, and the
 * groups follow the layer above. A note linked from several goes with the
 * first of them in the layer above (the top one growing right, the left one
 * growing down). On a whole graph this is the order the walk found the notes
 * in. Returns each note's group (the note it goes with); a note no note in
 * the layer above links to (a focused graph can leave one) has none and goes
 * last.
 */
export function groupLayers(g: LayeredGraph): Map<string, string> {
	const childrenOf = new Map<string, string[]>();
	for (const e of g.edges) if (e.kind === "down") push(childrenOf, e.from, e.to);
	const owners = new Map<string, string>();
	for (let d = 1; d < g.layers.length; d++) {
		const rest = new Set(g.layers[d]);
		const grouped: string[] = [];
		for (const p of g.layers[d - 1] as string[]) {
			for (const c of childrenOf.get(p) ?? []) {
				if (!rest.delete(c)) continue;
				owners.set(c, p);
				grouped.push(c);
			}
		}
		g.layers[d] = [...grouped, ...rest];
	}
	return owners;
}

/**
 * Two background tones (0 and 1) for the groups of one layer, so that groups
 * side by side differ. In layer order, each group takes the tone apart from
 * most of the groups just before its notes in their sub-rows (a wrapped layer
 * can put a group beside several), else the other tone from the group before
 * it. Relies on groupLayers keeping each group together.
 */
export function groupTones(layer: readonly string[], sub: (id: string) => number, owners: Map<string, string>): Map<string, 0 | 1> {
	const tones = new Map<string, 0 | 1>();
	const last = new Map<number, string>();
	let current: string | undefined;
	let vote = 0;
	let prev: 0 | 1 = 1;
	const settle = () => {
		if (current === undefined) return;
		prev = vote > 0 ? 1 : vote < 0 ? 0 : prev === 0 ? 1 : 0;
		tones.set(current, prev);
	};
	for (const id of layer) {
		const owner = owners.get(id);
		if (owner === undefined) continue;
		if (owner !== current) {
			settle();
			current = owner;
			vote = 0;
		}
		const s = sub(id);
		const before = last.get(s);
		if (before !== undefined && before !== owner) vote += tones.get(before) === 0 ? 1 : -1;
		last.set(s, owner);
	}
	settle();
	return tones;
}

/**
 * The part of the graph around a route: the route's notes and every note one
 * of them links to (down, within a layer or back up), the notes `from` (the
 * open note, on the route) reaches by up to `outHops` links, and the notes
 * that reach it by up to `backHops` (its backlinks, theirs, …; negative = any
 * number, 0 = none), or with `backFromRoute` that reach any note on the route,
 * neither walk going on through the route, as `around` colours them. Depths stay as in the full graph, so a row still means a link
 * distance from the root. The route reaches every depth up to its end and a
 * link goes at most one row further, but a backlink can sit any number of rows
 * down: the rows between may then be empty (place() leaves a gap for each).
 */
export function focusOn(
	g: LayeredGraph,
	route: Set<string>,
	from?: string,
	outHops = 1,
	backHops = 0,
	backFromRoute = false,
): LayeredGraph {
	const keep = new Set<string>([g.root, ...route]);
	for (const e of g.edges) if (route.has(e.from)) keep.add(e.to);
	if (from !== undefined && route.has(from)) {
		for (const id of reachFrom(g, from, route, false, outHops).nodes.keys()) keep.add(id);
		for (const id of reachFrom(g, backFromRoute ? route : from, route, true, backHops).nodes.keys()) keep.add(id);
	}
	const nodes = new Map<string, GraphNode>();
	for (const [id, n] of g.nodes) {
		if (keep.has(id)) nodes.set(id, { ...n, parents: n.parents.filter((p) => keep.has(p)) });
	}
	const layers = g.layers.map((l) => l.filter((id) => keep.has(id)));
	while (layers.length > 1 && (layers[layers.length - 1] as string[]).length === 0) layers.pop();
	const outside = new Map([...g.outside].map(([c, ids]) => [c, ids.filter((id) => keep.has(id))] as const));
	const edges = g.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
	return { root: g.root, nodes, layers, outside, edges, truncated: g.truncated };
}

/**
 * Adds the notes the root does not reach that link to `into` (the open note, or
 * every note on the route), the notes that link to those, and so on, up to
 * `hops` links back from the nearest (negative = any number, 0 = none), the
 * walk not going on through a `stop` note (the route), as `around` walks back
 * inside the graph. `full` is the whole graph
 * the root reaches (`g` itself, or what `g` was focused from): a note in it
 * keeps its own place, and is left out when `g` does not show it.
 *
 * A note from outside sits one column before the nearest of the notes it links
 * to on the way back (so a column can come before the root's), in the order of
 * those notes, then by name. Only the links on a shortest way back are added,
 * so they all run forward, one column or more. Returns a new graph.
 */
export function addBacklinks(
	g: LayeredGraph,
	full: LayeredGraph,
	src: LinkSource,
	into: string | Iterable<string>,
	stop: ReadonlySet<string>,
	hops: number,
	opts: LayerOptions,
): LayeredGraph {
	const nodes = new Map(g.nodes);
	const edges = [...g.edges];
	let truncated = g.truncated;
	const starts = idsIn(g, into);
	if (starts.length === 0) return { ...g, nodes, edges };

	const linked = new Map<string, Set<string>>();
	const linksTo = (from: string, to: string) => {
		let set = linked.get(from);
		if (!set) {
			set = new Set(filterLinks(src.getChildren(from), opts).map(linkKey));
			linked.set(from, set);
		}
		return set.has(to);
	};
	// Walk back hop by hop; for each note from outside, the notes a hop nearer it links to.
	const hopOf = new Map<string, number>(starts.map((id) => [id, 0]));
	const found: string[] = [];
	const targets = new Map<string, string[]>();
	for (let frontier = starts, h = 1; frontier.length > 0 && (hops < 0 || h <= hops); h++) {
		const next: string[] = [];
		for (const to of frontier) {
			for (const from of src.backlinks(to)) {
				if (from === to || !linksTo(from, to)) continue;
				const inside = full.nodes.has(from);
				const seen = hopOf.get(from);
				if (seen === undefined) {
					if (!inside && found.length >= opts.maxNodes) {
						truncated = true;
						continue;
					}
					hopOf.set(from, h);
					if (stop.has(from) || (inside && !g.nodes.has(from))) continue;
					next.push(from);
					if (!inside) found.push(from);
				} else if (seen !== h) continue;
				if (!inside) push(targets, from, to);
			}
		}
		frontier = next;
	}

	// Columns in the order found (a note's targets, a hop nearer, already have theirs).
	for (const from of found) {
		const ts = targets.get(from) ?? [];
		const depth = Math.min(...ts.map((t) => (nodes.get(t) as GraphNode).depth)) - 1;
		const name = src.basename(from);
		nodes.set(from, { id: from, path: from, target: name, display: name, depth, parents: [], via: null, outside: true });
		for (const to of ts) edges.push({ from, to, kind: "down" });
	}
	// Each column follows the one after it: by the first place among the notes it links to there.
	const byColumn = new Map<number, string[]>();
	for (const from of found) {
		const c = (nodes.get(from) as GraphNode).depth;
		byColumn.set(c, [...(byColumn.get(c) ?? []), from]);
	}
	const columns = [...byColumn.keys()].sort((a, b) => b - a);
	const outside = new Map<number, string[]>();
	const pos = new Map<string, number>();
	for (const layer of g.layers) layer.forEach((n, i) => pos.set(n, i));
	for (const c of columns) {
		const offset = g.layers[c + 1]?.length ?? 0;
		const key = (n: string) =>
			Math.min(
				...(targets.get(n) ?? [])
					.filter((t) => (nodes.get(t) as GraphNode).depth === c + 1)
					.map((t) => (nodes.get(t)?.outside ? offset : 0) + (pos.get(t) ?? 0)),
			);
		const ids = [...(byColumn.get(c) ?? [])].sort(
			(a, b) => key(a) - key(b) || (nodes.get(a) as GraphNode).display.localeCompare((nodes.get(b) as GraphNode).display),
		);
		ids.forEach((n, i) => pos.set(n, i));
		outside.set(c, ids);
	}
	return { root: g.root, nodes, layers: g.layers, outside, edges, truncated };
}

/** down = rows top to bottom; right = columns left to right. */
export type Direction = "down" | "right";

export interface Point {
	id: string;
	x: number;
	y: number;
	/** Room the node takes along its row. */
	w: number;
	/** Sub-row inside its layer when the layer wrapped (0 = first). */
	sub: number;
}

export interface PlaceOptions {
	direction: Direction;
	/** Main-axis gap from a layer's far side (dots plus names) to the next layer's dots. */
	layerGap: number;
	/** Main-axis gap between the sub-rows of a wrapped layer. */
	subGap: number;
	/** Gap between neighbours in a row (cross axis). */
	gap: number;
	/** Wrap a layer longer than this along its row (0 = never). */
	maxLength: number;
	/** Cross-axis gap between the layers and the notes outside the graph. */
	blockGap?: number;
}

export interface Placement {
	points: Map<string, Point>;
	/** Main-axis coordinate of each column's first sub-row (where lines come in), from column `first` on. */
	starts: number[];
	/** Main-axis coordinate of each column's far side, where its lines leave for the next. */
	ports: number[];
	/** The column of starts[0] and ports[0]: the root's (0), or one before it for notes outside the graph. */
	first: number;
}

/** A row folded into sub-rows to fit `maxLength`, column-major, before it is placed. */
interface Fold {
	ids: string[];
	ws: number[];
	rows: number;
	colW: number[];
	width: number;
	stagger: number;
	extent: number;
}

function foldRow(ids: string[], slot: (id: string) => number, o: PlaceOptions): Fold {
	const ws = ids.map(slot);
	const fold = (rows: number): Fold => {
		const colW: number[] = [];
		for (let c = 0; c < Math.ceil(ids.length / rows); c++) colW.push(Math.max(...ws.slice(c * rows, (c + 1) * rows)));
		const width = colW.reduce((s, w) => s + w, 0) + o.gap * (colW.length - 1);
		const stagger = rows > 1 ? Math.min(...colW) / rows : 0;
		return { ids, ws, rows, colW, width, stagger, extent: width + stagger * (rows - 1) };
	};
	if (ids.length === 0) return { ids, ws, rows: 0, colW: [], width: 0, stagger: 0, extent: 0 };
	// Start from the even split, then add rows until the folded row really
	// fits (columns are as wide as their widest node, so it can overshoot).
	const total = ws.reduce((s, w) => s + w, 0) + o.gap * (ids.length - 1);
	let f = fold(o.maxLength > 0 ? Math.min(ids.length, Math.max(1, Math.ceil(total / o.maxLength))) : 1);
	while (o.maxLength > 0 && f.extent > o.maxLength && f.rows < ids.length) f = fold(f.rows + 1);
	return f;
}

/**
 * Places each layer as a row centred on the cross axis (x when the graph
 * grows down, y when it grows right). `slot(id)` is the room a node takes
 * along its row; `depth(id)` is how far it reaches past its centre in the
 * growth direction (the dot plus its name), so a layer sits only as far from
 * the next as its own names need.
 *
 * A layer longer than `maxLength` wraps column-major into sub-rows:
 * left-to-right order is kept, so a parent's children stay in one block.
 * Sub-rows are staggered so that lines into a lower sub-row pass between the
 * nodes above it.
 *
 * The notes outside the graph (g.outside) go in the same columns, as a block
 * of their own further along the cross axis, clear of every layer (below the
 * graph growing right, beside it growing down), each column's part centred on
 * one line; a column before the root's comes first. A column is as deep as
 * the deeper of its two parts; an empty one is only a gap, so the columns
 * after it still read as further away.
 */
export function place(
	g: LayeredGraph,
	slot: (id: string) => number,
	depth: (id: string) => number,
	o: PlaceOptions,
): Placement {
	const points = new Map<string, Point>();
	const starts: number[] = [];
	const ports: number[] = [];
	const outs = [...g.outside.keys()].filter((c) => (g.outside.get(c) as string[]).length > 0);
	const first = Math.min(0, ...outs);
	const last = Math.max(g.layers.length - 1, ...outs);
	const columns: { main: Fold; out: Fold }[] = [];
	for (let c = first; c <= last; c++) {
		columns.push({ main: foldRow(g.layers[c] ?? [], slot, o), out: foldRow(g.outside.get(c) ?? [], slot, o) });
	}
	// The outside block's centre line: past the widest layer, then half the widest outside part.
	const half = (f: Fold) => f.extent / 2;
	const centre = Math.max(0, ...columns.map((c) => half(c.main))) + (o.blockGap ?? 0) + Math.max(0, ...columns.map((c) => half(c.out)));

	// Places a part from v0 centred on `mid`, returning how deep it reaches.
	const lay = (f: Fold, v0: number, mid: number): number => {
		if (f.rows === 0) return 0;
		// Each sub-row is as deep as its deepest node; the next starts after it.
		const subDepth = new Array<number>(f.rows).fill(0);
		f.ids.forEach((id, i) => {
			const s = i % f.rows;
			subDepth[s] = Math.max(subDepth[s] as number, depth(id));
		});
		const subV: number[] = [v0];
		for (let s = 1; s < f.rows; s++) subV.push((subV[s - 1] as number) + (subDepth[s - 1] as number) + o.subGap);
		let u = mid - f.width / 2 - (f.stagger * (f.rows - 1)) / 2;
		f.colW.forEach((cw, c) => {
			for (let s = 0; s < f.rows; s++) {
				const i = c * f.rows + s;
				const id = f.ids[i];
				if (id === undefined) break;
				const cu = u + cw / 2 + f.stagger * s;
				const cv = subV[s] as number;
				const w = f.ws[i] as number;
				points.set(id, o.direction === "down" ? { id, x: cu, y: cv, w, sub: s } : { id, x: cv, y: cu, w, sub: s });
			}
			u += cw + o.gap;
		});
		return (subV[f.rows - 1] as number) + (subDepth[f.rows - 1] as number) - v0;
	};

	let v0 = 0;
	for (const { main, out } of columns) {
		const reach = Math.max(lay(main, v0, 0), lay(out, v0, centre));
		starts.push(v0);
		ports.push(v0 + reach);
		v0 += main.rows + out.rows === 0 ? o.layerGap : reach + o.layerGap;
	}
	return { points, starts, ports, first };
}

export function edgeKey(from: string, to: string): string {
	return `${from}\u0000${to}`;
}

export interface Highlight {
	/** Every node on some shortest path from the root to the target. */
	nodes: Set<string>;
	/** Every edge on some shortest path (edgeKey). */
	edges: Set<string>;
}

/**
 * All shortest paths from the root to `id`, or null when the root cannot
 * reach it. They are all equally short, so none of them comes first.
 */
export function pathToRoot(g: LayeredGraph, id: string): Highlight | null {
	if (!g.nodes.has(id)) return null;
	const nodes = new Set<string>([id]);
	const edges = new Set<string>();
	for (const stack = [id]; stack.length > 0; ) {
		const n = g.nodes.get(stack.pop() as string) as GraphNode;
		for (const p of n.parents) {
			edges.add(edgeKey(p, n.id));
			if (!nodes.has(p)) {
				nodes.add(p);
				stack.push(p);
			}
		}
	}
	return { nodes, edges };
}

export interface Reach {
	/** Every note `id` reaches by links, with how many links away it is (stop notes left out). */
	nodes: Map<string, number>;
	/** Every link on a shortest way there (edgeKey), with the hop it arrives at. */
	edges: Map<string, number>;
}

/**
 * Everything `id` reaches by following links (down, within a row or back up),
 * in hops from `id`, up to `max` hops (negative = any number, 0 = none). `id`
 * is one note, or several walked from at once, the hops then counting from
 * the nearest. With `back` the links are followed the other way: the notes
 * that link to `id`, the notes that link to those, and so on (its backlinks),
 * the links keeping their own direction (edgeKey from → to). A link into a
 * note already reached at the same hop is kept, so the lines merge as in the
 * layers. The walk goes into a `stop` note but not on from it: stopping at
 * the route to `id` keeps a link back to the root from pulling in the whole
 * graph. Stop notes keep their
 * own colour, so only the links between them and the walk are returned.
 */
export function reachFrom(
	g: LayeredGraph,
	id: string | Iterable<string>,
	stop: ReadonlySet<string> = new Set(),
	back = false,
	max = -1,
): Reach {
	const nodes = new Map<string, number>();
	const edges = new Map<string, number>();
	const starts = idsIn(g, id);
	if (starts.length === 0) return { nodes, edges };
	const next = new Map<string, string[]>();
	for (const e of g.edges) {
		if (back) push(next, e.to, e.from);
		else push(next, e.from, e.to);
	}
	const hops = new Map<string, number>(starts.map((n) => [n, 0]));
	for (let frontier = starts, h = 1; frontier.length > 0 && (max < 0 || h <= max); h++) {
		const found: string[] = [];
		for (const from of frontier) {
			for (const to of next.get(from) ?? []) {
				const seen = hops.get(to);
				if (seen === undefined) {
					hops.set(to, h);
					if (!stop.has(to)) {
						nodes.set(to, h);
						found.push(to);
					}
				} else if (seen !== h) continue;
				edges.set(back ? edgeKey(to, from) : edgeKey(from, to), h);
			}
		}
		frontier = found;
	}
	return { nodes, edges };
}

export interface Around {
	/** What the open note reaches by its links (outgoing links, theirs, …). */
	out: Reach;
	/** What reaches the open note, or any note on the route (backlinks, theirs, …). */
	back: Reach;
}

/**
 * The open note's surroundings, as coloured: what `id` reaches by links up to
 * `outHops` and what reaches it up to `backHops` (negative = any number, 0 =
 * none), or with `backFromRoute` what reaches any note on the route, counted
 * from the nearest; neither walk goes on through the route. A note or link
 * both walks find (a cycle through the open note) goes with the nearer of the
 * two, the outgoing one on a tie, so it has one colour and one number of hops.
 * The route's own links stay the route's: the notes linking down to `id` are
 * its backlinks too, but they are on the route.
 */
export function around(g: LayeredGraph, id: string, route: Highlight, outHops: number, backHops: number, backFromRoute = false): Around {
	const out = reachFrom(g, id, route.nodes, false, outHops);
	const back = reachFrom(g, backFromRoute ? route.nodes : id, route.nodes, true, backHops);
	for (const [o, b] of [
		[out.nodes, back.nodes],
		[out.edges, back.edges],
	] as const) {
		for (const [key, hb] of b) {
			const ho = o.get(key);
			if (ho === undefined) continue;
			if (ho <= hb) b.delete(key);
			else o.delete(key);
		}
	}
	for (const key of route.edges) {
		out.edges.delete(key);
		back.edges.delete(key);
	}
	return { out, back };
}

/** The notes of `ids` (one, or several) that `g` has. */
function idsIn(g: LayeredGraph, ids: string | Iterable<string>): string[] {
	return (typeof ids === "string" ? [ids] : [...ids]).filter((id) => g.nodes.has(id));
}

function positions(g: LayeredGraph): Map<string, number> {
	const pos = new Map<string, number>();
	for (const layer of g.layers) layer.forEach((id, i) => pos.set(id, i));
	return pos;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}
