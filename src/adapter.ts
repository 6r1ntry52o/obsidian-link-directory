import { App, parseLinktext, TFile, type Reference } from "obsidian";
import type { ChildLink, LinkKind, LinkSource } from "./types";

/** Reads outgoing links straight from MetadataCache, preserving appearance order. */
export class MetadataLinkSource implements LinkSource {
	constructor(private readonly app: App) {}

	basename(path: string): string {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) return f.basename;
		return path.replace(/\.md$/, "").split("/").pop() ?? path;
	}

	getChildren(path: string): ChildLink[] {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return [];
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return [];

		const out: ChildLink[] = [];
		const push = (ref: Reference, kind: LinkKind, offset: number) => {
			const { path: target, subpath } = parseLinktext(ref.link);
			if (!target && subpath) return; // [[#heading]] self link
			const dest = this.app.metadataCache.getFirstLinkpathDest(target, path);
			const alias = aliasOf(ref);
			if (dest) {
				if (dest.extension !== "md") return;
				out.push({ path: dest.path, target, subpath, display: alias ?? dest.basename, kind, offset });
			} else {
				if (looksLikeNonMarkdown(target)) return;
				out.push({ path: null, target, subpath, display: alias ?? target, kind, offset });
			}
		};

		(cache.frontmatterLinks ?? []).forEach((l, i) => push(l, "frontmatter", -1_000_000 + i));
		(cache.links ?? []).forEach((l) => push(l, "link", l.position.start.offset));
		(cache.embeds ?? []).forEach((l) => push(l, "embed", l.position.start.offset));
		out.sort((a, b) => a.offset - b.offset);
		return out;
	}
}

/** The alias the author wrote, if any. Wikilinks only carry one after a pipe; markdown links always do. */
function aliasOf(ref: Reference): string | null {
	const original = ref.original.replace(/^!/, "");
	if (original.startsWith("[[") && !original.includes("|")) return null;
	const text = ref.displayText?.trim();
	return text ? text : null;
}

function looksLikeNonMarkdown(target: string): boolean {
	const last = target.split("/").pop() ?? target;
	const dot = last.lastIndexOf(".");
	if (dot <= 0) return false;
	const ext = last.slice(dot + 1).toLowerCase();
	return ext.length > 0 && ext.length <= 5 && ext !== "md";
}
