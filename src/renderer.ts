import { App, Keymap, Menu, TFile, WorkspaceLeaf, setIcon, type PaneType } from "obsidian";
import { MetadataLinkSource } from "./adapter";
import { LinkTree, type NodeStatus, type TreeNode, type TreeOptions } from "./graph";
import { t } from "./i18n";
import type { LinkDirectorySettings } from "./settings";

interface Rendered {
	node: TreeNode;
	tree: LinkTree;
	itemEl: HTMLElement;
	selfEl: HTMLElement;
	iconEl: HTMLElement | null;
	childrenEl: HTMLElement | null;
}

export interface DumpedNode {
	display: string;
	path: string | null;
	status: NodeStatus;
	depth: number;
	expanded: boolean;
	hasChildren: boolean;
	children?: DumpedNode[];
}

export interface RendererHost {
	settings: LinkDirectorySettings;
	/** Called when the user asks to make a note the root (context menu). */
	onSetRoot?: (path: string) => void;
}

/**
 * Renders one or more LinkTrees into a File-Explorer-like DOM.
 * Shared by the sidebar view (one root) and the Bases view (one root per entry).
 */
export class TreeRenderer {
	private readonly source: MetadataLinkSource;
	private trees: LinkTree[] = [];
	private expanded = new Set<string>();
	private rendered = new Map<string, Rendered>();
	private activePath: string | null = null;
	private focusedId: string | null = null;
	private pendingOpen: string | null = null;
	private longPressTimer: number | null = null;
	private longPressFired = false;

	constructor(
		private readonly app: App,
		private readonly host: RendererHost,
		readonly filesEl: HTMLElement,
		private readonly legendEl: HTMLElement,
	) {
		this.source = new MetadataLinkSource(app);
		filesEl.tabIndex = 0;
		filesEl.setAttr("role", "tree");
		filesEl.addEventListener("keydown", (ev) => this.onKeyDown(ev));
	}

	// ---------------------------------------------------------------- roots

	get rootPaths(): string[] {
		return this.trees.map((tr) => tr.root.path as string);
	}

	get expandedIds(): Set<string> {
		return this.expanded;
	}

	set expandedIds(ids: Set<string>) {
		this.expanded = ids;
	}

	/** Replace the roots. Expansion state is keyed by occurrence id, so it survives. */
	setRoots(paths: string[]): void {
		const opts = this.treeOptions();
		this.trees = paths.map((p) => new LinkTree(this.source, p, opts));
	}

	/** Expand the first `depth` levels of every root (used when a root is new). */
	expandToDepth(depth: number): void {
		for (const tree of this.trees) {
			const walk = (node: TreeNode, d: number) => {
				if (d <= 0 || !node.hasChildren || node.status === "cycle") return;
				this.expanded.add(node.id);
				for (const c of tree.children(node)) walk(c, d - 1);
			};
			walk(tree.root, depth);
			tree.resetSeen();
		}
	}

	applyOptions(): void {
		const opts = this.treeOptions();
		for (const tree of this.trees) tree.setOptions(opts);
	}

	private treeOptions(): TreeOptions {
		const s = this.host.settings;
		return {
			dedupe: s.dedupe,
			sort: s.sort,
			includeEmbeds: s.includeEmbeds,
			includeFrontmatter: s.includeFrontmatter,
			showUnresolved: s.showUnresolved,
			maxNodes: s.maxNodes,
		};
	}

	// ------------------------------------------------------------ rendering

	render(): void {
		this.rendered.clear();
		this.filesEl.empty();
		if (this.trees.length > 1) {
			// Roots are registered first so a note that is also a root dedupes to it.
			const shared = new Map<string, string>();
			for (const tree of this.trees) tree.shareSeen(shared);
		} else {
			for (const tree of this.trees) tree.resetSeen();
		}
		for (const tree of this.trees) this.renderNode(tree, tree.root, this.filesEl);
		this.afterRender();
	}

	private afterRender(): void {
		this.updateActive();
		this.updateLegend();
	}

