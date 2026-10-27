import type { ChildLink, LinkSource } from "./types";

/** Build a fake vault from an adjacency list. "X" resolves to "X.md"; "?X" is unresolved. */
export function fake(adj: Record<string, string[]>): LinkSource {
	const files = new Set(Object.keys(adj).map((k) => `${k}.md`));
	return {
		backlinks(path: string): string[] {
			const name = path.replace(/\.md$/, "");
			return Object.keys(adj)
				.filter((k) => (adj[k] ?? []).includes(name))
				.map((k) => `${k}.md`);
		},
		getChildren(path: string): ChildLink[] {
			const name = path.replace(/\.md$/, "");
			return (adj[name] ?? []).map((t, i) => {
				const target = t.replace(/^\?/, "");
				const unresolved = t.startsWith("?") || !files.has(`${target}.md`);
				return {
					path: unresolved ? null : `${target}.md`,
					target,
					subpath: "",
					display: target,
					kind: "link",
					offset: i * 10,
				};
			});
		},
		basename: (p) => p.replace(/\.md$/, ""),
	};
}
