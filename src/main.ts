import { Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { BASES_VIEW_TYPE, LinkDirectoryBasesView } from "./bases";
import { TreeGraphView, VIEW_TYPE_TREE_GRAPH } from "./graph-view";
import { t } from "./i18n";
import { DEFAULT_SETTINGS, LinkDirectorySettingTab, type LinkDirectorySettings } from "./settings";
import { LinkDirectoryView, VIEW_TYPE_LINK_DIRECTORY } from "./view";

export default class LinkDirectoryPlugin extends Plugin {
	settings: LinkDirectorySettings = { ...DEFAULT_SETTINGS };

	override async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_LINK_DIRECTORY, (leaf) => new LinkDirectoryView(leaf, this));
		this.registerView(VIEW_TYPE_TREE_GRAPH, (leaf) => new TreeGraphView(leaf, this));
		this.addRibbonIcon("folder-tree", t("cmdOpen"), () => void this.activateView());
		this.addRibbonIcon("network", t("cmdOpenGraph"), () => void this.activateGraphView());

		// Bases integration (Obsidian 1.10+): a "Link tree" view whose roots are the base's entries.
		if (typeof this.registerBasesView === "function") {
			this.registerBasesView(BASES_VIEW_TYPE, {
				name: t("basesViewName"),
				icon: "folder-tree",
				factory: (controller, containerEl) => new LinkDirectoryBasesView(controller, containerEl, this),
			});
		}

		this.addCommand({
			id: "open",
			name: t("cmdOpen"),
			callback: () => void this.activateView(),
		});
		this.addCommand({
			id: "reveal-active-file",
			name: t("cmdReveal"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.activateView().then((v) => v?.reveal(file.path));
				return true;
			},
		});
		this.addCommand({
			id: "set-active-as-root",
			name: t("cmdSetRoot"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) this.pinRoot(file.path);
				return true;
			},
		});
		this.addCommand({
			id: "toggle-pin",
			name: t("cmdTogglePin"),
			callback: () => this.togglePin(),
		});
		this.addCommand({
			id: "open-graph",
			name: t("cmdOpenGraph"),
			callback: () => void this.activateGraphView(),
		});
		this.addCommand({
			id: "set-active-as-graph-root",
			name: t("cmdSetGraphRoot"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) this.setGraphRoot(file.path);
				return true;
			},
		});

		this.addSettingTab(new LinkDirectorySettingTab(this.app, this));
	}

	getView(): LinkDirectoryView | null {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_LINK_DIRECTORY)) {
			if (leaf.view instanceof LinkDirectoryView) return leaf.view;
		}
		return null;
	}

	async activateView(): Promise<LinkDirectoryView | null> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_LINK_DIRECTORY)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getLeftLeaf(false);
			if (!leaf) return null;
			await leaf.setViewState({ type: VIEW_TYPE_LINK_DIRECTORY, active: true });
		}
		await workspace.revealLeaf(leaf);
		return leaf.view instanceof LinkDirectoryView ? leaf.view : null;
	}

	getGraphView(): TreeGraphView | null {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TREE_GRAPH)) {
			if (leaf.view instanceof TreeGraphView) return leaf.view;
		}
		return null;
	}

	/** Opens beside the notes (a split), so clicking a node keeps the graph in sight. */
	async activateGraphView(): Promise<TreeGraphView | null> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_TREE_GRAPH)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getLeaf("split", "vertical");
			await leaf.setViewState({ type: VIEW_TYPE_TREE_GRAPH, active: true });
		}
		await workspace.revealLeaf(leaf);
		return leaf.view instanceof TreeGraphView ? leaf.view : null;
	}

	/** Pin `path` as the tree graph's fixed root. */
	setGraphRoot(path: string): void {
		this.settings.graphRootMode = "fixed";
		this.settings.graphRootPath = path;
		void this.saveSettings();
		void this.activateGraphView();
	}

	/** Pin the root the graph shows now, or go back to following the active note. */
	toggleGraphPin(): void {
		const s = this.settings;
		if (s.graphRootMode === "fixed") {
			s.graphRootMode = "active";
		} else {
			const current = this.getGraphView()?.rootPath ?? "";
			if (!current) return;
			s.graphRootMode = "fixed";
			s.graphRootPath = current;
		}
		void this.saveSettings();
	}

	/** Pin `path` as the fixed root. */
	pinRoot(path: string): void {
		this.settings.rootMode = "fixed";
		this.settings.fixedRootPath = path;
		void this.saveSettings();
		void this.activateView();
	}

	togglePin(): void {
		const view = this.getView();
		if (this.settings.rootMode === "fixed") {
			this.settings.rootMode = "active";
		} else {
			const current = view?.rootPath ?? this.app.workspace.getActiveFile()?.path ?? "";
			if (!current) return;
			this.settings.rootMode = "fixed";
			this.settings.fixedRootPath = current;
		}
		void this.saveSettings();
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<LinkDirectorySettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.getView()?.applySettings();
		this.getGraphView()?.applySettings();
	}

	/** Convenience for CLI/eval based checks. */
	fileAt(path: string): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}
}