	private renderNode(tree: LinkTree, node: TreeNode, parentEl: HTMLElement): void {
		const expandable = node.hasChildren && node.status !== "cycle";
		const isRoot = node.kind === "root";

		const itemEl = parentEl.createDiv({ cls: ["tree-item", expandable ? "nav-folder" : "nav-file"] });
		itemEl.dataset["ldId"] = node.id;
		if (isRoot) itemEl.addClass("ld-root");

		const selfEl = itemEl.createDiv({
			cls: ["tree-item-self", "is-clickable", expandable ? "nav-folder-title" : "nav-file-title"],
		});
		if (expandable) selfEl.addClass("mod-collapsible");
		if (node.path) selfEl.dataset["path"] = node.path;
		selfEl.setAttr("role", "treeitem");
		if (node.id === this.focusedId) selfEl.addClass("has-focus");
		selfEl.addClass(`ld-kind-${node.kind}`);
		if (node.status === "unresolved") selfEl.addClass("is-unresolved");
		if (node.status === "cycle") selfEl.addClass("ld-cycle");
		if (node.status === "dup") selfEl.addClass("ld-dup");

		let iconEl: HTMLElement | null = null;
		if (expandable) {
			iconEl = selfEl.createDiv({ cls: ["tree-item-icon", "collapse-icon", "nav-folder-collapse-indicator"] });
			setIcon(iconEl, "right-triangle");
		}

		const inner = selfEl.createDiv({
			cls: ["tree-item-inner", expandable ? "nav-folder-title-content" : "nav-file-title-content"],
			text: node.display,
		});
		if (node.subpath) inner.createSpan({ cls: "ld-subpath", text: node.subpath });

		if (node.status === "cycle" || node.status === "dup") {
			const flair = selfEl.createDiv({ cls: "tree-item-flair-outer" }).createSpan({
				cls: ["tree-item-flair", "ld-marker"],
			});
			setIcon(flair, node.status === "cycle" ? "rotate-ccw" : "copy");
			flair.setAttr("aria-label", node.status === "cycle" ? t("markerCycle") : t("markerDup"));
			const jump = (ev: Event) => {
				ev.stopPropagation();
				ev.preventDefault();
				if (node.refId) this.jumpTo(node.refId);
			};
			flair.addEventListener("pointerup", jump);
			flair.addEventListener("click", jump);
		}

		let childrenEl: HTMLElement | null = null;
		if (expandable) {
			const open = this.expanded.has(node.id);
			itemEl.toggleClass("is-collapsed", !open);
			iconEl?.toggleClass("is-collapsed", !open);
			selfEl.setAttr("aria-expanded", String(open));
			if (open) {
				childrenEl = itemEl.createDiv({ cls: ["tree-item-children", "nav-folder-children"] });
				for (const c of tree.children(node)) this.renderNode(tree, c, childrenEl);
			}
		}

		this.rendered.set(node.id, { node, tree, itemEl, selfEl, iconEl, childrenEl });
		this.bindRow(node, selfEl);
	}

	private bindRow(node: TreeNode, selfEl: HTMLElement): void {
		const expandable = node.hasChildren && node.status !== "cycle";
		const expandMode = this.host.settings.clickAction === "expand";
		const inChevron = (ev: Event) => !!(ev.target as HTMLElement | null)?.closest(".collapse-icon");

		selfEl.addEventListener("pointerdown", (ev) => {
			if (ev.pointerType !== "touch") return;
			this.longPressFired = false;
			this.cancelLongPress();
			this.longPressTimer = window.setTimeout(() => {
				this.longPressTimer = null;
				this.longPressFired = true;
				this.showMenu(node, ev);
			}, 500);
		});
		for (const type of ["pointermove", "pointercancel", "pointerleave"] as const) {
			selfEl.addEventListener(type, () => this.cancelLongPress());
		}

		selfEl.addEventListener("pointerup", (ev) => {
			this.cancelLongPress();
			if (ev.button !== 0) return;
			ev.stopPropagation();
			this.setFocus(node.id, false);
			if (this.longPressFired) {
				this.longPressFired = false;
				return;
			}
			if (inChevron(ev)) {
				if (expandable) this.toggle(node);
				return;
			}
			if (expandMode) return; // handled by click/dblclick below
			void this.openNode(node, ev);
		});

		selfEl.addEventListener("click", (ev) => {
			ev.stopPropagation();
			if (inChevron(ev)) return;
			if (expandMode) {
				if (ev.detail === 2) return; // dblclick follows
				if (expandable) this.toggle(node);
				else void this.openNode(node, ev);
				return;
			}
			if (ev.detail === 0) void this.openNode(node, ev); // keyboard activation
		});

		selfEl.addEventListener("dblclick", (ev) => {
			ev.stopPropagation();
			if (!expandMode || inChevron(ev)) return;
			void this.openNode(node, ev);
		});

		selfEl.addEventListener("contextmenu", (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			this.showMenu(node, ev);
		});
	}

	private cancelLongPress(): void {
		if (this.longPressTimer !== null) {
			window.clearTimeout(this.longPressTimer);
			this.longPressTimer = null;
		}
	}

	// ------------------------------------------------------------- actions

