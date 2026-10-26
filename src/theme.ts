export type GraphTheme = "auto" | "light" | "dark";

/** The class that lets an element take a theme of its own (with `theme-light` / `theme-dark`). */
export const THEMED_CLASS = "ldg-themed";

/** Colours body sets from the theme besides its variables (its text colour above all), inherited the same way. */
const BODY_COLOURS = new Set(["color", "background-color", "caret-color"]);

/** Obsidian's own theme, as set on the body. */
export function appTheme(doc: Document): "light" | "dark" {
	return doc.body.hasClass("theme-dark") ? "dark" : "light";
}

/**
 * CSS that lets one element take the light or the dark theme on its own.
 * Obsidian sets a theme's base colours on `.theme-light` / `.theme-dark`,
 * which works on any element, but derives most colours from them on `body`
 * (`--background-primary: var(--color-base-00)`, …), where they are worked out
 * once and inherited as they are (so is body's text colour). This repeats those under
 * THEMED_CLASS, so they are worked out again from the element's own base
 * colours; `:where` keeps a theme class's own values ahead of them, as on body.
 */
export function themedCss(doc: Document): string {
	const decls: string[] = [];
	for (const sheet of Array.from(doc.styleSheets)) {
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			continue; // a sheet from another origin
		}
		for (const rule of Array.from(rules)) {
			const style = (rule as CSSStyleRule).style;
			if ((rule as CSSStyleRule).selectorText !== "body" || !style) continue;
			for (const name of Array.from(style)) {
				if (!name.startsWith("--") && !BODY_COLOURS.has(name)) continue;
				const value = style.getPropertyValue(name);
				if (value.includes("var(")) decls.push(`${name}: ${value};`);
			}
		}
	}
	return `:where(.${THEMED_CLASS}) { ${decls.join(" ")} }`;
}
