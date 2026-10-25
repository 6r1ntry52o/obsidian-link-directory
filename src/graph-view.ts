import { ItemView, Keymap, Menu, TAbstractFile, TFile, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import { MetadataLinkSource } from "./adapter";
import { t } from "./i18n";
import {
	buildLayers,
	edgeKey,
	focusOn,
	orderLayers,
	pathToRoot,
	place,
	type Direction,
	type EdgeKind,
	type GraphEdge,
	type GraphNode,
	type Highlight,
	type LayeredGraph,
	type Point,
} from "./layered";
import type LinkDirectoryPlugin from "./main";

export const VIEW_TYPE_TREE_GRAPH = "link-directory-graph";

const DOT_R = 5;
const ROOT_R = 7;
const HIT_R = 11;
/** Room per dot along a row growing down (names hidden or under the dot). */
const DOT_STEP = 26;
/** Room per dot along a column growing right (name beside the dot). */
const ROW_STEP = 22;
const MAX_LABEL = 120;
const LABEL_GAP = 12;
/** Space between a dot and its name. */
const LABEL_OFFSET = 5;
// Gaps after a layer's names: where the lines bend towards the next layer.
// Layers sit clearly further apart than the sub-rows of a wrapped layer.
const GAPS_DOWN = { layerGap: 48, subGap: 8 };
const GAPS_RIGHT = { layerGap: 52, subGap: 16 };
/** Straight run into a layer before a line reaches its dot. */
const ENTRY_RUN = 6;
const MARGIN = 24;
const ORPHAN_CAP = 200;
const DRAG_SLOP = 4;
const READABLE_SCALE = 0.75;

/**
 * The link graph seen from one root note: a row per link distance, every note
 * once, and the routes from the root to the open note drawn in the accent
 * colour. Notes in the root's folder that the root cannot reach are listed
 * underneath.
 */
export class TreeGraphView extends ItemView {
	override navigation = false;

	/** What is drawn: the whole graph, or only the part around the route (focus). */
	private graph: LayeredGraph | null = null;
	/** Every note the root reaches, drawn or not. */
	private full: LayeredGraph | null = null;
	/** The open note the focused layout was made for (undefined = not focused). */
	private focusedOn: string | null | undefined = undefined;
	private points = new Map<string, Point>();
	/** Per layer, from place(): where lines come in, and where they leave (past its names). */
	private starts: number[] = [];
	private ports: number[] = [];
	/** Width of each (truncated) name, and the name line height: for the active note's marker. */
	private labelW = new Map<string, number>();
	private lineHeight = 15;
	private layoutKey = "";
	private nodeEls = new Map<string, SVGGElement>();
	private edgeEls = new Map<string, SVGPathElement>();
	private activePath: string | null = null;
	/** Root while following the active note (notes opened from the graph do not move it). */
	private followedPath: string | null = null;
	private orphans: TFile[] = [];
	private lastNoteLeaf: WorkspaceLeaf | null = null;
	private pendingOpen: string | null = null;

	private tx = 0;
	private ty = 0;
	private k = 1;
	private fitted = false;

	private rootLabelEl!: HTMLElement;
	private pinBtnEl!: HTMLElement;
	private dirBtnEl!: HTMLElement;
	private namesBtnEl!: HTMLElement;
	private focusBtnEl!: HTMLElement;
	private canvasEl!: HTMLElement;
	private svgEl!: SVGSVGElement;
	private viewportEl!: SVGGElement;
	private bandsEl!: SVGGElement;
	private edgesEl!: SVGGElement;
	private nodesEl!: SVGGElement;
	private emptyEl!: HTMLElement;
	private legendEl!: HTMLElement;
	private noticeEl!: HTMLElement;
	private orphansEl!: HTMLDetailsElement;

	private readonly rerender = debounce(() => this.render(), 300, true);

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: LinkDirectoryPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_TREE_GRAPH;
	}

	getDisplayText(): string {
		return t("graphViewTitle");
	}

	override getIcon(): string {
		return "network";
	}

	override async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("ldg");

		const header = root.createDiv({ cls: "nav-header" });
		const buttons = header.createDiv({ cls: "nav-buttons-container" });
		this.pinBtnEl = this.actionButton(buttons, "pin", "", () => this.plugin.toggleGraphPin());
		this.dirBtnEl = this.actionButton(buttons, "arrow-down", "", () => {
			const s = this.plugin.settings;
			s.graphDirection = s.graphDirection === "right" ? "down" : "right";
			void this.plugin.saveSettings();
		});
		this.namesBtnEl = this.actionButton(buttons, "tags", "", () => {
			const s = this.plugin.settings;
			s.graphLabels = s.graphLabels === "all" ? "route" : "all";
			void this.plugin.saveSettings();
		});
		this.focusBtnEl = this.actionButton(buttons, "focus", "", () => {
			const s = this.plugin.settings;
			s.graphFocus = !s.graphFocus;
			void this.plugin.saveSettings();
		});
		this.actionButton(buttons, "scan", t("graphFit"), () => this.fit());
		this.actionButton(buttons, "refresh-cw", t("refresh"), () => this.render());
		this.rootLabelEl = header.createDiv({ cls: "ld-root-label" });

		this.canvasEl = root.createDiv({ cls: "ldg-canvas" });
		this.svgEl = this.canvasEl.createSvg("svg");
		const defs = this.svgEl.createSvg("defs");
		const marker = defs.createSvg("marker", {
			attr: { id: "ldg-arrow", viewBox: "0 0 8 8", refX: "7", refY: "4", markerWidth: "7", markerHeight: "7", orient: "auto" },
		});
		marker.createSvg("path", { cls: "ldg-arrow", attr: { d: "M0,0 L8,4 L0,8 z" } });
		this.viewportEl = this.svgEl.createSvg("g");
		this.bandsEl = this.viewportEl.createSvg("g");
		this.edgesEl = this.viewportEl.createSvg("g");
		this.nodesEl = this.viewportEl.createSvg("g");
		this.emptyEl = this.canvasEl.createDiv({ cls: "ld-empty", text: t("graphRootNone") });
		this.bindCanvas();

		this.legendEl = root.createDiv({ cls: "ldg-legend" });
		this.noticeEl = root.createDiv({ cls: "ldg-notice" });
		this.orphansEl = root.createEl("details", { cls: "ldg-orphans" });
		this.orphansEl.open = true;

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf && leaf !== this.leaf && leaf.view.getViewType() === "markdown") this.lastNoteLeaf = leaf;
			}),
		);
		this.registerEvent(this.app.workspace.on("file-open", (file) => this.onFileOpen(file)));
		this.registerEvent(this.app.metadataCache.on("resolve", (file) => this.onResolve(file)));
		this.registerEvent(this.app.vault.on("create", () => this.rerender()));
		this.registerEvent(this.app.vault.on("delete", () => this.rerender()));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.onRename(file, oldPath)));

		this.app.workspace.onLayoutReady(() => {
			const active = this.app.workspace.getActiveFile();
			this.activePath = active?.extension === "md" ? active.path : null;
			this.followedPath = this.activePath;
			this.render();
		});
	}

	override onResize(): void {
		if (this.fitted) return;
		this.fit(true);
		if (this.fitted && this.activePath) this.ensureVisible(this.activePath);
	}

	applySettings(): void {
		this.rerender();
	}

	// ------------------------------------------------------------ rendering

	render(): void {
		const rootFile = this.rootFile();
		this.rootLabelEl.setText(rootFile?.path ?? "");
		this.updateHeader();
		this.bandsEl.empty();
		this.edgesEl.empty();
		this.nodesEl.empty();
		this.nodeEls.clear();
		this.edgeEls.clear();
		this.points.clear();

		if (!rootFile) {
			this.graph = null;
			this.full = null;
			this.orphans = [];
			this.emptyEl.setText(this.following ? t("graphRootNoneActive") : t("graphRootNone"));
			this.emptyEl.show();
			this.renderOrphans(null);
			this.applyHighlight(false);
			return;
		}
		this.emptyEl.hide();

		const s = this.plugin.settings;
		const full = buildLayers(new MetadataLinkSource(this.app), rootFile.path, s);
		orderLayers(full);
		this.full = full;
		// Focus: only the route to the open note and the notes linked from it
		// (the root and its links when there is no route), laid out afresh.
		let g = full;
		let route: string | null = null;
		if (s.graphFocus) {
			const hl = this.activePath ? pathToRoot(full, this.activePath) : null;
			route = hl ? this.activePath : null;
			g = focusOn(full, hl?.nodes ?? new Set([full.root]));
			orderLayers(g);
		}
		this.focusedOn = s.graphFocus ? this.activePath : undefined;
		this.graph = g;

		const right = s.graphDirection === "right";
		const allNames = s.graphLabels === "all";
		// A new root, a different layout or (focused) another route starts from a fresh fit.
		const layoutKey = [g.root, s.graphDirection, s.graphLabels, s.graphMaxLength, s.graphFocus ? `focus:${route ?? ""}` : ""].join("|");
		if (layoutKey !== this.layoutKey) this.fitted = false;
		this.layoutKey = layoutKey;
		this.svgEl.toggleClass("is-names-route", !allNames);

		const { measure, lineHeight } = this.measurer();
		this.lineHeight = lineHeight;
		const labels = new Map<string, string>();
		const labelW = this.labelW;
		labelW.clear();
		for (const n of g.nodes.values()) {
			const label = truncate(n.display, MAX_LABEL, measure);
			labels.set(n.id, label);
			labelW.set(n.id, measure(label));
		}
		// Growing down, names sit under the dots, so a row needs room for them
		// only when every name is shown. Growing right, they sit beside the dots,
		// so a column is as wide as its own longest name (in both name modes, so
		// hovering never runs a name into the next column).
		const slot = (id: string) =>
			right ? ROW_STEP : allNames ? Math.max(DOT_STEP, (labelW.get(id) ?? 0) + LABEL_GAP) : DOT_STEP;
		const depth = (id: string) => {
			const r = radius(g, id);
			return right ? r + LABEL_OFFSET + (labelW.get(id) ?? 0) : r + LABEL_OFFSET + lineHeight;
		};
		const placed = place(g, slot, depth, {
			direction: s.graphDirection,
			...(right ? GAPS_RIGHT : GAPS_DOWN),
			gap: 0,
			maxLength: s.graphMaxLength,
		});
		this.points = placed.points;
		this.starts = placed.starts;
		this.ports = placed.ports;
		this.drawBands(g, right, depth);
		for (const e of g.edges) this.drawEdge(e);
		for (const n of g.nodes.values()) this.drawNode(n, labels.get(n.id) ?? n.display, right);

		this.orphans = this.findOrphans(full, rootFile);
		this.renderOrphans(rootFile);
		// A fresh layout fits first, then reveals the open note if the fit left it off screen.
		const fresh = !this.fitted;
		if (fresh) this.fit(true);
		this.applyHighlight(fresh);
	}

	/** A faint band behind each layer, so a wrapped layer still reads as one row. */
	private drawBands(g: LayeredGraph, right: boolean, depth: (id: string) => number): void {
		const pad = 10;
		g.layers.forEach((layer, d) => {
			if (d === 0) return;
			let x0 = Infinity;
			let x1 = -Infinity;
			let y0 = Infinity;
			let y1 = -Infinity;
			for (const id of layer) {
				const p = this.points.get(id);
				if (!p) continue;
				const [l, r, t, b] = right
					? [p.x - pad, p.x + depth(id) + 4, p.y - p.w / 2, p.y + p.w / 2]
					: [p.x - p.w / 2, p.x + p.w / 2, p.y - pad, p.y + depth(id) + 4];
				x0 = Math.min(x0, l);
				x1 = Math.max(x1, r);
				y0 = Math.min(y0, t);
				y1 = Math.max(y1, b);
			}
			if (x0 === Infinity) return;
			this.bandsEl.createSvg("rect", {
				cls: "ldg-band",
				attr: { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 8, ry: 8 },
			});
		});
	}

	private drawEdge(e: GraphEdge): void {
		const a = this.points.get(e.from);
		const b = this.points.get(e.to);
		if (!a || !b) return;
		const g = this.graph;
		const layer = (id: string) => g?.nodes.get(id)?.depth ?? 0;
		const port = (id: string) => this.ports[layer(id)] ?? 0;
		const el = this.edgesEl.createSvg("path", {
			cls: ["ldg-edge", `is-${e.kind}`],
			attr: {
				d: edgePath(
					e.kind,
					a,
					b,
					radius(g, e.from),
					radius(g, e.to),
					this.plugin.settings.graphDirection,
					port(e.from),
					port(e.to),
					this.starts[layer(e.to)] ?? 0,
				),
			},
		});
		if (e.kind !== "down") el.setAttr("marker-end", "url(#ldg-arrow)");
		this.edgeEls.set(edgeKey(e.from, e.to), el);
	}

	private drawNode(n: GraphNode, label: string, right: boolean): void {
		const p = this.points.get(n.id);
		if (!p) return;
		const el = this.nodesEl.createSvg("g", {
			cls: "ldg-node",
			attr: { transform: `translate(${p.x},${p.y})`, "data-id": n.id },
		});
		if (n.depth === 0) el.addClass("is-root");
		if (n.path === null) el.addClass("is-unresolved");
		el.createSvg("title").textContent = n.path ?? n.target;
		el.createSvg("circle", { cls: "ldg-hit", attr: { r: HIT_R } });
		const r = radius(this.graph, n.id);
		el.createSvg("circle", { cls: "ldg-dot", attr: { r } });
		el.createSvg("text", {
			cls: "ldg-label",
			attr: right
				? { x: r + LABEL_OFFSET, y: 0, "text-anchor": "start", "dominant-baseline": "central" }
				: { x: 0, y: r + LABEL_OFFSET, "text-anchor": "middle", "dominant-baseline": "hanging" },
		}).textContent = label;
		this.nodeEls.set(n.id, el);
	}

	private updateHeader(): void {
		const s = this.plugin.settings;
		setIcon(this.pinBtnEl, this.following ? "pin" : "pin-off");
		this.pinBtnEl.setAttr("aria-label", this.following ? t("pin") : t("unpin"));
		this.pinBtnEl.toggleClass("is-active", !this.following);
		const right = s.graphDirection === "right";
		setIcon(this.dirBtnEl, right ? "arrow-right" : "arrow-down");
		this.dirBtnEl.setAttr("aria-label", right ? t("graphDirRight") : t("graphDirDown"));
		const all = s.graphLabels === "all";
		setIcon(this.namesBtnEl, all ? "tags" : "tag");
		this.namesBtnEl.setAttr("aria-label", all ? t("graphNamesAll") : t("graphNamesRoute"));
		this.focusBtnEl.toggleClass("is-active", s.graphFocus);
		this.focusBtnEl.setAttr("aria-label", s.graphFocus ? t("graphFocusOn") : t("graphFocusOff"));
	}

	/**
	 * Colour the routes to the active note without re-laying out: the main
	 * route in the full accent, the other shortest ones in a pale accent, the
	 * rest of the lines dimmed. The active note's name gets a marker like the
	 * current file in the File Explorer.
	 */
	private applyHighlight(center: boolean): void {
		for (const el of this.edgeEls.values()) el.removeClass("is-route", "is-main");
		for (const el of this.nodeEls.values()) el.removeClass("is-route", "is-main", "is-active");
		for (const el of Array.from(this.nodesEl.querySelectorAll(".ldg-marker"))) el.remove();

		const g = this.graph;
		const id = this.activePath;
		const hl: Highlight | null = g && id ? pathToRoot(g, id) : null;
		this.svgEl.toggleClass("has-route", hl !== null && hl.edges.size > 0);
		if (hl && id) {
			// Re-append so coloured edges sit above the rest, the main route on top.
			for (const key of hl.edges) {
				const el = this.edgeEls.get(key);
				if (!el) continue;
				el.addClass("is-route");
				this.edgesEl.appendChild(el);
			}
			for (const key of hl.main) {
				const el = this.edgeEls.get(key);
				if (!el) continue;
				el.addClass("is-main");
				this.edgesEl.appendChild(el);
			}
			for (const n of hl.nodes) this.nodeEls.get(n)?.addClass("is-route");
			for (const n of hl.mainNodes) this.nodeEls.get(n)?.addClass("is-main");
			const el = this.nodeEls.get(id);
			if (el) {
				el.addClass("is-active");
				el.prepend(this.marker(id));
			}
			if (center) this.ensureVisible(id);
		}

		const unreachable = g !== null && id !== null && hl === null;
		this.noticeEl.toggle(unreachable);
		if (unreachable) this.noticeEl.setText(t("graphUnreachable"));
		this.renderLegend(hl);
		this.markActiveOrphan(unreachable && center);
	}

	/** A filled box behind the active note's name (drawn under its dot and name). */
	private marker(id: string): SVGRectElement {
		const r = radius(this.graph, id);
		const w = (this.labelW.get(id) ?? 0) + 8;
		const h = this.lineHeight + 4;
		const [x, y] =
			this.plugin.settings.graphDirection === "right" ? [r + LABEL_OFFSET - 4, -h / 2] : [-w / 2, r + LABEL_OFFSET - 2];
		return createSvg("rect", { cls: "ldg-marker", attr: { x, y, width: w, height: h, rx: 4, ry: 4 } });
	}

	private renderLegend(hl: Highlight | null): void {
		const el = this.legendEl;
		el.empty();
		const g = this.graph;
		if (!g || (this.full?.nodes.size ?? 0) <= 1) {
			el.hide();
			return;
		}
		el.show();
		const item = (cls: string, text: string) => {
			const it = el.createSpan({ cls: "ldg-legend-item" });
			it.createSpan({ cls: ["ldg-swatch", cls] });
			it.createSpan({ text });
		};
		item("is-down", t("graphLegendLink"));
		if (g.edges.some((e) => e.kind !== "down")) item("is-faint", t("graphLegendFaint"));
		if (hl && hl.edges.size > 0) {
			item("is-main", t("graphLegendRoute"));
			if (hl.edges.size > hl.main.size) item("is-route", t("graphLegendRouteAlt"));
		}
		const hidden = (this.full?.nodes.size ?? 0) - g.nodes.size;
		if (hidden > 0) el.createSpan({ cls: "ldg-legend-item", text: t("graphHidden").replace("{n}", String(hidden)) });
		if (g.truncated) el.createSpan({ cls: "ldg-legend-item mod-warning", text: t("graphTruncated") });
	}

	// --------------------------------------------------------- unreachable

	/** Only for a pinned root: "unreachable" means little when the root moves with every note. */
	private findOrphans(g: LayeredGraph, rootFile: TFile): TFile[] {
		if (this.following) return [];
		const scope = this.plugin.settings.graphOrphanScope.trim().replace(/\/+$/, "") || (rootFile.parent?.path ?? "");
		const prefix = scope === "" || scope === "/" ? "" : `${scope}/`;
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(prefix) && !g.nodes.has(f.path))
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	private renderOrphans(rootFile: TFile | null): void {
		const el = this.orphansEl;
		el.empty();
		if (!rootFile || this.orphans.length === 0) {
			el.hide();
			return;
		}
		el.show();
		el.createEl("summary", { text: `${t("graphOrphans")}（${this.orphans.length}）` });
		for (const f of this.orphans.slice(0, ORPHAN_CAP)) {
			const row = el.createDiv({ cls: "ldg-orphan", attr: { "data-path": f.path } });
			row.createSpan({ cls: "ldg-orphan-name", text: f.basename });
			row.createSpan({ cls: "ldg-orphan-folder", text: f.parent?.name ?? "" });
			row.addEventListener("click", (ev) => void this.openFile(f, ev));
			row.addEventListener("contextmenu", (ev) => {
				ev.preventDefault();
				this.showMenu(f, ev);
			});
		}
		const rest = this.orphans.length - ORPHAN_CAP;
		if (rest > 0) el.createDiv({ cls: "ldg-orphan-more", text: t("graphOrphansMore").replace("{n}", String(rest)) });
	}

	private markActiveOrphan(scroll: boolean): void {
		for (const row of Array.from(this.orphansEl.querySelectorAll(".ldg-orphan"))) {
			const on = row.getAttribute("data-path") === this.activePath;
			row.toggleClass("is-active", on);
			if (on && scroll) {
				this.orphansEl.open = true;
				row.scrollIntoView({ block: "nearest" });
			}
		}
	}

	// ----------------------------------------------------------- pan & zoom

	private applyTransform(): void {
		this.viewportEl.setAttr("transform", `translate(${this.tx} ${this.ty}) scale(${this.k})`);
	}

	private zoomAt(cx: number, cy: number, factor: number): void {
		const k = Math.min(3, Math.max(0.15, this.k * factor));
		const f = k / this.k;
		this.tx = cx - (cx - this.tx) * f;
		this.ty = cy - (cy - this.ty) * f;
		this.k = k;
	}

	/**
	 * Scale the graph into view (never above 100%): the root's side aligned
	 * to the edge, the other axis centred. The first, automatic fit stops at a
	 * readable size and lets the graph overflow; the button fits everything.
	 */
	fit(readable = false): void {
		const W = this.canvasEl.clientWidth;
		const H = this.canvasEl.clientHeight;
		if (W === 0 || H === 0 || this.points.size === 0) return;
		const box = this.nodesEl.getBBox(); // dots and visible names, in graph units
		if (box.width === 0 && box.height === 0) return;
		const floor = readable ? READABLE_SCALE : 0.15;
		this.k = Math.max(floor, Math.min(1, (W - 2 * MARGIN) / box.width, (H - 2 * MARGIN) / box.height));
		if (this.plugin.settings.graphDirection === "right") {
			this.tx = MARGIN - box.x * this.k;
			this.ty = H / 2 - (box.y + box.height / 2) * this.k;
		} else {
			this.tx = W / 2 - (box.x + box.width / 2) * this.k;
			this.ty = MARGIN - box.y * this.k;
		}
		this.fitted = true;
		this.applyTransform();
	}

	/** Pan (keeping the zoom) so the node and its name are on screen, like the File Explorer's auto-reveal. */
	private ensureVisible(id: string): void {
		const p = this.points.get(id);
		const W = this.canvasEl.clientWidth;
		const H = this.canvasEl.clientHeight;
		if (!p || W === 0 || H === 0) return;
		const name = this.labelW.get(id) ?? 0;
		const reach = HIT_R + LABEL_OFFSET;
		const [x0, x1, y0, y1] =
			this.plugin.settings.graphDirection === "right"
				? [p.x - HIT_R, p.x + reach + name, p.y - HIT_R, p.y + HIT_R]
				: [p.x - Math.max(HIT_R, name / 2), p.x + Math.max(HIT_R, name / 2), p.y - HIT_R, p.y + reach + this.lineHeight];
		const k = this.k;
		if (x0 * k + this.tx >= MARGIN && x1 * k + this.tx <= W - MARGIN && y0 * k + this.ty >= MARGIN && y1 * k + this.ty <= H - MARGIN)
			return;
		this.tx = W / 2 - ((x0 + x1) / 2) * k;
		this.ty = H / 2 - ((y0 + y1) / 2) * k;
		this.applyTransform();
	}

	private bindCanvas(): void {
		const svg = this.svgEl;
		const pts = new Map<number, { x: number; y: number }>();
		let downNode: string | null = null;
		let moved = 0;
		let pinch: { dist: number; mx: number; my: number } | null = null;
		let longTimer: number | null = null;
		let longFired = false;

		const local = (ev: MouseEvent) => {
			const r = svg.getBoundingClientRect();
			return { x: ev.clientX - r.left, y: ev.clientY - r.top };
		};
		const nodeAt = (target: EventTarget | null) =>
			(target instanceof Element ? target.closest(".ldg-node")?.getAttribute("data-id") : null) ?? null;
		const pinchOf = () => {
			const [a, b] = [...pts.values()];
			if (!a || !b) return null;
			return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
		};
		const cancelLong = () => {
			if (longTimer !== null) window.clearTimeout(longTimer);
			longTimer = null;
		};

		svg.addEventListener("pointerdown", (ev) => {
			if (ev.pointerType === "mouse" && ev.button !== 0) return;
			try {
				svg.setPointerCapture(ev.pointerId);
			} catch {
				/* synthetic pointer (no active pointer to capture) */
			}
			pts.set(ev.pointerId, local(ev));
			if (pts.size === 1) {
				moved = 0;
				longFired = false;
				downNode = nodeAt(ev.target);
				if (ev.pointerType === "touch" && downNode) {
					const id = downNode;
					longTimer = window.setTimeout(() => {
						longTimer = null;
						longFired = true;
						const file = this.mdFileAt(id);
						if (file) this.showMenu(file, ev);
					}, 500);
				}
			} else {
				downNode = null;
				cancelLong();
				pinch = pinchOf();
			}
		});

		svg.addEventListener("pointermove", (ev) => {
			const prev = pts.get(ev.pointerId);
			if (!prev) return;
			const cur = local(ev);
			pts.set(ev.pointerId, cur);
			if (pts.size === 1) {
				moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
				if (moved <= DRAG_SLOP) return;
				cancelLong();
				this.tx += cur.x - prev.x;
				this.ty += cur.y - prev.y;
				this.applyTransform();
				return;
			}
			const p = pinchOf();
			if (pinch && p) {
				this.zoomAt(p.mx, p.my, p.dist / pinch.dist);
				this.tx += p.mx - pinch.mx;
				this.ty += p.my - pinch.my;
				this.applyTransform();
			}
			pinch = p;
			moved = Infinity;
		});

		const end = (ev: PointerEvent) => {
			if (!pts.delete(ev.pointerId)) return;
			cancelLong();
			if (pts.size < 2) pinch = null;
			if (pts.size > 0) return;
			const id = downNode;
			downNode = null;
			if (ev.type !== "pointerup" || moved > DRAG_SLOP || longFired || !id) return;
			const node = this.graph?.nodes.get(id);
			if (node) void this.openNode(node, ev);
		};
		svg.addEventListener("pointerup", end);
		svg.addEventListener("pointercancel", end);

		svg.addEventListener(
			"wheel",
			(ev) => {
				ev.preventDefault();
				const p = local(ev);
				this.zoomAt(p.x, p.y, Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)));
				this.applyTransform();
			},
			{ passive: false },
		);

		svg.addEventListener("contextmenu", (ev) => {
			ev.preventDefault();
			if (longFired) return;
			const id = nodeAt(ev.target);
			const file = id ? this.mdFileAt(id) : null;
			if (file) this.showMenu(file, ev);
		});
	}

	// ------------------------------------------------------------- actions

	private async openNode(node: GraphNode, ev: MouseEvent): Promise<void> {
		const file = node.path ? this.mdFileAt(node.path) : null;
		if (file) {
			await this.openFile(file, ev);
			return;
		}
		// Unresolved: let Obsidian create the note where the linking note would.
		const leaf = this.targetLeaf(ev);
		this.app.workspace.setActiveLeaf(leaf, { focus: false });
		await this.app.workspace.openLinkText(node.target, node.via ?? "", false);
	}

	private async openFile(file: TFile, ev: MouseEvent): Promise<void> {
		this.pendingOpen = file.path;
		const leaf = this.targetLeaf(ev);
		await leaf.openFile(file);
		// `file-open` only fires for the active leaf, and the click left this view active.
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		this.activePath = file.path;
		this.showActive(false);
		window.setTimeout(() => {
			if (this.pendingOpen === file.path) this.pendingOpen = null;
		}, 400);
	}

	/** The note pane to open into: never this view's own leaf. */
	private targetLeaf(ev: MouseEvent): WorkspaceLeaf {
		const ws = this.app.workspace;
		const mod = Keymap.isModEvent(ev);
		if (mod) return ws.getLeaf(mod);
		const notes = ws.getLeavesOfType("markdown").filter((l) => l !== this.leaf);
		if (this.lastNoteLeaf && notes.includes(this.lastNoteLeaf)) return this.lastNoteLeaf;
		return notes[0] ?? ws.getLeaf("split", "vertical");
	}

	private showMenu(file: TFile, ev: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle(t("graphMenuSetRoot"))
				.setIcon("network")
				.onClick(() => this.plugin.setGraphRoot(file.path)),
		);
		menu.addItem((i) =>
			i
				.setTitle(t("menuOpenNewTab"))
				.setIcon("file-plus")
				.onClick(() => void this.app.workspace.getLeaf("tab").openFile(file)),
		);
		menu.addSeparator();
		this.app.workspace.trigger("file-menu", menu, file, "link-directory-graph");
		menu.showAtMouseEvent(ev);
	}

	// -------------------------------------------------------------- events

	private onFileOpen(file: TFile | null): void {
		// null means a pane without a note took focus (often this view): keep the last highlight.
		if (!file || file.extension !== "md") return;
		this.activePath = file.path;
		const ownClick = this.pendingOpen === file.path;
		// Following: a note opened elsewhere becomes the root. One opened from the
		// graph keeps the root, so the route to it can be read.
		if (this.following && !ownClick && this.followedPath !== file.path) {
			this.followedPath = file.path;
			this.render();
			return;
		}
		this.showActive(!ownClick);
	}

	/** The open note changed: lay out again when the notes shown depend on it (focus), else only recolour. */
	private showActive(center: boolean): void {
		if (this.plugin.settings.graphFocus && this.focusedOn !== this.activePath) this.render();
		else this.applyHighlight(center);
	}

	private onResolve(file: TFile): void {
		if (this.full?.nodes.has(file.path)) this.rerender();
	}

	private onRename(file: TAbstractFile, oldPath: string): void {
		const s = this.plugin.settings;
		if (s.graphRootPath === oldPath) {
			s.graphRootPath = file.path;
			void this.plugin.saveSettings();
		}
		if (this.activePath === oldPath) this.activePath = file.path;
		if (this.followedPath === oldPath) this.followedPath = file.path;
		this.rerender();
	}

	// --------------------------------------------------------------- utils

	private get following(): boolean {
		return this.plugin.settings.graphRootMode !== "fixed";
	}

	/** The root the graph shows now (used when pinning it). */
	get rootPath(): string | null {
		return this.graph?.root ?? null;
	}

	private rootFile(): TFile | null {
		if (!this.following) {
			this.followedPath = null;
			return this.mdFileAt(this.plugin.settings.graphRootPath.trim());
		}
		// Back to following after a pin: start from the last note opened.
		this.followedPath ??= this.activePath;
		return this.followedPath ? this.mdFileAt(this.followedPath) : null;
	}

	private mdFileAt(path: string): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile && f.extension === "md" ? f : null;
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

	/** Text width and line height in the label font (canvas: works while the view is hidden). */
	private measurer(): { measure: (text: string) => number; lineHeight: number } {
		const probe = this.nodesEl.createSvg("text", { cls: "ldg-label" });
		probe.textContent = "M";
		const cs = getComputedStyle(probe);
		const font = `600 ${cs.fontSize} ${cs.fontFamily}`;
		const lineHeight = Math.ceil((Number.parseFloat(cs.fontSize) || 12) * 1.25);
		probe.remove();
		const ctx = document.createElement("canvas").getContext("2d");
		if (!ctx) return { measure: (s) => Array.from(s).length * 12, lineHeight };
		ctx.font = font;
		return { measure: (s) => ctx.measureText(s).width, lineHeight };
	}

	/** Snapshot of what is on screen (used by tests / CLI eval). */
	dumpState(): Record<string, unknown> | null {
		const g = this.graph;
		if (!g) return null;
		const name = (id: string) => g.nodes.get(id)?.display ?? id;
		const route = (keys: Iterable<string>) => [...keys].map((k) => k.split("\u0000").map(name).join(" → "));
		const hl = this.activePath ? pathToRoot(g, this.activePath) : null;
		const count = (sel: string) => this.edgesEl.querySelectorAll(sel).length;
		return {
			root: g.root,
			layers: g.layers.map((l) => l.map(name)),
			edges: {
				down: g.edges.filter((e) => e.kind === "down").length,
				same: g.edges.filter((e) => e.kind === "same").length,
				up: g.edges.filter((e) => e.kind === "up").length,
			},
			merged: Object.fromEntries(
				[...g.nodes.values()].filter((n) => n.parents.length > 1).map((n) => [n.display, n.parents.map(name)]),
			),
			active: this.activePath,
			focus: this.plugin.settings.graphFocus,
			hidden: (this.full?.nodes.size ?? 0) - g.nodes.size,
			route: hl ? route(hl.edges) : null,
			main: hl ? route(hl.main) : null,
			dom: {
				route: count(".ldg-edge.is-route"),
				main: count(".ldg-edge.is-main"),
				faint: count(".ldg-edge.is-same, .ldg-edge.is-up"),
				activeNode: this.nodesEl.querySelectorAll(".ldg-node.is-active").length,
				marker: this.nodesEl.querySelectorAll(".ldg-marker").length,
				dimmed: this.svgEl.hasClass("has-route"),
			},
			notice: this.noticeEl.isShown(),
			orphans: this.orphans.map((f) => f.path),
			activeOrphanRow: this.orphansEl.querySelector(".ldg-orphan.is-active")?.getAttribute("data-path") ?? null,
			transform: { tx: Math.round(this.tx), ty: Math.round(this.ty), k: Number(this.k.toFixed(3)) },
			layout: {
				direction: this.plugin.settings.graphDirection,
				names: this.plugin.settings.graphLabels,
				// sub-rows per layer (> 1 = the layer wrapped)
				rows: g.layers.map((l) => 1 + Math.max(...l.map((id) => this.points.get(id)?.sub ?? 0))),
				visibleNames: Array.from(this.nodesEl.querySelectorAll(".ldg-label")).filter(
					(el) => getComputedStyle(el).display !== "none",
				).length,
				extent: (() => {
					const b = this.nodesEl.getBBox();
					return { w: Math.round(b.width), h: Math.round(b.height) };
				})(),
			},
		};
	}
}

