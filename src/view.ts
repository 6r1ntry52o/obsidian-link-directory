import { ItemView, TAbstractFile, TFile, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import { t } from "./i18n";
import type LinkDirectoryPlugin from "./main";
import { TreeRenderer, type DumpedNode } from "./renderer";

export const VIEW_TYPE_LINK_DIRECTORY = "link-directory";

/** Sidebar view: one root (the active note, or a pinned note). */
export class LinkDirectoryView extends ItemView {
	override navigation = false;

	private renderer!: TreeRenderer;
	private rootPathValue: string | null = null;
	private expandedByRoot = new Map<string, Set<string>>();

	private rootLabelEl!: HTMLElement;
	private pinBtnEl!: HTMLElement;
	private emptyEl!: HTMLElement;

	private readonly rerender = debounce(() => this.render(), 150, true);

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: LinkDirectoryPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_LINK_DIRECTORY;
	}

	getDisplayText(): string {
		return t("viewTitle");
	}

	override getIcon(): string {
		return "folder-tree";
	}

	get rootPath(): string | null {
		return this.rootPathValue;
	}

	override async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("link-directory");

		const header = root.createDiv({ cls: "nav-header" });
		const buttons = header.createDiv({ cls: "nav-buttons-container" });
		this.pinBtnEl = this.actionButton(buttons, "pin", t("pin"), () => this.plugin.togglePin());
		this.actionButton(buttons, "chevrons-down-up", t("collapseAll"), () => this.renderer.collapseAll());
		this.actionButton(buttons, "refresh-cw", t("refresh"), () => this.render());
		this.rootLabelEl = header.createDiv({ cls: "ld-root-label" });

		const filesEl = root.createDiv({ cls: "nav-files-container node-insert-event" });
		this.emptyEl = root.createDiv({ cls: "ld-empty", text: t("rootNone") });
		const legendEl = root.createDiv({ cls: "ld-legend" });
		const plugin = this.plugin;
		this.renderer = new TreeRenderer(
			this.app,
			{
				get settings() {
					return plugin.settings;
				},
				onSetRoot: (path) => this.plugin.pinRoot(path),
			},
			filesEl,
			legendEl,
		);

		this.registerEvent(this.app.workspace.on("file-open", (file) => this.onFileOpen(file)));
		this.registerEvent(this.app.metadataCache.on("resolve", (file) => this.onResolve(file)));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.onRename(file, oldPath)));
		this.registerEvent(this.app.vault.on("delete", (file) => this.onDelete(file)));

		this.app.workspace.onLayoutReady(() => {
			this.renderer.setActivePath(this.app.workspace.getActiveFile()?.path ?? null);
			this.syncRoot();
		});
	}

	// ---------------------------------------------------------------- root

	/** Pick the root from settings (fixed path, or the active note). */
	syncRoot(): void {
		const s = this.plugin.settings;
		let path: string | null = null;
		if (s.rootMode === "fixed") {
			path = this.mdFileAt(s.fixedRootPath)?.path ?? null;
		} else {
			const active = this.app.workspace.getActiveFile();
			path = active && active.extension === "md" ? active.path : this.rootPathValue;
		}
		this.setRoot(path);
	}

	setRoot(path: string | null): void {
		if (path === this.rootPathValue && path !== null) {
			this.updateHeader();
			return;
		}
		if (this.rootPathValue) this.expandedByRoot.set(this.rootPathValue, this.renderer.expandedIds);
		this.rootPathValue = path;

		if (path === null) {
			this.renderer.setRoots([]);
			this.renderer.expandedIds = new Set();
			this.render();
			return;
		}

		this.renderer.setRoots([path]);
		const saved = this.expandedByRoot.get(path);
		if (saved) {
			this.renderer.expandedIds = saved;
		} else {
			this.renderer.expandedIds = new Set();
			this.renderer.expandToDepth(this.plugin.settings.initialDepth);
		}
		this.render();
	}

	applySettings(): void {
		if (this.plugin.settings.rootMode === "fixed" || this.rootPathValue === null) {
			this.syncRoot();
		}
		this.renderer.applyOptions();
		this.render();
	}

	// ------------------------------------------------------------ rendering

	render(): void {
		this.updateHeader();
		if (this.rootPathValue === null) {
			this.renderer.setRoots([]);
			this.renderer.render();
			this.emptyEl.show();
			return;
		}
		this.emptyEl.hide();
		this.renderer.render();
	}

	private updateHeader(): void {
		const fixed = this.plugin.settings.rootMode === "fixed";
		setIcon(this.pinBtnEl, fixed ? "pin-off" : "pin");
		this.pinBtnEl.setAttr("aria-label", fixed ? t("unpin") : t("pin"));
		this.pinBtnEl.toggleClass("is-active", fixed);
		this.rootLabelEl.setText(this.rootPathValue ?? "");
	}

	private actionButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
		const el = parent.createDiv({ cls: ["clickable-icon", "nav-action-button"] });
		setIcon(el, icon);
		el.setAttr("aria-label", label);
		el.addEventListener("click", (ev) => {
			ev.stopPropagation();
			onClick();
		});
		return el;
	}

	reveal(path: string): boolean {
		return this.renderer.reveal(path);
	}

	// -------------------------------------------------------------- events

	private onFileOpen(file: TFile | null): void {
		this.renderer.setActivePath(file?.path ?? null);
		const s = this.plugin.settings;
		const ownClick = file !== null && this.renderer.isOwnOpen(file.path);

		if (s.rootMode === "active") {
			// A note opened from the tree itself keeps the current root, so the
			// user can browse a subtree without the view re-rooting under them.
			if (file && file.extension === "md" && !ownClick) this.setRoot(file.path);
			return;
		}
		if (file && file.extension === "md" && s.autoReveal && !ownClick) this.reveal(file.path);
	}

	private onResolve(file: TFile): void {
		if (this.rootPathValue !== null && this.renderer.shows(file.path)) this.rerender();
	}

	private onRename(file: TAbstractFile, oldPath: string): void {
		if (this.plugin.settings.fixedRootPath === oldPath) {
			this.plugin.settings.fixedRootPath = file.path;
			void this.plugin.saveSettings();
		}
		if (this.rootPathValue === oldPath) {
			this.rootPathValue = null;
			this.setRoot(file.path);
		} else {
			this.rerender();
		}
	}

	private onDelete(file: TAbstractFile): void {
		if (this.rootPathValue === file.path) {
			this.rootPathValue = null;
			this.syncRoot();
		} else {
			this.rerender();
		}
	}

	// --------------------------------------------------------------- utils

	private mdFileAt(path: string): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile && f.extension === "md" ? f : null;
	}

	/** Snapshot of what is on screen (used by tests / CLI eval). */
	dumpState(): DumpedNode | null {
		return this.renderer.dumpState()[0] ?? null;
	}
}
