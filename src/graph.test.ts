import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_OPTIONS, LinkTree } from "./graph";
import { fake } from "./testing";

const names = (nodes: { display: string }[]) => nodes.map((n) => n.display);

describe("LinkTree", () => {
	it("lists children in appearance order", () => {
		const t = new LinkTree(fake({ R: ["B", "A", "C"], A: [], B: [], C: [] }), "R.md");
		expect(names(t.children(t.root))).toEqual(["B", "A", "C"]);
	});

	it("marks a direct cycle back to the root", () => {
		const t = new LinkTree(fake({ R: ["A"], A: ["R"] }), "R.md");
		const [a] = t.children(t.root);
		const [back] = t.children(a!);
		expect(back?.status).toBe("cycle");
		expect(back?.refId).toBe(t.root.id);
		expect(back?.hasChildren).toBe(false);
		expect(t.children(back!)).toEqual([]);
	});

	it("detects deeper cycles via the ancestor chain, not a global set", () => {
		// R -> A -> B -> A  (cycle at depth 3)
		const t = new LinkTree(fake({ R: ["A"], A: ["B"], B: ["A"] }), "R.md");
		const [a] = t.children(t.root);
		const [b] = t.children(a!);
		const [a2] = t.children(b!);
		expect(a2?.status).toBe("cycle");
		expect(a2?.refId).toBe(a!.id);
	});

	it("shows a diamond node under both parents, second one as a dup stub", () => {
		// R -> A -> C ; R -> B -> C
		const t = new LinkTree(fake({ R: ["A", "B"], A: ["C"], B: ["C"], C: ["D"], D: [] }), "R.md");
		const [a, b] = t.children(t.root);
		const [c1] = t.children(a!);
		const [c2] = t.children(b!);
		expect(c1?.status).toBe("normal");
		expect(c2?.status).toBe("dup");
		expect(c2?.refId).toBe(c1!.id);
		// a dup stub can still be expanded by hand
		expect(c2?.hasChildren).toBe(true);
		expect(names(t.children(c2!))).toEqual(["D"]);
	});

	it("does not dedupe when the option is off", () => {
		const t = new LinkTree(fake({ R: ["A", "B"], A: ["C"], B: ["C"], C: [] }), "R.md", {
			...DEFAULT_TREE_OPTIONS,
			dedupe: false,
		});
		const [a, b] = t.children(t.root);
		t.children(a!);
		const [c2] = t.children(b!);
		expect(c2?.status).toBe("normal");
	});

	it("collapses the same target linked twice in one note", () => {
		const t = new LinkTree(fake({ R: ["A", "A", "B"], A: [], B: [] }), "R.md");
		expect(names(t.children(t.root))).toEqual(["A", "B"]);
	});

	it("keeps unresolved links as leaves and can hide them", () => {
		const t = new LinkTree(fake({ R: ["?Nope", "A"], A: [] }), "R.md");
		const kids = t.children(t.root);
		expect(kids[0]?.status).toBe("unresolved");
		expect(kids[0]?.hasChildren).toBe(false);
		t.setOptions({ ...DEFAULT_TREE_OPTIONS, showUnresolved: false });
		expect(names(t.children(t.root))).toEqual(["A"]);
	});

	it("finds the shortest path for reveal", () => {
		// R -> A -> B -> T ; R -> T (direct, shorter)
		const t = new LinkTree(fake({ R: ["A", "T"], A: ["B"], B: ["T"], T: [] }), "R.md");
		expect(t.findShortestPath("T.md")).toEqual(["R.md", "T.md"]);
		expect(t.findShortestPath("B.md")).toEqual(["R.md", "A.md", "B.md"]);
		expect(t.findShortestPath("Zzz.md")).toBeNull();
	});

	it("survives cycles during search", () => {
		const t = new LinkTree(fake({ R: ["A"], A: ["R", "B"], B: ["A"] }), "R.md");
		expect(t.findShortestPath("B.md")).toEqual(["R.md", "A.md", "B.md"]);
	});
});
