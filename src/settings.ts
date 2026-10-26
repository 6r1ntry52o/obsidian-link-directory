import { App, PluginSettingTab, Setting } from "obsidian";
import type LinkDirectoryPlugin from "./main";
import { t } from "./i18n";
import type { Direction } from "./layered";

export interface LinkDirectorySettings {
	rootMode: "active" | "fixed";
	fixedRootPath: string;
	clickAction: "open" | "expand";
	dedupe: boolean;
	sort: "appearance" | "name";
	includeEmbeds: boolean;
	includeFrontmatter: boolean;
	showUnresolved: boolean;
	autoReveal: boolean;
	initialDepth: number;
	maxNodes: number;
	/** Tree graph: grow from the active note, or from a pinned note. */
	graphRootMode: "active" | "fixed";
	/** Tree graph: the pinned note the graph grows from. */
	graphRootPath: string;
	/** Tree graph: folder searched for notes the root cannot reach ("" = the root's folder). */
	graphOrphanScope: string;
	/** Tree graph: grow down (rows) or right (columns). */
	graphDirection: Direction;
	/** Tree graph: show every note name, or only those on the route to the open note. */
	graphLabels: "all" | "route";
	/** Tree graph: keep the notes linked from the same note together, on a background colour. */
	graphGroups: boolean;
	/** Tree graph: wrap a layer longer than this many pixels (0 = never). */
	graphMaxLength: number;
	/** Tree graph: show only the route to the open note and the notes linked from it. */
	graphFocus: boolean;
	/** Tree graph, focus: also the notes the open note reaches by up to this many links (0 = any number). */
	graphFocusHops: number;
	/** Tree graph: run a short light along the coloured lines, base to tip. */
	graphFlow: boolean;
}

export const DEFAULT_SETTINGS: LinkDirectorySettings = {
	rootMode: "active",
	fixedRootPath: "",
	clickAction: "open",
	dedupe: true,
	sort: "appearance",
	includeEmbeds: true,
	includeFrontmatter: true,
	showUnresolved: true,
	autoReveal: true,
	initialDepth: 1,
	maxNodes: 10000,
	graphRootMode: "active",
	graphRootPath: "",
	graphOrphanScope: "",
	graphDirection: "down",
	graphLabels: "all",
	graphGroups: true,
	graphMaxLength: 1200,
	graphFocus: false,
	graphFocusHops: 1,
	graphFlow: true,
};

/** The hops offered for focus, 0 (every hop) last. */
export const FOCUS_HOPS = [1, 2, 3, 4, 5, 0];

export function hopsLabel(n: number): string {
	if (n <= 0) return t("graphHopsAll");
	return t(n === 1 ? "graphHop" : "graphHops").replace("{n}", String(n));
}

