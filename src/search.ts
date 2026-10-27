/** What the tree graph's search box asks for. */
export interface Query {
	/** Parts of the note name, each to be found in it. */
	words: string[];
	/** Tags without "#", each matched by a tag of the note that starts with it. */
	tags: string[];
}

/** Lower case, and full-width letters, digits and half-width kana folded (ＡＢＣ = abc). */
function fold(text: string): string {
	return text.normalize("NFKC").toLowerCase();
}

/**
 * Splits the search text at spaces: a word starting with "#" asks for a tag,
 * any other for a part of the note name. Null when there is nothing to look for.
 */
export function parseQuery(text: string): Query | null {
	const words: string[] = [];
	const tags: string[] = [];
	for (const w of fold(text).split(/\s+/)) {
		if (w === "") continue;
		if (w.startsWith("#")) tags.push(w.slice(1));
		else words.push(w);
	}
	return words.length + tags.length > 0 ? { words, tags } : null;
}

/**
 * Whether a note matches every word and tag of the query: each word is found
 * in its name, and each tag starts one of its tags ("#pro" finds #project and
 * #project/a, so the hits narrow down as a tag is typed; "#" alone finds every
 * note with a tag). Tags may be given with or without "#".
 */
export function matches(q: Query, name: string, tags: readonly string[]): boolean {
	const n = fold(name);
	if (!q.words.every((w) => n.includes(w))) return false;
	if (q.tags.length === 0) return true;
	const own = tags.map((t) => fold(t).replace(/^#/, ""));
	return q.tags.every((t) => own.some((o) => o.startsWith(t)));
}