	toggle(node: TreeNode): void {
		const r = this.rendered.get(node.id);
		if (!r) return;
		if (this.expanded.has(node.id)) {
			this.expanded.delete(node.id);
			this.collapseDom(r);
		} else {
			this.expanded.add(node.id);
			this.expandDom(r);
		}
		this.afterRender();
	}

	private collapseDom(r: Rendered): void {
		for (const [id, x] of [...this.rendered]) {
			if (x !== r && r.itemEl.contains(x.itemEl)) this.rendered.delete(id);
		}
		r.childrenEl?.remove();
		r.childrenEl = null;
		r.itemEl.addClass("is-collapsed");
		r.iconEl?.addClass("is-collapsed");
		r.selfEl.setAttr("aria-expanded", "false");
		if (this.focusedId && !this.rendered.has(this.focusedId)) this.setFocus(r.node.id, false);
	}

	private expandDom(r: Rendered): void {
		if (r.childrenEl) return;
		r.childrenEl = r.itemEl.createDiv({ cls: ["tree-item-children", "nav-folder-children"] });
		for (const c of r.tree.children(r.node)) this.renderNode(r.tree, c, r.childrenEl);
		r.itemEl.removeClass("is-collapsed");
		r.iconEl?.removeClass("is-collapsed");
		r.selfEl.setAttr("aria-expanded", "true");
	}

	collapseAll(): void {
		this.expanded = new Set(this.trees.map((tr) => tr.root.id));
		this.render();
	}

	async openNode(node: TreeNode, ev: MouseEvent | KeyboardEvent): Promise<void> {
		const mod = Keymap.isModEvent(ev);
		const leaf = this.targetLeaf(mod);
		const file = node.path ? this.mdFileAt(node.path) : null;
		// `file-open` fires more than once while opening (openFile, then
		// setActiveLeaf), so the guard stays up for a moment instead of being
		// consumed by the first event.
		this.pendingOpen = file?.path ?? node.target;
		if (file && !node.subpath) {
			await leaf.openFile(file);
		} else {
			// Unresolved (creates the note) or heading/block link: let Obsidian resolve it.
			this.app.workspace.setActiveLeaf(leaf, { focus: false });
			await this.app.workspace.openLinkText(node.target + node.subpath, node.parent?.path ?? "", false);
		}
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		const opened = this.app.workspace.getActiveFile()?.path ?? this.pendingOpen;
		this.pendingOpen = opened;
		window.setTimeout(() => {
			if (this.pendingOpen === opened) this.pendingOpen = null;
		}, 400);
	}

	/** True while a note opened from this tree is settling in (see openNode). */
	isOwnOpen(path: string): boolean {
		return this.pendingOpen === path;
	}