export class LinkDirectorySettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: LinkDirectoryPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = () => void this.plugin.saveSettings();

		new Setting(containerEl)
			.setName(t("setRootMode"))
			.setDesc(t("setRootModeDesc"))
			.addDropdown((d) =>
				d
					.addOptions({ active: t("setRootModeActive"), fixed: t("setRootModeFixed") })
					.setValue(s.rootMode)
					.onChange((v) => {
						s.rootMode = v as "active" | "fixed";
						save();
						this.display();
					}),
			);

		if (s.rootMode === "fixed") {
			new Setting(containerEl)
				.setName(t("setFixedRoot"))
				.setDesc(t("setFixedRootDesc"))
				.addText((tx) =>
					tx.setValue(s.fixedRootPath).onChange((v) => {
						s.fixedRootPath = v.trim();
						save();
					}),
				);
		}

		new Setting(containerEl)
			.setName(t("setClick"))
			.setDesc(t("setClickDesc"))
			.addDropdown((d) =>
				d
					.addOptions({ open: t("setClickOpen"), expand: t("setClickExpand") })
					.setValue(s.clickAction)
					.onChange((v) => {
						s.clickAction = v as "open" | "expand";
						save();
					}),
			);

		new Setting(containerEl)
			.setName(t("setDedupe"))
			.setDesc(t("setDedupeDesc"))
			.addToggle((tg) =>
				tg.setValue(s.dedupe).onChange((v) => {
					s.dedupe = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName(t("setSort"))
			.setDesc(t("setSortDesc"))
			.addDropdown((d) =>
				d
					.addOptions({ appearance: t("setSortAppearance"), name: t("setSortName") })
					.setValue(s.sort)
					.onChange((v) => {
						s.sort = v as "appearance" | "name";
						save();
					}),
			);

		new Setting(containerEl)
			.setName(t("setEmbeds"))
			.setDesc(t("setEmbedsDesc"))
			.addToggle((tg) =>
				tg.setValue(s.includeEmbeds).onChange((v) => {
					s.includeEmbeds = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName(t("setFrontmatter"))
			.setDesc(t("setFrontmatterDesc"))
			.addToggle((tg) =>
				tg.setValue(s.includeFrontmatter).onChange((v) => {
					s.includeFrontmatter = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName(t("setUnresolved"))
			.setDesc(t("setUnresolvedDesc"))
			.addToggle((tg) =>
				tg.setValue(s.showUnresolved).onChange((v) => {
					s.showUnresolved = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName(t("setAutoReveal"))
			.setDesc(t("setAutoRevealDesc"))
			.addToggle((tg) =>
				tg.setValue(s.autoReveal).onChange((v) => {
					s.autoReveal = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName(t("setInitialDepth"))
			.setDesc(t("setInitialDepthDesc"))
			.addSlider((sl) =>
				sl
					.setLimits(0, 5, 1)
					.setValue(s.initialDepth)
					.setDynamicTooltip()
					.onChange((v) => {
						s.initialDepth = v;
						save();
					}),
			);

		new Setting(containerEl)
			.setName(t("setMaxNodes"))
			.setDesc(t("setMaxNodesDesc"))
			.addText((tx) =>
				tx.setValue(String(s.maxNodes)).onChange((v) => {
					const n = Number.parseInt(v, 10);
					if (Number.isFinite(n) && n > 0) {
						s.maxNodes = n;
						save();
					}
				}),
			);

		new Setting(containerEl).setName(t("setGraphHeading")).setHeading();

		new Setting(containerEl)
			.setName(t("setGraphRootMode"))
			.setDesc(t("setGraphRootModeDesc"))
			.addDropdown((d) =>
				d
					.addOptions({ active: t("setRootModeActive"), fixed: t("setRootModeFixed") })
					.setValue(s.graphRootMode)
					.onChange((v) => {
						s.graphRootMode = v as "active" | "fixed";
						save();
						this.display();
					}),
			);

		if (s.graphRootMode === "fixed") {
			new Setting(containerEl)
				.setName(t("setGraphRoot"))
				.setDesc(t("setGraphRootDesc"))
				.addText((tx) =>
					tx.setValue(s.graphRootPath).onChange((v) => {
						s.graphRootPath = v.trim();
						save();
					}),
				);

			new Setting(containerEl)
				.setName(t("setGraphScope"))
				.setDesc(t("setGraphScopeDesc"))
				.addText((tx) =>
					tx.setValue(s.graphOrphanScope).onChange((v) => {
						s.graphOrphanScope = v.trim();
						save();
					}),
				);
		}

		new Setting(containerEl)
			.setName(t("setGraphDirection"))
			.setDesc(t("setGraphDirectionDesc"))
			.addDropdown((d) =>
				d
					.addOptions({ down: t("setGraphDirectionDown"), right: t("setGraphDirectionRight") })
					.setValue(s.graphDirection)
					.onChange((v) => {
						s.graphDirection = v as Direction;
						save();
					}),
			);

		new Setting(containerEl)
			.setName(t("setGraphNames"))
			.setDesc(t("setGraphNamesDesc"))
			.addDropdown((d) =>
				d
					.addOptions({ all: t("setGraphNamesAll"), route: t("setGraphNamesRoute") })
					.setValue(s.graphLabels)
					.onChange((v) => {
						s.graphLabels = v as "all" | "route";
						save();
					}),
			);

		new Setting(containerEl)
			.setName(t("setGraphGroups"))
			.setDesc(t("setGraphGroupsDesc"))
			.addToggle((tg) =>
				tg.setValue(s.graphGroups).onChange((v) => {
					s.graphGroups = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName(t("setGraphFocus"))
			.setDesc(t("setGraphFocusDesc"))
			.addToggle((tg) =>
				tg.setValue(s.graphFocus).onChange((v) => {
					s.graphFocus = v;
					save();
					this.display();
				}),
			);

		if (s.graphFocus) {
			new Setting(containerEl)
				.setName(t("setGraphFocusHops"))
				.setDesc(t("setGraphFocusHopsDesc"))
				.addDropdown((d) => {
					// One by one: an object of options would put "0" (every hop) first.
					for (const n of FOCUS_HOPS) d.addOption(String(n), hopsLabel(n));
					d.setValue(String(s.graphFocusHops)).onChange((v) => {
						s.graphFocusHops = Number(v);
						save();
					});
				});
		}

		new Setting(containerEl)
			.setName(t("setGraphFlow"))
			.setDesc(t("setGraphFlowDesc"))
			.addToggle((tg) =>
				tg.setValue(s.graphFlow).onChange((v) => {
					s.graphFlow = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName(t("setGraphMaxLength"))
			.setDesc(t("setGraphMaxLengthDesc"))
			.addText((tx) =>
				tx.setValue(String(s.graphMaxLength)).onChange((v) => {
					const n = Number.parseInt(v, 10);
					if (Number.isFinite(n) && n >= 0) {
						s.graphMaxLength = n;
						save();
					}
				}),
			);
	}
}
