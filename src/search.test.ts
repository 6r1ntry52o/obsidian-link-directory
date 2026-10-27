import { describe, expect, it } from "vitest";
import { matches, parseQuery, type Query } from "./search";

const q = (text: string) => parseQuery(text) as Query;

describe("parseQuery", () => {
	it("splits words of the name from #tags, in lower case", () => {
		expect(parseQuery("  Meeting  #Project notes ")).toEqual({ words: ["meeting", "notes"], tags: ["project"] });
	});

	it("is null when there is nothing to look for", () => {
		expect(parseQuery("")).toBeNull();
		expect(parseQuery("   ")).toBeNull();
	});
});

describe("matches", () => {
	it("finds a part of the name, in any case and width", () => {
		expect(matches(q("meet"), "Weekly Meeting", [])).toBe(true);
		expect(matches(q("ＭＥＥＴ"), "Weekly Meeting", [])).toBe(true);
		expect(matches(q("会議"), "定例会議メモ", [])).toBe(true);
		expect(matches(q("ﾒﾓ"), "定例会議メモ", [])).toBe(true);
		expect(matches(q("memo"), "定例会議メモ", [])).toBe(false);
	});

	it("needs every word", () => {
		expect(matches(q("weekly meeting"), "Weekly Meeting", [])).toBe(true);
		expect(matches(q("weekly daily"), "Weekly Meeting", [])).toBe(false);
	});

	it("finds a tag by its start, nested ones too, with or without # on the note's tags", () => {
		const tags = ["#Project/Alpha", "#todo"];
		expect(matches(q("#project"), "x", tags)).toBe(true);
		expect(matches(q("#pro"), "x", tags)).toBe(true);
		expect(matches(q("#project/alpha"), "x", tags)).toBe(true);
		expect(matches(q("#alpha"), "x", tags)).toBe(false);
		expect(matches(q("#todo"), "x", ["todo"])).toBe(true);
		expect(matches(q("#done"), "x", tags)).toBe(false);
	});

	it("needs every tag and every word together", () => {
		expect(matches(q("#todo #project"), "x", ["#todo", "#project"])).toBe(true);
		expect(matches(q("#todo #project"), "x", ["#todo"])).toBe(false);
		expect(matches(q("plan #todo"), "Plan", ["#todo"])).toBe(true);
		expect(matches(q("plan #todo"), "Memo", ["#todo"])).toBe(false);
	});

	it("takes # alone for any tag", () => {
		expect(matches(q("#"), "x", ["#a"])).toBe(true);
		expect(matches(q("#"), "x", [])).toBe(false);
	});
});
