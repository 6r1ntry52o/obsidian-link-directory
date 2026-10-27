import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_OPTIONS } from "./graph";
import {
	around,
	buildLayers,
	countCrossings,
	edgeKey,
	focusOn,
	groupLayers,
	groupTones,
	orderLayers,
	pathToRoot,
	place,
	reachFrom,
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

	it("is not turned round by an empty layer", () => {
		// focused on Y with one hop of backlinks: M (row 3) is hidden, E1 and E2 (row 4) link back to Y
		const adj = { R: ["A", "B"], A: ["X", "Y"], B: ["X"], X: ["M"], Y: [], M: ["E1", "E2"], E1: ["Y"], E2: ["Y"] };
		const g = buildLayers(fake(adj), "R.md", opts);
		const f = focusOn(g, pathToRoot(g, "Y.md")?.nodes ?? new Set(), "Y.md", 1, 1);
		expect(names(f)).toEqual([["R"], ["A", "B"], ["X", "Y"], [], ["E1", "E2"]]);
		expect(countCrossings(f)).toBe(1);
		orderLayers(f);
		expect(countCrossings(f)).toBe(0);
		expect(names(f)[4]).toEqual(["E1", "E2"]);
	});

	it("keeps layer 1 in the root's link order", () => {
		const g = buildLayers(fake({ R: ["B", "A"], A: ["X"], B: ["Y"], X: [], Y: [] }), "R.md", opts);
		orderLayers(g);
		expect(names(g)[1]).toEqual(["B", "A"]);
	});
});

describe("groupLayers", () => {
	it("puts each note with the first note above that links to it, in that note's link order", () => {
		const g = buildLayers(fake(sketch), "R.md", opts);
		const found = names(g);
		orderLayers(g);
		const owners = groupLayers(g);
		// on a whole graph: the order the walk found the notes in
		expect(names(g)).toEqual(found);
		expect(names(g)[2]).toEqual(["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"]);
		// G5 is linked from A–D and goes with A, the first
		expect(["G1", "G3", "G5", "G6", "G8"].map((n) => owners.get(`${n}.md`))).toEqual(["A.md", "A.md", "A.md", "D.md", "D.md"]);
		expect(owners.get("A.md")).toBe("R.md");
		expect(owners.has("R.md")).toBe(false);

		const h = buildLayers(fake({ R: ["A", "B"], A: ["Y", "X"], B: ["Z", "X"], X: [], Y: [], Z: [] }), "R.md", opts);
		groupLayers(h);
		expect(names(h)[2]).toEqual(["Y", "X", "Z"]);
	});

	it("follows the layer above when a note's first link is hidden, and puts a note with none last", () => {
		// open Y: route R → B → D → Y. C is hidden, so X goes with D, after Y as D
		// links them; Q is only linked within its row (from Y), so it has no group
		const adj = { R: ["A", "B"], A: ["C"], C: ["X", "Q"], B: ["D"], D: ["Y", "X"], Y: ["Q"], X: [], Q: [] };
		const g = buildLayers(fake(adj), "R.md", opts);
		const f = focusOn(g, pathToRoot(g, "Y.md")?.nodes ?? new Set());
		expect(names(f)).toEqual([["R"], ["A", "B"], ["D"], ["X", "Q", "Y"]]);
		const owners = groupLayers(f);
		expect(names(f)[3]).toEqual(["Y", "X", "Q"]);
		expect(owners.get("X.md")).toBe("D.md");
		expect(owners.has("Q.md")).toBe(false);
	});
});

describe("groupTones", () => {
	// a layer as groups of notes (group "g1" holds "g1-0", "g1-1", …), wrapped column-major into `rows` sub-rows
	const layer = (sizes: number[]) => sizes.flatMap((n, g) => Array.from({ length: n }, (_, i) => `g${g}-${i}`));
	const ownerOf = (ids: string[]) => new Map(ids.map((id) => [id, id.split("-")[0] as string]));
	const neighbours = (ids: string[], rows: number) =>
		Array.from({ length: rows }, (_, s) => ids.filter((_, i) => i % rows === s).map((id) => id.split("-")[0] as string))
			.flatMap((row) => row.slice(1).map((o, k): [string, string] => [row[k] as string, o]))
			.filter(([a, b]) => a !== b);

	it("alternates along an unwrapped row", () => {
		const ids = layer([2, 1, 3, 1]);
		const tones = groupTones(ids, () => 0, ownerOf(ids));
		expect(["g0", "g1", "g2", "g3"].map((o) => tones.get(o))).toEqual([0, 1, 0, 1]);
	});

	it("keeps groups side by side apart when the row wraps", () => {
		for (const [sizes, rows] of [[[1, 1, 1, 1, 1, 1], 2], [[5, 5, 5], 2], [[1, 1, 1, 1, 1, 1, 1], 3], [[3, 3, 1, 1], 2]] as const) {
			const ids = layer([...sizes]);
			const tones = groupTones(ids, (id) => ids.indexOf(id) % rows, ownerOf(ids));
			for (const [a, b] of neighbours(ids, rows)) expect(tones.get(a), `${sizes} / ${rows}: ${a} ${b}`).not.toBe(tones.get(b));
		}
	});

	it("leaves notes without a group out", () => {
		const tones = groupTones(["a", "b", "q"], () => 0, new Map([["a", "A"], ["b", "B"]]));
		expect([...tones]).toEqual([["A", 0], ["B", 1]]);
	});
});