function radius(g: LayeredGraph | null, id: string): number {
	return g?.root === id ? ROOT_R : DOT_R;
}

/**
 * Edge geometry between two dots. Down links leave along the growth
 * direction; links back up bow sideways so they do not hide under the down
 * link between the same pair; links within a row bow off the straight line
 * (to its left, so a pair in both directions splits apart).
 */
function edgePath(
	kind: EdgeKind,
	a: Point,
	b: Point,
	ra: number,
	rb: number,
	dir: Direction,
	portFrom: number,
	portTo: number,
	startTo: number,
): string {
	const down = dir === "down";
	if (kind === "down") {
		// Straight out past the layer's names (under the source's own name), bend
		// only in the gap between layers, then straight in to the dot — through a
		// wrapped layer that runs between the staggered rows, not across names.
		const entry = startTo - rb - ENTRY_RUN;
		const m = (entry - portFrom) / 2;
		if (down) {
			return `M${a.x},${a.y + ra} V${portFrom} C${a.x},${portFrom + m} ${b.x},${entry - m} ${b.x},${entry} V${b.y - rb}`;
		}
		return `M${a.x + ra},${a.y} H${portFrom} C${portFrom + m},${a.y} ${entry - m},${b.y} ${entry},${b.y} H${b.x - rb}`;
	}
	if (kind === "up") {
		// From the back of the source dot to just past the target's name, bowed
		// sideways so it does not hide under the down link between the same pair.
		if (down) {
			const y1 = a.y - ra;
			const m = (portTo - y1) / 2;
			return `M${a.x},${y1} C${a.x + 24},${y1 + m} ${b.x + 24},${portTo - m} ${b.x},${portTo}`;
		}
		const x1 = a.x - ra;
		const m = (portTo - x1) / 2;
		return `M${x1},${a.y} C${x1 + m},${a.y + 24} ${portTo - m},${b.y + 24} ${portTo},${b.y}`;
	}
	// Within a layer: bow away from the names (above a row, left of a column).
	// The two directions bow by different amounts so a pair does not overlap.
	const forward = down ? b.x > a.x : b.y > a.y;
	const dist = down ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
	const bow = Math.min(40, 10 + dist * 0.15) * (forward ? 1 : 0.6);
	if (down) {
		const y1 = a.y - ra;
		const y2 = b.y - rb;
		return `M${a.x},${y1} Q${(a.x + b.x) / 2},${Math.min(y1, y2) - bow} ${b.x},${y2}`;
	}
	const x1 = a.x - ra;
	const x2 = b.x - rb;
	return `M${x1},${a.y} Q${Math.min(x1, x2) - bow},${(a.y + b.y) / 2} ${x2},${b.y}`;
}

function truncate(text: string, max: number, measure: (s: string) => number): string {
	if (measure(text) <= max) return text;
	const chars = Array.from(text);
	let lo = 0;
	let hi = chars.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (measure(chars.slice(0, mid).join("") + "…") <= max) lo = mid;
		else hi = mid - 1;
	}
	return chars.slice(0, lo).join("") + "…";
}
