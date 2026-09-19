import type { ChildLink, LinkKind, LinkSource } from "./types";

export type NodeStatus = "normal" | "cycle" | "dup" | "unresolved";

export interface TreeNode {
	/** Occurrence id: `${parentId}/${index}:${path}` — unique per position in the tree. */
	id: string;
	path: string | null;
	target: string;
	subpath: string;
	display: string;
	kind: LinkKind | "root";
	depth: number;
	parent: TreeNode | null;
	status: NodeStatus;
	/** For cycle/dup nodes: id of the occurrence this one refers to. */
	refId: string | null;
	hasChildren: boolean;
}

export interface TreeOptions {
	/** Show 2nd+ occurrences of a note as a stub (cargo-tree style). */
	dedupe: boolean;
	sort: "appearance" | "name";
	includeEmbeds: boolean;
	includeFrontmatter: boolean;
	showUnresolved: boolean;
	/** Hard cap on nodes explored by searches (safety valve). */
	maxNodes: number;
}

export const DEFAULT_TREE_OPTIONS: TreeOptions = {
	dedupe: true,
	sort: "appearance",
	includeEmbeds: true,
	includeFrontmatter: true,
	showUnresolved: true,
	maxNodes: 10000,
};

/**
 * Lazily unfolds the outgoing-link graph into a tree.
 *
 * - Cycles: a child whose path already appears on its ancestor chain becomes a
 *   `cycle` node (shown, never expandable) pointing at that ancestor.
 * - Duplicates: with `dedupe`, a child whose path was already materialised
 *   elsewhere becomes a `dup` stub pointing at the first occurrence. It can
 *   still be expanded by hand.
 * - Everything is computed on demand: `children()` is only called when a node
 *   is expanded, so the tree never explodes on its own.
 */
export class LinkTree {
	readonly root: TreeNode;
	private firstSeen = new Map<string, string>();

	constructor(
		private readonly src: LinkSource,
		rootPath: string,
		private opts: TreeOptions = DEFAULT_TREE_OPTIONS,
	) {
		this.root = {
			id: `root:${rootPath}`,
			path: rootPath,
			target: rootPath,
			subpath: "",
			display: src.basename(rootPath),
			kind: "root",
			depth: 0,
			parent: null,
			status: "normal",
			refId: null,
			hasChildren: false,
		};
		this.root.hasChildren = this.filteredChildren(rootPath).length > 0;
		this.firstSeen.set(rootPath, this.root.id);
	}

	get options(): TreeOptions {
		return this.opts;
	}

	setOptions(opts: TreeOptions): void {
		this.opts = opts;
		this.resetSeen();
	}

	/** Forget which occurrence was "first". Call before a full re-render. */
	resetSeen(): void {
		this.firstSeen.clear();
		if (this.root.path) this.firstSeen.set(this.root.path, this.root.id);
		this.root.hasChildren = this.root.path !== null && this.filteredChildren(this.root.path).length > 0;
	}

	/**
	 * Share the "first occurrence" registry with other trees rendered side by
	 * side (Bases view), so a note that is also another root shows as a dup.
	 */
	shareSeen(map: Map<string, string>): void {
		this.firstSeen = map;
		if (this.root.path && !map.has(this.root.path)) map.set(this.root.path, this.root.id);
	}

	/** Raw children after option filters, sibling-deduplicated, sorted. */
	filteredChildren(path: string): ChildLink[] {
		const seen = new Set<string>();
		const out: ChildLink[] = [];
		for (const c of this.src.getChildren(path)) {
			if (c.kind === "embed" && !this.opts.includeEmbeds) continue;
			if (c.kind === "frontmatter" && !this.opts.includeFrontmatter) continue;
			if (c.path === null && !this.opts.showUnresolved) continue;
			const key = c.path ?? `?${c.target.toLowerCase()}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(c);
		}
		if (this.opts.sort === "name") {
			out.sort((a, b) => a.display.localeCompare(b.display, undefined, { numeric: true, sensitivity: "base" }));
		}
		return out;
	}

	/** Materialise the children of a node. Registers first occurrences. */
	children(node: TreeNode): TreeNode[] {
		if (node.path === null || node.status === "cycle") return [];
		const links = this.filteredChildren(node.path);
		return links.map((link, i) => this.makeNode(node, link, i));
	}

	private makeNode(parent: TreeNode, link: ChildLink, index: number): TreeNode {
		const id = `${parent.id}/${index}:${link.path ?? "?" + link.target}`;
		let status: NodeStatus = "normal";
		let refId: string | null = null;
		let hasChildren = false;

		if (link.path === null) {
			status = "unresolved";
		} else {
			const ancestor = this.findAncestor(parent, link.path);
			if (ancestor) {
				status = "cycle";
				refId = ancestor.id;
			} else {
				hasChildren = this.filteredChildren(link.path).length > 0;
				const first = this.firstSeen.get(link.path);
				if (first === undefined) {
					this.firstSeen.set(link.path, id);
				} else if (first !== id && this.opts.dedupe) {
					status = "dup";
					refId = first;
				}
			}
		}

		return {
			id,
			path: link.path,
			target: link.target,
			subpath: link.subpath,
			display: link.display,
			kind: link.kind,
			depth: parent.depth + 1,
			parent,
			status,
			refId,
			hasChildren,
		};
	}

	/** Walk the parent chain looking for `path`. */
	findAncestor(node: TreeNode | null, path: string): TreeNode | null {
		for (let n: TreeNode | null = node; n; n = n.parent) {
			if (n.path === path) return n;
		}
		return null;
	}

	/**
	 * Shortest link path from the root to `target` (BFS over resolved links),
	 * as a list of vault paths starting with the root. Null when unreachable
	 * within `maxNodes`.
	 */
	findShortestPath(target: string): string[] | null {
		const rootPath = this.root.path;
		if (rootPath === null) return null;
		if (rootPath === target) return [rootPath];
		const prev = new Map<string, string | null>([[rootPath, null]]);
		const queue: string[] = [rootPath];
		let explored = 0;
		while (queue.length > 0 && explored < this.opts.maxNodes) {
			const cur = queue.shift() as string;
			explored++;
			for (const c of this.filteredChildren(cur)) {
				if (c.path === null || prev.has(c.path)) continue;
				prev.set(c.path, cur);
				if (c.path === target) {
					const out: string[] = [];
					for (let p: string | null = target; p !== null; p = prev.get(p) ?? null) out.unshift(p);
					return out;
				}
				queue.push(c.path);
			}
		}
		return null;
	}
}
