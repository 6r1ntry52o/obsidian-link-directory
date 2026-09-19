export type LinkKind = "link" | "embed" | "frontmatter";

/** One outgoing link of a note, in order of appearance. */
export interface ChildLink {
	/** Vault path of the resolved markdown file, or null when unresolved. */
	path: string | null;
	/** Link target text without subpath (what was written between [[ ]]). */
	target: string;
	/** Heading / block subpath ("#Heading", "#^block") or "". */
	subpath: string;
	/** Text to show. Alias when the author wrote one, else the note's basename. */
	display: string;
	kind: LinkKind;
	/** Character offset in the source note. Frontmatter links get negative offsets so they sort first. */
	offset: number;
}

/** Source of link data. Implemented over MetadataCache in the plugin, faked in tests. */
export interface LinkSource {
	getChildren(path: string): ChildLink[];
	basename(path: string): string;
}
