import { BasesView, QueryController, TFile, debounce } from "obsidian";
import type LinkDirectoryPlugin from "./main";
import { TreeRenderer, type DumpedNode } from "./renderer";

export const BASES_VIEW_TYPE = "link-directory";

/**
 * Bases view: every entry matching the base's filters becomes a root of the
 * link tree. This is how ".base as the first level" is realised — Obsidian
 * evaluates the filters and hands us the entries.
 */
export class LinkDirectoryBasesView extends BasesView {
	type = BASES_VIEW_TYPE;

	private readonly renderer: TreeRenderer;
	private readonly rerender = debounce(() => this.renderer.render(), 150, true);

	constructor(
		controller: QueryController,
		containerEl: HTMLElement,
		private readonly plugin: LinkDirectoryPlugin,
	) {
		super(controller);
		containerEl.addClass("link-directory", "link-directory-bases");
		const filesEl = containerEl.createDiv({ cls: "nav-files-container node-insert-event" });
		const legendEl = containerEl.createDiv({ cls: "ld-legend" });
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
	}

	override onload(): void {
		this.registerEvent(
			this.app.workspace.on("file-open", (file: TFile | null) => this.renderer.setActivePath(file?.path ?? null)),
		);
		this.registerEvent(
			this.app.metadataCache.on("resolve", (file: TFile) => {
				if (this.renderer.shows(file.path)) this.rerender();
			}),
		);
		this.renderer.setActivePath(this.app.workspace.getActiveFile()?.path ?? null);
	}

	onDataUpdated(): void {
		const paths = this.data.data.map((e) => e.file.path).filter((p) => p.endsWith(".md"));
		const before = new Set(this.renderer.rootPaths);
		this.renderer.setRoots(paths);
		// New roots open to the configured depth; known roots keep their state.
		if (paths.some((p) => !before.has(p))) this.renderer.expandToDepth(this.plugin.settings.initialDepth);
		this.renderer.render();
	}

	/** Snapshot of what is on screen (used by tests / CLI eval). */
	dumpState(): DumpedNode[] {
		return this.renderer.dumpState();
	}
}
