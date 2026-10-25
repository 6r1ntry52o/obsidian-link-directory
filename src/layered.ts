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
	/** Shortest link distance from the root. */
	depth: number;
	/** Nodes one layer up that link here, in discovery order. `parents[0]` is the BFS tree parent. */
	parents: string[];
	/** Note that first linked here (source for creating an unresolved note). */
	via: string | null;
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
	return { root: rootPath, nodes, layers, edges, truncated };
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
		const scale = ((g.layers[neighbourLayer]?.length ?? 1) - 1) / Math.max(1, layer.length - 1);
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
 * The part of the graph around a route: the route's notes and every note one
 * of them links to (down, within a layer or back up). Depths stay as in the
 * full graph, so a row still means a link distance from the root; the route
 * reaches every depth up to its end, so no row in between goes empty.
 */
export function focusOn(g: LayeredGraph, route: Set<string>): LayeredGraph {
	const keep = new Set<string>([g.root, ...route]);
	for (const e of g.edges) if (route.has(e.from)) keep.add(e.to);
	const nodes = new Map<string, GraphNode>();
	for (const [id, n] of g.nodes) {
		if (keep.has(id)) nodes.set(id, { ...n, parents: n.parents.filter((p) => keep.has(p)) });
	}
	const layers = g.layers.map((l) => l.filter((id) => keep.has(id)));
	while (layers.length > 1 && (layers[layers.length - 1] as string[]).length === 0) layers.pop();
	const edges = g.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
	return { root: g.root, nodes, layers, edges, truncated: g.truncated };
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
}

export interface Placement {
	points: Map<string, Point>;
	/** Main-axis coordinate of each layer's first sub-row (where lines come in). */
	starts: number[];
	/** Main-axis coordinate of each layer's far side, where its lines leave for the next layer. */
	ports: number[];
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
	let v0 = 0;
	for (const layer of g.layers) {
		const ws = layer.map(slot);
		const fold = (rows: number) => {
			const colW: number[] = [];
			for (let c = 0; c < Math.ceil(layer.length / rows); c++) colW.push(Math.max(...ws.slice(c * rows, (c + 1) * rows)));
			const width = colW.reduce((s, w) => s + w, 0) + o.gap * (colW.length - 1);
			const stagger = rows > 1 ? Math.min(...colW) / rows : 0;
			return { rows, colW, width, stagger, extent: width + stagger * (rows - 1) };
		};
		// Start from the even split, then add rows until the folded row really
		// fits (columns are as wide as their widest node, so it can overshoot).
		const total = ws.reduce((s, w) => s + w, 0) + o.gap * (layer.length - 1);
		let f = fold(o.maxLength > 0 ? Math.min(layer.length, Math.max(1, Math.ceil(total / o.maxLength))) : 1);
		while (o.maxLength > 0 && f.extent > o.maxLength && f.rows < layer.length) f = fold(f.rows + 1);
		const { rows, colW, width, stagger } = f;

		// Each sub-row is as deep as its deepest node; the next starts after it.
		const subDepth = new Array<number>(rows).fill(0);
		layer.forEach((id, i) => {
			const s = i % rows;
			subDepth[s] = Math.max(subDepth[s] as number, depth(id));
		});
		const subV: number[] = [v0];
		for (let s = 1; s < rows; s++) subV.push((subV[s - 1] as number) + (subDepth[s - 1] as number) + o.subGap);

		let u = -width / 2 - (stagger * (rows - 1)) / 2;
		colW.forEach((cw, c) => {
			for (let s = 0; s < rows; s++) {
				const i = c * rows + s;
				const id = layer[i];
				if (id === undefined) break;
				const cu = u + cw / 2 + stagger * s;
				const cv = subV[s] as number;
				const w = ws[i] as number;
				points.set(id, o.direction === "down" ? { id, x: cu, y: cv, w, sub: s } : { id, x: cv, y: cu, w, sub: s });
			}
			u += cw + o.gap;
		});
		const port = (subV[rows - 1] as number) + (subDepth[rows - 1] as number);
		starts.push(v0);
		ports.push(port);
		v0 = port + o.layerGap;
	}
	return { points, starts, ports };
}

export function edgeKey(from: string, to: string): string {
	return `${from}\u0000${to}`;
}

export interface Highlight {
	/** Every node on some shortest path from the root to the target. */
	nodes: Set<string>;
	/** Every edge on some shortest path (edgeKey). */
	edges: Set<string>;
	/** The one path through the BFS tree parents (drawn thick). */
	main: Set<string>;
	mainNodes: Set<string>;
}

/** All shortest paths from the root to `id`, or null when the root cannot reach it. */
export function pathToRoot(g: LayeredGraph, id: string): Highlight | null {
	const start = g.nodes.get(id);
	if (!start) return null;
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
	const main = new Set<string>();
	const mainNodes = new Set<string>([id]);
	for (let n: GraphNode | undefined = start; n && n.parents.length > 0; n = g.nodes.get(n.parents[0] as string)) {
		const p = n.parents[0] as string;
		main.add(edgeKey(p, n.id));
		mainNodes.add(p);
	}
	return { nodes, edges, main, mainNodes };
}

export interface Reach {
	/** Every note `id` reaches by links, with how many links away it is (stop notes left out). */
	nodes: Map<string, number>;
	/** Every link on a shortest way there (edgeKey), with the hop it arrives at. */
	edges: Map<string, number>;
}

/**
 * Everything `id` reaches by following links (down, within a row or back up),
 * in hops from `id`. A link into a note already reached at the same hop is
 * kept, so the lines merge as in the layers. The walk goes into a `stop` note
 * but not on from it: stopping at the route to `id` keeps a link back to the
 * root from pulling in the whole graph. Stop notes keep their own colour, so
 * only the links into them are returned.
 */
export function reachFrom(g: LayeredGraph, id: string, stop: ReadonlySet<string> = new Set()): Reach {
	const nodes = new Map<string, number>();
	const edges = new Map<string, number>();
	if (!g.nodes.has(id)) return { nodes, edges };
	const out = new Map<string, string[]>();
	for (const e of g.edges) push(out, e.from, e.to);
	const hops = new Map<string, number>([[id, 0]]);
	for (let frontier = [id], h = 1; frontier.length > 0; h++) {
		const next: string[] = [];
		for (const from of frontier) {
			for (const to of out.get(from) ?? []) {
				const seen = hops.get(to);
				if (seen === undefined) {
					hops.set(to, h);
					if (!stop.has(to)) {
						nodes.set(to, h);
						next.push(to);
					}
				} else if (seen !== h) continue;
				edges.set(edgeKey(from, to), h);
			}
		}
		frontier = next;
	}
	return { nodes, edges };
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
