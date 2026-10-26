import { ItemView, Keymap, Menu, SliderComponent, TAbstractFile, TFile, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import { MetadataLinkSource } from "./adapter";
import { t } from "./i18n";
import {
	buildLayers,
	edgeKey,
	focusOn,
	groupLayers,
	orderLayers,
	pathToRoot,
	place,
	reachFrom,
	type Direction,
	type EdgeKind,
	type GraphEdge,
	type GraphNode,
	type Highlight,
	type LayeredGraph,
	type Point,
	type Reach,
} from "./layered";
import type LinkDirectoryPlugin from "./main";
import { FOCUS_HOPS, LABEL_CHARS_MAX, LABEL_CHARS_MIN, hopsLabel } from "./settings";

export const VIEW_TYPE_TREE_GRAPH = "link-directory-graph";

const DOT_R = 5;
const ROOT_R = 7;
const HIT_R = 11;
/** Room per dot along a row growing down (names hidden or under the dot). */
const DOT_STEP = 26;
/** Room per dot along a column growing right (name beside the dot). */
const ROW_STEP = 22;
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
/** Hops from the open note with a shade of their own; further ones share the last. */
const HOP_LEVELS = 4;
const HOP_CLASSES = Array.from({ length: HOP_LEVELS }, (_, i) => `hop-${i + 1}`);
const hopClass = (hop: number) => `hop-${Math.min(hop, HOP_LEVELS)}`;
/** A reached note's dot carries its hops from the open note: room for one digit, or two. */
const NUM_R = 7;
const NUM_R_WIDE = 8;
const numRadius = (hop: number) => (hop < 10 ? NUM_R : NUM_R_WIDE);
/** The light along the coloured lines: strip length (short, so it keeps to bends), speed, rest between runs, fade at the ends. */
const FLOW_LEN = 12;
const FLOW_SPEED = 140;
const FLOW_REST = 700;
const FLOW_FADE = 8;
/** The light is at least this thick, so it shows on the thin lines too (still under the route's 3.5). */
const FLOW_MIN_THICK = 2.5;
/** Lines that get the light at most: each strip is a layer of its own. */
const FLOW_CAP = 150;
/** Background colours the groups take in turn, row after row (`.is-group-0` to `-7` in styles.css). */
const GROUP_COLOURS = 8;

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
	/** The note each drawn note goes with (groupLayers), or null when rows are not grouped. */
	private owners: Map<string, string> | null = null;
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
	private labelCharsEl!: SliderComponent;
	private groupsBtnEl!: HTMLElement;
	private focusBtnEl!: HTMLElement;
	private hopsEl!: HTMLSelectElement;
	private canvasEl!: HTMLElement;
	private svgEl!: SVGSVGElement;
	private viewportEl!: SVGGElement;
	private bandsEl!: SVGGElement;
	private edgesEl!: SVGGElement;
	private flowEl!: HTMLElement;
	private nodesSvgEl!: SVGSVGElement;
	private nodesViewportEl!: SVGGElement;
	private nodesEl!: SVGGElement;
	private emptyEl!: HTMLElement;
	/** The running light strips (cancelled and rebuilt with the highlight). */
	private flows: Animation[] = [];
	private legendEl!: HTMLElement;
	private noticeEl!: HTMLElement;
	private orphansEl!: HTMLDetailsElement;

	private readonly rerender = debounce(() => this.render(), 300, true);
	/** Lays out again while the name length slider moves, a few times a second at most. */
	private readonly relayout = debounce(() => this.render(), 60, false);

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
		// Name length: lays out again as the slider moves (the view keeps its place), saved when let go.
		this.labelCharsEl = new SliderComponent(buttons)
			.setLimits(LABEL_CHARS_MIN, LABEL_CHARS_MAX, 1)
			.setInstant(true)
			.setDynamicTooltip()
			.onChange((v) => {
				if (v === this.plugin.settings.graphLabelChars) return;
				this.plugin.settings.graphLabelChars = v;
				this.relayout();
			});
		this.labelCharsEl.sliderEl.addClass("ldg-label-chars");
		this.labelCharsEl.sliderEl.addEventListener("change", () => void this.plugin.saveSettings());
		this.groupsBtnEl = this.actionButton(buttons, "group", "", () => {
			const s = this.plugin.settings;
			s.graphGroups = !s.graphGroups;
			void this.plugin.saveSettings();
		});
		this.focusBtnEl = this.actionButton(buttons, "focus", "", () => {
			const s = this.plugin.settings;
			s.graphFocus = !s.graphFocus;
			void this.plugin.saveSettings();
		});
		// Hops from the open note, beside the focus button while it is on.
		this.hopsEl = buttons.createEl("select", { cls: ["dropdown", "ldg-hops"] });
		for (const n of FOCUS_HOPS) this.hopsEl.createEl("option", { value: String(n), text: hopsLabel(n) });
		this.hopsEl.setAttr("aria-label", t("setGraphFocusHops"));
		this.hopsEl.addEventListener("change", () => {
			this.plugin.settings.graphFocusHops = Number(this.hopsEl.value);
			void this.plugin.saveSettings();
		});
		this.actionButton(buttons, "scan", t("graphFit"), () => this.fit());
		this.actionButton(buttons, "refresh-cw", t("refresh"), () => this.render());
		this.rootLabelEl = header.createDiv({ cls: "ld-root-label" });

		this.canvasEl = root.createDiv({ cls: "ldg-canvas" });
		this.svgEl = this.canvasEl.createSvg("svg");
		const defs = this.svgEl.createSvg("defs");
		const arrow = (id: string, cls: string[], attr: Record<string, string>) =>
			defs
				.createSvg("marker", { attr: { id, viewBox: "0 0 8 8", refX: "7", refY: "4", orient: "auto", ...attr } })
				.createSvg("path", { cls, attr: { d: "M0,0 L8,4 L0,8 z" } });
		arrow("ldg-arrow", ["ldg-arrow"], { markerWidth: "7", markerHeight: "7" });
		// One per hop shade, for reached links within a row / back up. Sized in
		// graph units, so the arrowhead stays the same however thick the line is.
		for (const hop of HOP_CLASSES) {
			arrow(`ldg-arrow-${hop}`, ["ldg-arrow", "is-link", hop], { markerUnits: "userSpaceOnUse", markerWidth: "8", markerHeight: "8" });
		}
		this.viewportEl = this.svgEl.createSvg("g");
		this.bandsEl = this.viewportEl.createSvg("g");
		this.edgesEl = this.viewportEl.createSvg("g");
		// The flowing light sits between the lines and the dots, so it passes
		// under the names as the lines do: lines (SVG), light (HTML), dots and names (SVG).
		this.flowEl = this.canvasEl.createDiv({ cls: "ldg-flow" });
		this.nodesSvgEl = this.canvasEl.createSvg("svg");
		this.nodesViewportEl = this.nodesSvgEl.createSvg("g");
		this.nodesEl = this.nodesViewportEl.createSvg("g");
		this.emptyEl = this.canvasEl.createDiv({ cls: "ld-empty", text: t("graphRootNone") });
		this.bindCanvas();

		this.legendEl = root.createDiv({ cls: "ldg-legend" });
		this.noticeEl = root.createDiv({ cls: "ldg-notice" });
		this.orphansEl = root.createEl("details", { cls: "ldg-orphans" });
		this.orphansEl.open = true;

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf && this.isNoteTab(leaf)) this.lastNoteLeaf = leaf;
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
			this.owners = null;
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
		// Group each row by the note linking to it, or order it to cross fewer lines.
		const arrange = (lg: LayeredGraph): Map<string, string> | null => {
			if (s.graphGroups) return groupLayers(lg);
			orderLayers(lg);
			return null;
		};
		this.owners = arrange(full);
		this.full = full;
		// Focus: only the route to the open note, the notes linked from it and
		// what the open note reaches within the chosen hops (the root and its
		// links when there is no route), laid out afresh.
		let g = full;
		let route: string | null = null;
		if (s.graphFocus) {
			const hl = this.activePath ? pathToRoot(full, this.activePath) : null;
			route = hl ? this.activePath : null;
			g = focusOn(full, hl?.nodes ?? new Set([full.root]), route ?? undefined, s.graphFocusHops);
			this.owners = arrange(g);
		}
		this.focusedOn = s.graphFocus ? this.activePath : undefined;
		this.graph = g;

		const right = s.graphDirection === "right";
		const allNames = s.graphLabels === "all";
		// A new root, a different layout or (focused) another route starts from a fresh fit.
		const layoutKey = [
			g.root,
			s.graphDirection,
			s.graphLabels,
			s.graphMaxLength,
			s.graphGroups,
			s.graphFocus ? `focus:${route ?? ""}:${s.graphFocusHops}` : "",
		].join("|");
		if (layoutKey !== this.layoutKey) this.fitted = false;
		this.layoutKey = layoutKey;
		this.nodesSvgEl.toggleClass("is-names-route", !allNames);

		const { measure, lineHeight } = this.measurer();
		this.lineHeight = lineHeight;
		const labels = new Map<string, string>();
		const labelW = this.labelW;
		labelW.clear();
		for (const n of g.nodes.values()) {
			const label = truncate(n.display, s.graphLabelChars);
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
		if (this.owners) this.drawGroups(g, this.owners, right, depth);
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
			let u0 = Infinity;
			let u1 = -Infinity;
			let v0 = Infinity;
			let v1 = -Infinity;
			for (const id of layer) {
				const p = this.points.get(id);
				if (!p) continue;
				const [u, v] = uv(p, right);
				u0 = Math.min(u0, u - p.w / 2);
				u1 = Math.max(u1, u + p.w / 2);
				v0 = Math.min(v0, v - pad);
				v1 = Math.max(v1, v + depth(id) + 4);
			}
			if (u0 !== Infinity) this.backdrop("ldg-band", right, u0, u1, v0, v1, 8);
		});
	}

	/**
	 * A background colour per group, the notes linked from the same note one
	 * layer up (groupLayers): a box per run of them in each sub-row, so a group
	 * a wrap splits keeps its colour. The colours run on from row to row, so
	 * neighbouring groups differ and the rows below do not repeat the same start.
	 */
	private drawGroups(g: LayeredGraph, owners: Map<string, string>, right: boolean, depth: (id: string) => number): void {
		const pad = 9;
		const inset = 1.5;
		const colour = new Map<string, number>();
		g.layers.forEach((layer, d) => {
			if (d === 0) return;
			// Per sub-row: how far its names reach, and its runs of one group along the row.
			const subs = new Map<number, { reach: number; runs: { owner: string; points: Point[] }[] }>();
			for (const id of layer) {
				const p = this.points.get(id);
				if (!p) continue;
				const sub = subs.get(p.sub) ?? { reach: 0, runs: [] };
				subs.set(p.sub, sub);
				sub.reach = Math.max(sub.reach, depth(id));
				// Notes without a group come last in their layer, so they never split a run.
				const owner = owners.get(id);
				if (owner === undefined) continue;
				if (!colour.has(owner)) colour.set(owner, colour.size);
				const run = sub.runs[sub.runs.length - 1];
				if (run?.owner === owner) run.points.push(p);
				else sub.runs.push({ owner, points: [p] });
			}
			for (const { reach, runs } of subs.values()) {
				for (const { owner, points } of runs) {
					const a = points[0] as Point;
					const b = points[points.length - 1] as Point;
					const [ua, v] = uv(a, right);
					const [ub] = uv(b, right);
					const cls = ["ldg-group", `is-group-${(colour.get(owner) ?? 0) % GROUP_COLOURS}`];
					const box = this.backdrop(cls, right, ua - a.w / 2 + inset, ub + b.w / 2 - inset, v - pad, v + reach + 3, 6);
					box.setAttr("data-owner", owner);
				}
			}
		});
	}

	/** A rounded box behind the lines, from where it spans along the rows (u) and the way the graph grows (v). */
	private backdrop(cls: string | string[], right: boolean, u0: number, u1: number, v0: number, v1: number, rx: number): SVGRectElement {
		const [x, y, width, height] = right ? [v0, u0, v1 - v0, u1 - u0] : [u0, v0, u1 - u0, v1 - v0];
		return this.bandsEl.createSvg("rect", { cls, attr: { x, y, width, height, rx, ry: rx } });
	}

	private drawEdge(e: GraphEdge): void {
		const g = this.graph;
		const d = this.edgeD(e, (id) => radius(g, id));
		if (d === null) return;
		const el = this.edgesEl.createSvg("path", { cls: ["ldg-edge", `is-${e.kind}`], attr: { d } });
		if (e.kind !== "down") el.setAttr("marker-end", "url(#ldg-arrow)");
		this.edgeEls.set(edgeKey(e.from, e.to), el);
	}

	private edgeD(e: GraphEdge, r: (id: string) => number): string | null {
		const a = this.points.get(e.from);
		const b = this.points.get(e.to);
		if (!a || !b) return null;
		const g = this.graph;
		const layer = (id: string) => g?.nodes.get(id)?.depth ?? 0;
		const port = (id: string) => this.ports[layer(id)] ?? 0;
		return edgePath(
			e.kind,
			a,
			b,
			r(e.from),
			r(e.to),
			this.plugin.settings.graphDirection,
			port(e.from),
			port(e.to),
			this.starts[layer(e.to)] ?? 0,
		);
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
		// setValue also moves the number beside it; onChange ignores the unchanged value.
		this.labelCharsEl.setValue(s.graphLabelChars);
		this.labelCharsEl.sliderEl.setAttr("aria-label", t("graphLabelChars").replace("{n}", String(s.graphLabelChars)));
		this.groupsBtnEl.toggleClass("is-active", s.graphGroups);
		this.groupsBtnEl.setAttr("aria-label", s.graphGroups ? t("graphGroupsOn") : t("graphGroupsOff"));
		this.focusBtnEl.toggleClass("is-active", s.graphFocus);
		this.focusBtnEl.setAttr("aria-label", s.graphFocus ? t("graphFocusOn") : t("graphFocusOff"));
		this.hopsEl.toggle(s.graphFocus);
		this.hopsEl.value = String(s.graphFocusHops);
	}

	/**
	 * Colour the routes to the active note without re-laying out: the main
	 * route in the full accent, the other shortest ones in a pale accent, the
	 * rest of the lines dimmed. Everything the active note reaches by links
	 * takes the link colour, paler with each hop, and its number of hops in
	 * its dot. The active note's name gets a marker like the current file in
	 * the File Explorer.
	 */
	private applyHighlight(center: boolean): void {
		const g = this.graph;
		for (const el of this.edgeEls.values()) {
			el.removeClass("is-route", "is-link", ...HOP_CLASSES);
			if (el.hasAttribute("marker-end")) el.setAttr("marker-end", "url(#ldg-arrow)");
		}
		for (const el of this.nodeEls.values()) el.removeClass("is-route", "is-active", "is-link", ...HOP_CLASSES);
		for (const el of Array.from(this.nodesEl.querySelectorAll(".ldg-marker"))) el.remove();
		for (const el of Array.from(this.nodesEl.querySelectorAll(".ldg-hop-num"))) {
			const node = el.parentElement;
			node?.find(".ldg-dot")?.setAttr("r", radius(g, node.getAttribute("data-id") ?? ""));
			el.remove();
		}

		const id = this.activePath;
		const hl: Highlight | null = g && id ? pathToRoot(g, id) : null;
		// Stop at the route: it has its own colour, and going on from the root would take everything.
		const reach: Reach | null = g && id && hl ? reachFrom(g, id, hl.nodes) : null;
		this.svgEl.toggleClass("has-highlight", (hl !== null && hl.edges.size > 0) || (reach !== null && reach.edges.size > 0));
		// Re-append so coloured edges sit above the rest: the reached links far
		// to near, then the routes, the main route on top.
		if (reach) {
			for (const [key, hop] of [...reach.edges].sort((a, b) => b[1] - a[1])) {
				const el = this.edgeEls.get(key);
				if (!el) continue;
				el.addClass("is-link", hopClass(hop));
				if (el.hasAttribute("marker-end")) el.setAttr("marker-end", `url(#ldg-arrow-${hopClass(hop)})`);
				this.edgesEl.appendChild(el);
			}
			for (const [n, hop] of reach.nodes) {
				const el = this.nodeEls.get(n);
				const dot = el?.find(".ldg-dot");
				if (!el || !dot) continue;
				el.addClass("is-link", hopClass(hop));
				dot.setAttr("r", numRadius(hop));
				const num = createSvg("text", { cls: hop < 10 ? "ldg-hop-num" : ["ldg-hop-num", "is-wide"] });
				num.textContent = String(hop);
				dot.after(num);
			}
		}
		// Lines within a row end at their target's dot: follow the numbered dots'
		// size, so their arrowheads stay clear of it.
		if (g) {
			const r = (n: string) => {
				const hop = reach?.nodes.get(n);
				return hop === undefined ? radius(g, n) : numRadius(hop);
			};
			for (const e of g.edges) {
				if (e.kind !== "same") continue;
				const d = this.edgeD(e, r);
				if (d !== null) this.edgeEls.get(edgeKey(e.from, e.to))?.setAttr("d", d);
			}
		}
		if (hl && id) {
			for (const key of hl.edges) {
				const el = this.edgeEls.get(key);
				if (!el) continue;
				el.addClass("is-route");
				this.edgesEl.appendChild(el);
			}
			for (const n of hl.nodes) this.nodeEls.get(n)?.addClass("is-route");
			const el = this.nodeEls.get(id);
			if (el) {
				el.addClass("is-active");
				el.prepend(this.marker(id));
			}
			if (center) this.ensureVisible(id);
		}
		this.drawFlow(hl, reach);

		const unreachable = g !== null && id !== null && hl === null;
		this.noticeEl.toggle(unreachable);
		if (unreachable) this.noticeEl.setText(t("graphUnreachable"));
		this.renderLegend(hl, reach);
		this.markActiveOrphan(unreachable && center);
	}

	/**
	 * A short light runs along each coloured line from base to tip, to show
	 * which way it points. Each strip is moved by transform keyframes sampled
	 * along its line, which the compositor runs on its own: drawing the light
	 * into the SVG instead repaints the whole graph every frame (about five
	 * times the CPU, measured). Route first, then by hops, up to FLOW_CAP lines.
	 */
	private drawFlow(hl: Highlight | null, reach: Reach | null): void {
		for (const a of this.flows) a.cancel();
		this.flows = [];
		this.flowEl.empty();
		const g = this.graph;
		// Not held back by the system's reduced motion: the setting alone decides.
		if (!g || !this.plugin.settings.graphFlow) return;
		const right = this.plugin.settings.graphDirection === "right";
		const near = [...(reach?.edges ?? [])].sort((a, b) => a[1] - b[1]).map(([key]) => key);
		const keys = new Set([...(hl?.edges ?? []), ...near]);
		for (const key of [...keys].slice(0, FLOW_CAP)) {
			const el = this.edgeEls.get(key);
			const from = key.split("\u0000")[0] ?? "";
			const a = this.points.get(from);
			if (!el || !a) continue;
			// A line down the rows leaves under its note's name: start the light past the names.
			const port = this.ports[g.nodes.get(from)?.depth ?? 0] ?? 0;
			const start = el.hasClass("is-down") ? Math.max(0, port - (right ? a.x : a.y) - radius(g, from)) : 0;
			const thick = Math.max(FLOW_MIN_THICK, Number.parseFloat(getComputedStyle(el).strokeWidth) || 2);
			const run = flowFrames(el, start, thick);
			if (!run) continue;
			// White hardly shows on the paler links or across the gaps of a dashed one:
			// there the light takes the link colour at full strength (styles.css).
			const tinted = el.hasClass("is-link") && (!el.hasClass("hop-1") || !el.hasClass("is-down"));
			const strip = this.flowEl.createDiv({ cls: tinted ? ["ldg-flow-strip", "is-tinted"] : "ldg-flow-strip" });
			strip.setCssStyles({ width: `${FLOW_LEN}px`, height: `${thick}px` });
			this.flows.push(strip.animate(run.frames, { duration: run.duration, iterations: Infinity }));
		}
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

	private renderLegend(hl: Highlight | null, reach: Reach | null): void {
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
		if (this.owners && this.owners.size > 0) item("is-group", t("graphLegendGroup"));
		if (g.edges.some((e) => e.kind !== "down")) item("is-faint", t("graphLegendFaint"));
		if (hl && hl.edges.size > 0) item("is-route", t("graphLegendRoute"));
		if (reach && reach.edges.size > 0) {
			// One swatch per hop shown, the last shade standing for that many and more.
			const it = el.createSpan({ cls: "ldg-legend-item" });
			it.createSpan({ text: t("graphLegendOpenLinks") });
			const top = Math.min(HOP_LEVELS, Math.max(...reach.edges.values()));
			for (let h = 1; h <= top; h++) {
				it.createSpan({ cls: ["ldg-swatch", "is-link", hopClass(h)] });
				it.createSpan({ text: h === HOP_LEVELS ? `${h}+` : String(h) });
			}
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
		const transform = `translate(${this.tx} ${this.ty}) scale(${this.k})`;
		this.viewportEl.setAttr("transform", transform);
		this.nodesViewportEl.setAttr("transform", transform);
		this.flowEl.setCssStyles({ transform: `translate(${this.tx}px, ${this.ty}px) scale(${this.k})` });
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
		// On the canvas: the dots and names lie in their own SVG on top of the lines.
		const svg = this.canvasEl;
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

	/**
	 * The tab to open into: the one used last in the main area, whatever it
	 * shows (a note, a drawing, a base, a new tab), as the File Explorer does.
	 * A pinned tab is kept: the note opens in a new tab beside it. Never this
	 * view's own leaf.
	 */
	private targetLeaf(ev: MouseEvent): WorkspaceLeaf {
		const ws = this.app.workspace;
		const mod = Keymap.isModEvent(ev);
		if (mod) return ws.getLeaf(mod);
		const tabs: WorkspaceLeaf[] = [];
		ws.iterateAllLeaves((l) => {
			if (this.isNoteTab(l)) tabs.push(l);
		});
		const recent = ws.getMostRecentLeaf();
		const last = [this.lastNoteLeaf, recent].find((l) => l && tabs.includes(l)) ?? tabs[0];
		if (!last) return ws.getLeaf("split", "vertical");
		if (!last.getViewState().pinned) return last;
		ws.setActiveLeaf(last, { focus: false });
		return ws.getLeaf("tab");
	}

	/** A tab a note can open in: in the main area or a pop-out window (not a sidebar), and not this view. */
	private isNoteTab(leaf: WorkspaceLeaf): boolean {
		const ws = this.app.workspace;
		const root = leaf.getRoot();
		return leaf !== this.leaf && root !== ws.leftSplit && root !== ws.rightSplit && (leaf.isDeferred || leaf.view.navigation);
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
		const reach = this.activePath && hl ? reachFrom(g, this.activePath, hl.nodes) : null;
		const count = (sel: string) => this.edgesEl.querySelectorAll(sel).length;
		const byHop = (sel: string) => HOP_CLASSES.map((h) => count(`${sel}.${h}`));
		// note → the notes that go with it, in order
		const groups: Record<string, string[]> = {};
		for (const id of g.layers.flat()) {
			const o = this.owners?.get(id);
			if (o !== undefined) (groups[name(o)] ??= []).push(name(id));
		}
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
			focusHops: this.plugin.settings.graphFocusHops,
			labelChars: this.plugin.settings.graphLabelChars,
			// where each layer starts along the growth direction
			starts: this.starts.map(Math.round),
			groups: this.owners ? groups : null,
			hidden: (this.full?.nodes.size ?? 0) - g.nodes.size,
			route: hl ? route(hl.edges) : null,
			reach: reach ? Object.fromEntries([...reach.nodes].map(([id, hop]) => [name(id), hop])) : null,
			dom: {
				route: count(".ldg-edge.is-route"),
				// per hop shade: [1, 2, 3, 4+]
				linkEdges: byHop(".ldg-edge.is-link"),
				linkNodes: HOP_CLASSES.map((h) => this.nodesEl.querySelectorAll(`.ldg-node.is-link.${h}`).length),
				// note name → number in its dot
				numbers: Object.fromEntries(
					Array.from(this.nodesEl.querySelectorAll(".ldg-hop-num")).map((el) => [
						name(el.parentElement?.getAttribute("data-id") ?? ""),
						el.textContent,
					]),
				),
				faint: count(".ldg-edge.is-same, .ldg-edge.is-up"),
				activeNode: this.nodesEl.querySelectorAll(".ldg-node.is-active").length,
				marker: this.nodesEl.querySelectorAll(".ldg-marker").length,
				dimmed: this.svgEl.hasClass("has-highlight"),
				flow: this.flows.length,
				groupBoxes: this.bandsEl.querySelectorAll(".ldg-group").length,
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

/** Where a point sits along its row (u) and the way the graph grows (v). */
function uv(p: Point, right: boolean): [number, number] {
	return right ? [p.y, p.x] : [p.x, p.y];
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

/**
 * Keyframes moving a light strip along `path` from `start` to its end at
 * FLOW_SPEED: its head on the line and turned along it, fading in and out at
 * the ends, then resting for FLOW_REST. Null when the run is shorter than the strip.
 */
function flowFrames(path: SVGPathElement, start: number, width: number): { frames: Keyframe[]; duration: number } | null {
	const len = path.getTotalLength();
	const run = len - start;
	if (run < FLOW_LEN) return null;
	const travel = (run / FLOW_SPEED) * 1000;
	const duration = travel + FLOW_REST;
	const steps = Math.min(48, Math.max(3, Math.ceil(run / 8)));
	const frames: Keyframe[] = [];
	let prev: number | null = null;
	let transform = "";
	for (let i = 0; i <= steps; i++) {
		const s = start + (run * i) / steps;
		const p = path.getPointAtLength(s);
		const p0 = path.getPointAtLength(Math.max(0, s - 1));
		const p1 = path.getPointAtLength(Math.min(len, s + 1));
		let deg = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
		// Unwrap, so the strip never spins the long way round between two samples.
		if (prev !== null) deg += 360 * Math.round((prev - deg) / 360);
		prev = deg;
		transform = `translate(${p.x - FLOW_LEN}px, ${p.y - width / 2}px) rotate(${deg.toFixed(1)}deg)`;
		const opacity = Math.max(0, Math.min(1, (s - start) / FLOW_FADE, (len - s) / FLOW_FADE));
		frames.push({ offset: ((i / steps) * travel) / duration, transform, opacity });
	}
	frames.push({ offset: 1, transform, opacity: 0 });
	return { frames, duration };
}

/** The first `max` characters of `text`, and "…" when there is more. */
function truncate(text: string, max: number): string {
	const chars = Array.from(text);
	return chars.length <= max ? text : chars.slice(0, max).join("") + "…";
}
