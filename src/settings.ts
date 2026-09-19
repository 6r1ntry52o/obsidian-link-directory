import { App, PluginSettingTab, Setting } from "obsidian";
import type LinkDirectoryPlugin from "./main";
import { t } from "./i18n";

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
};

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
	}
}