	private targetLeaf(mod: PaneType | boolean): WorkspaceLeaf {
		if (mod) return this.app.workspace.getLeaf(mod);
		return this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit) ?? this.app.workspace.getLeaf(false);
	}

	private showMenu(node: TreeNode, ev: MouseEvent | PointerEvent): void {
		const menu = new Menu();
		const file = node.path ? this.mdFileAt(node.path) : null;
		if (file) {
			if (this.host.onSetRoot) {
				const setRoot = this.host.onSetRoot;
				menu.addItem((i) =>
					i
						.setTitle(t("menuSetRoot"))
						.setIcon("folder-tree")
						.onClick(() => setRoot(file.path)),
				);
			}
			menu.addItem((i) =>
				i
					.setTitle(t("menuOpenNewTab"))
					.setIcon("file-plus")
					.onClick(() => void this.app.workspace.getLeaf("tab").openFile(file)),
			);
			menu.addSeparator();
			this.app.workspace.trigger("file-menu", menu, file, "link-directory");
		}
		menu.showAtMouseEvent(ev);
	}

	/** Scroll to and flash a rendered occurrence. */
	jumpTo(id: string): void {
		const r = this.rendered.get(id);
		if (!r) return;
		r.selfEl.scrollIntoView({ block: "center" });
		r.itemEl.addClass("ld-flash");
		window.setTimeout(() => r.itemEl.removeClass("ld-flash"), 1200);
	}

	/**
	 * Expand down to `path` and scroll there. Prefers an occurrence that is
	 * already on screen; otherwise follows the shortest link path from the
	 * first root that reaches it.
	 */
	reveal(path: string): boolean {
		const shown = [...this.rendered.values()].find((r) => r.node.path === path);
		if (shown) {
			this.jumpTo(shown.node.id);
			return true;
		}
		for (const tree of this.trees) {
			const chain = tree.findShortestPath(path);
			if (!chain) continue;
			let cur: Rendered | undefined = this.rendered.get(tree.root.id);
			for (let i = 1; i < chain.length && cur; i++) {
				if (!this.expanded.has(cur.node.id)) {
					this.expanded.add(cur.node.id);
					this.expandDom(cur);
				}
				const next = chain[i];
				cur = [...this.rendered.values()].find((r) => r.node.parent === cur?.node && r.node.path === next);
			}
			this.afterRender();
			if (cur) {
				this.jumpTo(cur.node.id);
				return true;
			}
		}
		return false;
	}

	// ------------------------------------------------------------- keyboard

	private visibleRows(): Rendered[] {
		const out: Rendered[] = [];
		for (const el of Array.from(this.filesEl.querySelectorAll<HTMLElement>(".tree-item"))) {
			const id = el.dataset["ldId"];
			const r = id ? this.rendered.get(id) : undefined;
			if (r) out.push(r);
		}
		return out;
	}

	private setFocus(id: string | null, scroll = true): void {
		this.focusedId = id;
		for (const r of this.rendered.values()) r.selfEl.toggleClass("has-focus", r.node.id === id);
		if (scroll && id) this.rendered.get(id)?.selfEl.scrollIntoView({ block: "nearest" });
	}

	private onKeyDown(ev: KeyboardEvent): void {
		const rows = this.visibleRows();
		if (rows.length === 0) return;
		let idx = rows.findIndex((r) => r.node.id === this.focusedId);
		const cur = idx >= 0 ? rows[idx] : undefined;
		const canExpand = (r: Rendered) => r.node.hasChildren && r.node.status !== "cycle";

		switch (ev.key) {
			case "ArrowDown":
				idx = Math.min(rows.length - 1, idx + 1);
				break;
			case "ArrowUp":
				idx = Math.max(0, idx - 1);
				break;
			case "Home":
				idx = 0;
				break;
			case "End":
				idx = rows.length - 1;
				break;
			case "ArrowRight":
				if (!cur) idx = 0;
				else if (canExpand(cur) && !this.expanded.has(cur.node.id)) this.toggle(cur.node);
				else if (this.expanded.has(cur.node.id)) idx = Math.min(rows.length - 1, idx + 1);
				break;
			case "ArrowLeft":
				if (!cur) idx = 0;
				else if (this.expanded.has(cur.node.id) && cur.node.kind !== "root") this.toggle(cur.node);
				else if (cur.node.parent) idx = rows.findIndex((r) => r.node.id === cur.node.parent?.id);
				break;
			case "Enter":
			case " ":
				if (cur) void this.openNode(cur.node, ev);
				break;
			default:
				return;
		}
		ev.preventDefault();
		ev.stopPropagation();
		const next = rows[idx] ?? cur;
		if (next) this.setFocus(next.node.id);
	}

	// ---------------------------------------------------------- highlight

	setActivePath(path: string | null): void {
		this.activePath = path;
		this.updateActive();
	}

	private updateActive(): void {
		for (const r of this.rendered.values()) {
			r.selfEl.toggleClass("is-active", r.node.path !== null && r.node.path === this.activePath);
		}
	}

	/** Is `path` shown anywhere (as a root or a rendered node)? */
	shows(path: string): boolean {
		if (this.trees.some((tr) => tr.root.path === path)) return true;
		for (const r of this.rendered.values()) if (r.node.path === path) return true;
		return false;
	}

	private updateLegend(): void {
		const present = new Set<NodeStatus>();
		for (const r of this.rendered.values()) present.add(r.node.status);
		this.legendEl.empty();
		const add = (icon: string, text: string) => {
			const item = this.legendEl.createSpan({ cls: "ld-legend-item" });
			setIcon(item.createSpan({ cls: "ld-legend-icon" }), icon);
			item.createSpan({ text });
		};
		if (present.has("cycle")) add("rotate-ccw", t("legendCycle"));
		if (present.has("dup")) add("copy", t("legendDup"));
		if (present.has("unresolved")) add("file-question", t("legendUnresolved"));
		this.legendEl.toggle(this.legendEl.childElementCount > 0);
	}

	// --------------------------------------------------------------- utils

	private mdFileAt(path: string): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile && f.extension === "md" ? f : null;
	}

	/** Snapshot of what is on screen (used by tests / CLI eval). */
	dumpState(): DumpedNode[] {
		const walk = (node: TreeNode): DumpedNode => {
			const r = this.rendered.get(node.id);
			const out: DumpedNode = {
				display: node.display,
				path: node.path,
				status: node.status,
				depth: node.depth,
				expanded: this.expanded.has(node.id),
				hasChildren: node.hasChildren,
			};
			if (r?.childrenEl) {
				out.children = [...this.rendered.values()].filter((x) => x.node.parent === node).map((x) => walk(x.node));
			}
			return out;
		};
		return this.trees.map((tr) => walk(tr.root));
	}
}