describe("pathToRoot", () => {
	it("colours every shortest path, none before the others", () => {
		const g = buildLayers(fake(sketch), "R.md", opts);
		const h = pathToRoot(g, "G5.md");
		// R → A, B, C, D → G5: four routes of the same length
		expect(h?.edges.size).toBe(8);
		expect([...(h?.nodes ?? [])].sort()).toEqual(["A.md", "B.md", "C.md", "D.md", "G5.md", "R.md"]);
		expect(h?.edges.has(edgeKey("D.md", "G5.md"))).toBe(true);
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

describe("reachFrom", () => {
	const hopsOf = (m: Map<string, number>) => Object.fromEntries([...m].map(([k, v]) => [k.replace(/\.md/g, ""), v]));

	it("follows links of links, counting hops from the open note", () => {
		const g = buildLayers(fake({ R: ["A"], A: ["B"], B: ["C"], C: ["D"], D: [] }), "R.md", opts);
		const r = reachFrom(g, "A.md");
		expect(hopsOf(r.nodes)).toEqual({ B: 1, C: 2, D: 3 });
		expect(hopsOf(r.edges)).toEqual({ "A\u0000B": 1, "B\u0000C": 2, "C\u0000D": 3 });
	});

	it("takes links within a row and back up, and merges lines into a note reached at the same hop", () => {
		// A -> X, Y ; X -> Z ; Y -> Z (same hop: both drawn) ; Z -> X (back: not drawn) ; Y -> B (same row as A)
		const g = buildLayers(fake({ R: ["A", "B"], A: ["X", "Y"], B: ["W"], X: ["Z"], Y: ["Z", "B"], Z: ["X"], W: [] }), "R.md", opts);
		const r = reachFrom(g, "A.md");
		expect(hopsOf(r.nodes)).toEqual({ X: 1, Y: 1, Z: 2, B: 2, W: 3 });
		expect(r.edges.get(edgeKey("X.md", "Z.md"))).toBe(2);
		expect(r.edges.get(edgeKey("Y.md", "Z.md"))).toBe(2);
		expect(r.edges.has(edgeKey("Z.md", "X.md"))).toBe(false);
	});

	it("goes into the route but not on from it, so a link back to the root does not take the whole graph", () => {
		// A -> X -> R (up) ; R -> Other must not be reached through R.
		const g = buildLayers(fake({ R: ["A", "Other"], A: ["X"], X: ["R"], Other: ["Far"], Far: [] }), "R.md", opts);
		const route = pathToRoot(g, "A.md")?.nodes ?? new Set<string>();
		const r = reachFrom(g, "A.md", route);
		expect(hopsOf(r.nodes)).toEqual({ X: 1 });
		expect(r.edges.get(edgeKey("X.md", "R.md"))).toBe(2);
		expect(r.nodes.has("R.md")).toBe(false);
	});

	it("never overlaps the route into the open note", () => {
		const g = buildLayers(fake(sketch), "R.md", opts);
		const h = pathToRoot(g, "A.md");
		const r = reachFrom(g, "A.md", h?.nodes);
		expect(r.nodes.size).toBe(5);
		expect([...r.edges.keys()].filter((k) => h?.edges.has(k))).toEqual([]);
	});

	it("from the root, the hops are the rows", () => {
		const g = buildLayers(fake(sketch), "R.md", opts);
		const r = reachFrom(g, "R.md", new Set(["R.md"]));
		for (const [id, hop] of r.nodes) expect(hop).toBe(g.nodes.get(id)?.depth);
		expect(r.nodes.size).toBe(g.nodes.size - 1);
	});

	it("is empty for a leaf and for a note outside the graph", () => {
		const g = buildLayers(fake({ R: ["A"], A: [], Lost: ["A"] }), "R.md", opts);
		expect(reachFrom(g, "A.md").edges.size).toBe(0);
		expect(reachFrom(g, "Lost.md").edges.size).toBe(0);
	});

	it("stops after `max` hops (0 = none)", () => {
		const g = buildLayers(fake({ R: ["A"], A: ["B"], B: ["C"], C: ["D"], D: [] }), "R.md", opts);
		expect(hopsOf(reachFrom(g, "A.md", new Set(), false, 2).nodes)).toEqual({ B: 1, C: 2 });
		expect(hopsOf(reachFrom(g, "A.md", new Set(), false, 2).edges)).toEqual({ "A\u0000B": 1, "B\u0000C": 2 });
		expect(reachFrom(g, "A.md", new Set(), false, 0).edges.size).toBe(0);
	});

	it("walks backlinks the other way, the links keeping their direction", () => {
		// route R → A → O ; X links to O within its row, Y and B link to X, R to B
		const g = buildLayers(fake({ R: ["A", "B"], A: ["O"], B: ["X", "Y"], X: ["O"], Y: ["X"], O: [] }), "R.md", opts);
		const route = pathToRoot(g, "O.md")?.nodes ?? new Set<string>();
		const r = reachFrom(g, "O.md", route, true);
		expect(hopsOf(r.nodes)).toEqual({ X: 1, B: 2, Y: 2 });
		// into the route (A, R) but not on from it: A → O is a backlink too, R → B one three hops away
		expect(hopsOf(r.edges)).toEqual({ "A\u0000O": 1, "X\u0000O": 1, "B\u0000X": 2, "Y\u0000X": 2, "R\u0000B": 3 });
		expect(hopsOf(reachFrom(g, "O.md", route, true, 1).nodes)).toEqual({ X: 1 });
	});
});

describe("around", () => {
	const hopsOf = (m: Map<string, number>) => Object.fromEntries([...m].map(([k, v]) => [k.replace(/\.md/g, ""), v]));

	it("leaves the route's links to the route", () => {
		const g = buildLayers(fake({ R: ["A", "B"], A: ["O"], B: ["X"], X: ["O"], O: [] }), "R.md", opts);
		const hl = pathToRoot(g, "O.md");
		if (!hl) throw new Error("no route");
		const { out, back } = around(g, "O.md", hl, -1, -1);
		expect(out.edges.size).toBe(0);
		expect(hopsOf(back.nodes)).toEqual({ X: 1, B: 2 });
		expect([...back.edges.keys()].filter((k) => hl.edges.has(k))).toEqual([]);
		expect(back.edges.has(edgeKey("X.md", "O.md"))).toBe(true);
	});

	it("gives a note both walks find to the nearer, the outgoing one on a tie", () => {
		// O → P → Q → O: P is 1 out and 2 back, Q 2 out and 1 back
		const g = buildLayers(fake({ R: ["O"], O: ["P"], P: ["Q"], Q: ["O"] }), "R.md", opts);
		const hl = pathToRoot(g, "O.md");
		if (!hl) throw new Error("no route");
		const { out, back } = around(g, "O.md", hl, -1, -1);
		expect(hopsOf(out.nodes)).toEqual({ P: 1 });
		expect(hopsOf(back.nodes)).toEqual({ Q: 1 });
		// P → Q is the 2nd hop both ways: outgoing
		expect(hopsOf(out.edges)).toEqual({ "O\u0000P": 1, "P\u0000Q": 2 });
		expect(hopsOf(back.edges)).toEqual({ "Q\u0000O": 1 });

		// O ⇄ X: one hop both ways, outgoing
		const h = buildLayers(fake({ R: ["O"], O: ["X"], X: ["O"] }), "R.md", opts);
		const both = around(h, "O.md", pathToRoot(h, "O.md") ?? { nodes: new Set(), edges: new Set() }, 1, 1);
		expect(hopsOf(both.out.nodes)).toEqual({ X: 1 });
		expect(both.back.nodes.size).toBe(0);
		expect(hopsOf(both.back.edges)).toEqual({ "X\u0000O": 1 });
	});

	it("keeps each walk to its own hops", () => {
		const g = buildLayers(fake({ R: ["A", "B"], A: ["O"], O: ["P"], P: ["Q"], B: ["X"], X: ["Y"], Y: ["O"], Q: [] }), "R.md", opts);
		const hl = pathToRoot(g, "O.md");
		if (!hl) throw new Error("no route");
		const one = around(g, "O.md", hl, 1, 2);
		expect(hopsOf(one.out.nodes)).toEqual({ P: 1 });
		expect(hopsOf(one.back.nodes)).toEqual({ Y: 1, X: 2 });
		const none = around(g, "O.md", hl, 0, 0);
		expect(none.out.edges.size + none.back.edges.size).toBe(0);
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

	it("keeps what the open note reaches, as far as the hops asked for", () => {
		// route R → A; A → B → C → D → E down a chain, B also back up to F (off the route)
		const chain = { R: ["A", "F"], A: ["B"], B: ["C", "F"], C: ["D"], D: ["E"], E: [], F: ["Z"], Z: [] };
		const g = buildLayers(fake(chain), "R.md", opts);
		const route = pathToRoot(g, "A.md")?.nodes ?? new Set<string>();
		const shown = (hops: number) => [...focusOn(g, route, "A.md", hops).nodes.values()].map((n) => n.display).sort();
		// 1 hop = the route and the notes it links to, as without `from`; so is none
		expect(shown(1)).toEqual(["A", "B", "F", "R"]);
		expect(shown(1)).toEqual([...focusOn(g, route).nodes.values()].map((n) => n.display).sort());
		expect(shown(0)).toEqual(shown(1));
		expect(shown(2)).toEqual(["A", "B", "C", "F", "R"]);
		// F is off the route, so the walk goes on from it: Z is 3 hops away (A → B → F → Z)
		expect(shown(3)).toEqual(["A", "B", "C", "D", "F", "R", "Z"]);
		// negative = every hop
		expect(shown(-1)).toEqual(["A", "B", "C", "D", "E", "F", "R", "Z"]);
		const f = focusOn(g, route, "A.md", -1);
		expect(f.layers.map((l) => l.map((id) => f.nodes.get(id)?.display).sort())).toEqual([
			["R"],
			["A", "F"],
			["B", "Z"],
			["C"],
			["D"],
			["E"],
		]);
		expect(f.edges.every((e) => f.nodes.has(e.from) && f.nodes.has(e.to))).toBe(true);
	});

	it("does not go on through the route, nor from a note off it", () => {
		// the open note X links back up to the root: what the root links to is not taken
		const g = buildLayers(fake({ R: ["A", "B"], A: ["X"], B: ["Y"], X: ["R"], Y: [] }), "R.md", opts);
		const route = pathToRoot(g, "X.md")?.nodes ?? new Set<string>();
		expect(names(focusOn(g, route, "X.md", -1, -1))).toEqual([["R"], ["A", "B"], ["X"]]);
		// a `from` the route does not reach (no route) adds nothing
		expect(names(focusOn(g, new Set(["R.md"]), "Y.md", -1, -1))).toEqual([["R"], ["A", "B"]]);
	});

	it("keeps the backlinks as far as asked for, in their own rows, even with empty rows between", () => {
		// route R → A → O; E links back up to O from three rows down, past C and D
		const adj = { R: ["A", "B"], A: ["O"], B: ["C"], C: ["D"], D: ["E"], E: ["O"], O: [] };
		const g = buildLayers(fake(adj), "R.md", opts);
		const route = pathToRoot(g, "O.md")?.nodes ?? new Set<string>();
		expect(names(focusOn(g, route, "O.md", 1, 0))).toEqual([["R"], ["A", "B"], ["O"]]);
		const f = focusOn(g, route, "O.md", 1, 1);
		expect(names(f)).toEqual([["R"], ["A", "B"], ["O"], [], ["E"]]);
		expect(f.nodes.get("E.md")?.depth).toBe(4);
		expect(kinds(f)).toContain("E>O:up");
		// D links to E: two hops back, so D (and its row) comes back
		expect(names(focusOn(g, route, "O.md", 1, 2))).toEqual([["R"], ["A", "B"], ["O"], ["D"], ["E"]]);
		// every hop back: the whole chain B → C → D → E → O, stopping at the root (on the route)
		expect(names(focusOn(g, route, "O.md", 1, -1))).toEqual([["R"], ["A", "B"], ["O", "C"], ["D"], ["E"]]);
	});

	it("gives the same route on the focused graph", () => {
		const g = buildLayers(fake(sketch), "R.md", opts);
		const full = pathToRoot(g, "G5.md");
		const f = focusOn(g, full?.nodes ?? new Set());
		const part = pathToRoot(f, "G5.md");
		expect([...(part?.edges ?? [])].sort()).toEqual([...(full?.edges ?? [])].sort());
		expect([...(part?.nodes ?? [])].sort()).toEqual([...(full?.nodes ?? [])].sort());
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

	it("leaves only a gap for an empty layer", () => {
		const adj = { R: ["A", "B"], A: ["O"], B: ["C"], C: ["D"], D: ["E"], E: ["O"], O: [] };
		const g = buildLayers(fake(adj), "R.md", opts);
		const f = focusOn(g, pathToRoot(g, "O.md")?.nodes ?? new Set(), "O.md", 1, 1);
		const { points, starts, ports } = place(f, () => 20, depth, base);
		expect(starts).toEqual([0, 80, 160, 240, 300]);
		expect(ports).toEqual([20, 100, 180, 240, 320]);
		expect(get(points, "E.md").y).toBe(300);
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
