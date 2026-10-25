import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_OPTIONS } from "./graph";
import {
	buildLayers,
	countCrossings,
	edgeKey,
	focusOn,
	orderLayers,
	pathToRoot,
	place,
	type LayeredGraph,
	type Point,
} from "./layered";
import { fake } from "./testing";

const opts = DEFAULT_TREE_OPTIONS;
const names = (g: LayeredGraph) => g.layers.map((l) => l.map((id) => g.nodes.get(id)?.display));
const kinds = (g: LayeredGraph) => g.edges.map((e) => `${e.from.replace(".md", "")}>${e.to.replace(".md", "")}:${e.kind}`);

// The sketch in ツリー表示.md (仕様2): 4 branches, 8 leaves, leaves merge from several branches.
const sketch = {
	R: ["A", "B", "C", "D"],
	A: ["G1", "G2", "G3", "G4", "G5"],
	B: ["G4", "G5"],
	C: ["G4", "G5", "G3"],
	D: ["G5", "G6", "G7", "G8"],
	G1: [],
	G2: [],
	G3: [],
	G4: [],
	G5: [],
	G6: [],
	G7: [],
	G8: [],
};

describe("buildLayers", () => {
	it("puts each note once, at its shortest distance from the root", () => {
		const g = buildLayers(fake(sketch), "R.md", opts);
		expect(names(g)).toEqual([["R"], ["A", "B", "C", "D"], ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"]]);
		expect(g.nodes.size).toBe(13);
	});

	it("merges a note linked from several parents instead of repeating it", () => {
		const g = buildLayers(fake(sketch), "R.md", opts);
		expect(g.nodes.get("G5.md")?.parents).toEqual(["A.md", "B.md", "C.md", "D.md"]);
		expect(g.nodes.get("G4.md")?.parents).toEqual(["A.md", "B.md", "C.md"]);
		expect(g.nodes.get("G3.md")?.parents).toEqual(["A.md", "C.md"]);
		expect(g.edges.filter((e) => e.to === "G5.md")).toHaveLength(4);
	});

	it("classifies links within a layer and back up as same / up", () => {
		// R -> A, B ; A -> B (same layer) ; B -> X ; X -> A (up) ; X -> R (up)
		const g = buildLayers(fake({ R: ["A", "B"], A: ["B"], B: ["X"], X: ["A", "R"] }), "R.md", opts);
		expect(kinds(g)).toEqual(["R>A:down", "R>B:down", "A>B:same", "B>X:down", "X>A:up", "X>R:up"]);
		expect(g.nodes.get("B.md")?.parents).toEqual(["R.md"]);
	});

	it("uses the shortest distance even when a longer chain is found first", () => {
		// R -> A -> T and R -> T: T sits in layer 1, A -> T is a same-layer link.
		const g = buildLayers(fake({ R: ["A", "T"], A: ["T"], T: [] }), "R.md", opts);
		expect(names(g)).toEqual([["R"], ["A", "T"]]);
		expect(kinds(g)).toContain("A>T:same");
	});

	it("keeps unresolved links as leaves and ignores self links", () => {
		const g = buildLayers(fake({ R: ["A", "R"], A: ["?New", "A"] }), "R.md", opts);
		const node = g.nodes.get("?new");
		expect(node?.path).toBeNull();
		expect(node?.depth).toBe(2);
		expect(node?.via).toBe("A.md");
		expect(g.edges.some((e) => e.from === e.to)).toBe(false);
	});

	it("stops at maxNodes", () => {
		const g = buildLayers(fake({ R: ["A", "B", "C"], A: [], B: [], C: [] }), "R.md", { ...opts, maxNodes: 3 });
		expect(g.nodes.size).toBe(3);
		expect(g.truncated).toBe(true);
	});
});

describe("orderLayers", () => {
	it("reorders deeper layers to remove crossings", () => {
		// discovery order puts X before Y, which makes B -> X cross A -> Y
		const g = buildLayers(fake({ R: ["A", "B"], A: ["X", "Y"], B: ["X"], X: [], Y: [] }), "R.md", opts);
		expect(countCrossings(g)).toBe(1);
		orderLayers(g);
		expect(countCrossings(g)).toBe(0);
		expect(names(g)[2]).toEqual(["Y", "X"]);
	});

	it("keeps layer 1 in the root's link order", () => {
		const g = buildLayers(fake({ R: ["B", "A"], A: ["X"], B: ["Y"], X: [], Y: [] }), "R.md", opts);
		orderLayers(g);
		expect(names(g)[1]).toEqual(["B", "A"]);
	});
});

describe("pathToRoot", () => {
	it("colours every shortest path and marks the BFS-parent path as main", () => {
		const g = buildLayers(fake(sketch), "R.md", opts);
		const h = pathToRoot(g, "G5.md");
		expect(h?.edges.size).toBe(8);
		expect([...(h?.main ?? [])]).toEqual([edgeKey("A.md", "G5.md"), edgeKey("R.md", "A.md")]);
		expect([...(h?.mainNodes ?? [])].sort()).toEqual(["A.md", "G5.md", "R.md"]);
	});

	it("does not colour links within a layer or back up", () => {
		const g = buildLayers(fake({ R: ["A", "B"], A: ["B"], B: ["R"] }), "R.md", opts);
		const h = pathToRoot(g, "B.md");
		expect([...(h?.edges ?? [])]).toEqual([edgeKey("R.md", "B.md")]);
	});

	it("returns an empty highlight for the root and null when unreachable", () => {
		const g = buildLayers(fake({ R: ["A"], A: [], Lost: ["A"] }), "R.md", opts);
		expect(pathToRoot(g, "R.md")?.edges.size).toBe(0);
		expect(pathToRoot(g, "Lost.md")).toBeNull();
	});
});

describe("focusOn", () => {
	it("keeps the route and the notes it links to, nothing else", () => {
		const g = buildLayers(fake(sketch), "R.md", opts);
		const f = focusOn(g, pathToRoot(g, "G1.md")?.nodes ?? new Set());
		// route R → A → G1; R links to A–D, A to G1–G5; G6–G8 (only D's) are hidden
		expect(names(f)).toEqual([["R"], ["A", "B", "C", "D"], ["G1", "G2", "G3", "G4", "G5"]]);
		expect(f.edges.every((e) => f.nodes.has(e.from) && f.nodes.has(e.to))).toBe(true);
		expect(f.nodes.get("G5.md")?.parents).toEqual(["A.md", "B.md", "C.md", "D.md"]);
		// the full graph is left as it was
		expect(g.nodes.size).toBe(13);
	});

	it("keeps a note a route note links back up to", () => {
		// route R → A → X; X links up to B, which is off the route
		const g = buildLayers(fake({ R: ["A", "B"], A: ["X"], B: ["Y"], X: ["B"], Y: [] }), "R.md", opts);
		const f = focusOn(g, pathToRoot(g, "X.md")?.nodes ?? new Set());
		expect(names(f)).toEqual([["R"], ["A", "B"], ["X"]]);
		expect(kinds(f)).toContain("X>B:up");
		expect(f.nodes.get("X.md")?.parents).toEqual(["A.md"]);
	});

	it("shows the root and its links when there is no route, without empty rows", () => {
		const g = buildLayers(fake(sketch), "R.md", opts);
		const f = focusOn(g, new Set(["R.md"]));
		expect(names(f)).toEqual([["R"], ["A", "B", "C", "D"]]);
		expect(f.edges.every((e) => e.from === "R.md")).toBe(true);
	});

	it("gives the same route on the focused graph", () => {
		const g = buildLayers(fake(sketch), "R.md", opts);
		const full = pathToRoot(g, "G5.md");
		const f = focusOn(g, full?.nodes ?? new Set());
		const part = pathToRoot(f, "G5.md");
		expect([...(part?.edges ?? [])].sort()).toEqual([...(full?.edges ?? [])].sort());
		expect([...(part?.main ?? [])]).toEqual([...(full?.main ?? [])]);
	});
});

describe("place", () => {
	// depth 20 + layerGap 60 = 80 between layers; depth 20 + subGap 10 = 30 between sub-rows
	const base = { direction: "down", layerGap: 60, subGap: 10, gap: 14, maxLength: 0 } as const;
	const depth = () => 20;
	const get = (m: Map<string, Point>, id: string) => {
		const p = m.get(id);
		if (!p) throw new Error(`missing ${id}`);
		return p;
	};

	it("centres each layer and keeps nodes apart", () => {
		const g = buildLayers(fake(sketch), "R.md", opts);
		const pts = place(g, (id) => (id.length + 2) * 10, depth, base).points;
		for (const layer of g.layers) {
			const row = layer.map((id) => get(pts, id));
			const first = row[0] as Point;
			const last = row[row.length - 1] as Point;
			expect(first.x - first.w / 2 + (last.x + last.w / 2)).toBeCloseTo(0);
			for (let i = 1; i < row.length; i++) {
				const a = row[i - 1] as Point;
				const b = row[i] as Point;
				expect(b.x - b.w / 2 - (a.x + a.w / 2)).toBeCloseTo(14);
			}
		}
		expect(get(pts, "G1.md").y).toBe(160);
	});

	it("wraps a long layer column-major, keeping left-to-right order", () => {
		// 8 leaves of 20 + 14 gap = 258 > 120 → 3 sub-rows, 3 columns
		const g = buildLayers(fake(sketch), "R.md", opts);
		const pts = place(g, () => 20, depth, { ...base, maxLength: 120 }).points;
		const leaves = (g.layers[2] as string[]).map((id) => get(pts, id));
		expect(leaves.map((p) => p.sub)).toEqual([0, 1, 2, 0, 1, 2, 0, 1]);
		for (let i = 1; i < leaves.length; i++) expect((leaves[i] as Point).x).toBeGreaterThan((leaves[i - 1] as Point).x);
		expect(Math.max(...leaves.map((p) => p.x)) - Math.min(...leaves.map((p) => p.x))).toBeLessThan(120);
		// sub-rows step down by depth + subGap
		expect(get(pts, (g.layers[2] as string[])[1] as string).y - get(pts, (g.layers[2] as string[])[0] as string).y).toBe(30);
	});

	it("adds rows until mixed-width nodes really fit", () => {
		const g = buildLayers(fake(sketch), "R.md", opts);
		const widths = [100, 20, 20, 100, 20, 20, 100, 20];
		const leaves = g.layers[2] as string[];
		const pts = place(g, (id) => widths[leaves.indexOf(id)] ?? 20, depth, { ...base, maxLength: 260 }).points;
		const row = leaves.map((id) => get(pts, id));
		const left = Math.min(...row.map((p) => p.x - p.w / 2));
		const right = Math.max(...row.map((p) => p.x + p.w / 2));
		expect(right - left).toBeLessThanOrEqual(260);
		// nodes sharing a sub-row never overlap
		for (const s of new Set(row.map((p) => p.sub))) {
			const same = row.filter((p) => p.sub === s).sort((a, b) => a.x - b.x);
			for (let i = 1; i < same.length; i++) {
				const a = same[i - 1] as Point;
				const b = same[i] as Point;
				expect(b.x - b.w / 2).toBeGreaterThanOrEqual(a.x + a.w / 2);
			}
		}
	});

	it("starts the next layer below the last sub-row", () => {
		const g = buildLayers(fake({ R: ["A", "B", "C", "D"], A: ["X"], B: [], C: [], D: [], X: [] }), "R.md", opts);
		const pts = place(g, () => 20, depth, { ...base, maxLength: 60 }).points;
		// layer 1: 3 rows would still be 67 px wide with the stagger, so it folds into 4 (subs 0..3)
		expect(get(pts, "D.md").sub).toBe(3);
		expect(get(pts, "X.md").y).toBe(80 + 3 * 30 + 80);
	});

	it("lays layers out left to right when the graph grows right", () => {
		const g = buildLayers(fake(sketch), "R.md", opts);
		const pts = place(g, () => 24, depth, { ...base, direction: "right" }).points;
		expect(get(pts, "R.md")).toMatchObject({ x: 0, y: 0 });
		expect(get(pts, "A.md").x).toBe(80);
		expect(get(pts, "G1.md").x).toBe(160);
		expect(get(pts, "B.md").y).toBeGreaterThan(get(pts, "A.md").y);
	});

	it("puts layers only as far apart as their own names reach", () => {
		// growing right, names sit beside the dots: a layer of short names stays close
		const g = buildLayers(fake(sketch), "R.md", opts);
		const reach = (id: string) => (id.startsWith("G") ? 100 : id === "R.md" ? 10 : 30);
		const { points, starts, ports } = place(g, () => 22, reach, { ...base, direction: "right", layerGap: 40 });
		expect(ports).toEqual([10, 10 + 40 + 30, 10 + 40 + 30 + 40 + 100]);
		expect(starts).toEqual([0, 50, 120]);
		expect(get(points, "A.md").x).toBe(50);
		expect(get(points, "G1.md").x).toBe(120);
	});

	it("starts a wrapped sub-row after the deepest node of the one before", () => {
		const g = buildLayers(fake({ R: ["A", "B", "C", "D"], A: [], B: [], C: [], D: [] }), "R.md", opts);
		// 2 sub-rows: A, C in sub-row 0 (C reaches 50), B, D in sub-row 1
		const reach = (id: string) => (id === "C.md" ? 50 : 20);
		const { points, ports } = place(g, () => 20, reach, { ...base, maxLength: 100 });
		const a = get(points, "A.md");
		const b = get(points, "B.md");
		expect(b.sub).toBe(1);
		expect(b.y - a.y).toBe(50 + 10);
		expect(ports[1]).toBe(b.y + 20);
	});
});
