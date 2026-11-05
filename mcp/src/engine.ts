/**
 * Headless Marsam document engine.
 *
 * It mirrors the browser studio's model — a background, an ordered stack of
 * layers, brush stamps, undo history and the `.marsam` project format — but
 * renders with `@napi-rs/canvas` inside Node so MCP clients can paint without
 * a browser.
 *
 * Layers are treated as immutable once committed: structural operations build
 * new canvases (copy-on-write), and pixel edits record compressed before/after
 * snapshots. That keeps undo cheap and predictable.
 */
import {
  createCanvas,
  loadImage,
  ImageData as CanvasImageData,
  GlobalFonts,
  type Canvas,
  type Image,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

import {
  DEFAULT_BRUSH,
  stampCache,
  brushPreset,
  type BrushSettings,
  type Symmetry,
} from "./brush.js";
import { clamp, normalizeHex } from "./color.js";
import {
  BLEND_MODES,
  MAX_DOC_PIXELS,
  MAX_DOC_SIZE,
  MAX_PROJECT_BYTES,
  MAX_PROJECT_LAYERS,
  MAX_PROJECT_PAGES,
  MIN_DOC_SIZE,
  PROJECT_APP_ID,
  PROJECT_VERSION,
  isBlendMode,
  parseProjectFile,
  type BlendMode,
  type DocSettings,
} from "./project.js";

export { BLEND_MODES, MAX_DOC_PIXELS, MAX_DOC_SIZE, MIN_DOC_SIZE };
export type { BlendMode, DocSettings };

export type Point = { x: number; y: number };
export type StrokePoint = Point & { pressure?: number };

export type Layer = {
  id: string;
  name: string;
  canvas: Canvas;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
};

export type LayerPatch = Partial<
  Pick<Layer, "name" | "visible" | "opacity" | "blend">
>;

export type ShapeKind = "line" | "rect" | "ellipse";

export type ExportFormat = "png" | "jpeg" | "webp";

export const MAX_HISTORY = 25;
export const MAX_EXPORT_SIDE = 16000;
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

const MIME: Record<ExportFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

type StateSnapshot = {
  doc: DocSettings;
  layers: Layer[];
  activeLayerId: string;
  projectName: string;
};

type HistoryEntry =
  | { kind: "state"; before: StateSnapshot; after: StateSnapshot }
  | {
      kind: "pixels";
      layerId: string;
      before: Buffer;
      after: Buffer;
    };

type Page = {
  id: string;
  name: string;
  doc: DocSettings;
  layers: Layer[];
  activeLayerId: string;
  history: HistoryEntry[];
  redoStack: HistoryEntry[];
};

export type PageSummary = {
  index: number;
  id: string;
  name: string;
  width: number;
  height: number;
  layers: number;
  active: boolean;
};

export type StudioInfo = {
  project: string;
  pageIndex: number;
  pages: PageSummary[];
  canvas: DocSettings;
  layers: Array<{
    index: number;
    id: string;
    name: string;
    visible: boolean;
    opacity: number;
    blend: BlendMode;
    active: boolean;
  }>;
  activeLayerId: string;
  order: "bottom to top";
  canUndo: boolean;
  canRedo: boolean;
  history: number;
  saved: boolean;
  brush: BrushSettings;
  color: string;
};

export type DrawResult = {
  layerId: string;
  layerName: string;
  history: number;
};

export type ExportResult = {
  path: string;
  format: ExportFormat;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  pageIndex: number;
  pageName: string;
};

export type SaveResult = {
  path: string;
  bytes: number;
  layers: number;
  pages: number;
};

export type OpenResult = {
  path: string;
  project: string;
  width: number;
  height: number;
  layers: number;
  pageIndex: number;
  pages: PageSummary[];
};

function ctxOf(canvas: Canvas): SKRSContext2D {
  return canvas.getContext("2d");
}

function nextLayerName(serial: number) {
  return `Layer ${serial}`;
}

/**
 * The platform UI font. Some families only ship a regular face, and Skia fakes
 * heavier weights by drawing the glyphs twice with a slight offset, which looks
 * smeared. These defaults have a real bold face on each platform.
 */
function defaultFontFamily() {
  if (process.platform === "win32") return "Segoe UI";
  if (process.platform === "darwin") return "Helvetica Neue";
  return "DejaVu Sans";
}

function safeName(value: string) {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) || "marsam"
  );
}

function defaultOutputDir() {
  return process.env.MARSAM_MCP_OUTPUT_DIR
    ? resolve(process.env.MARSAM_MCP_OUTPUT_DIR)
    : process.cwd();
}

export function resolveUserPath(input: string) {
  const cleaned = input.trim();
  if (!cleaned) throw new Error("A file path is required");
  const withoutScheme = cleaned.startsWith("file://")
    ? fileURLToPath(cleaned)
    : cleaned;
  return isAbsolute(withoutScheme)
    ? withoutScheme
    : resolve(defaultOutputDir(), withoutScheme);
}

async function ensureParent(filePath: string) {
  await mkdir(dirname(filePath), { recursive: true });
}

/** Compresses the whole layer so undo snapshots stay small. */
function capturePixels(canvas: Canvas) {
  const { data } = ctxOf(canvas).getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const raw = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return deflateSync(raw, { level: 1 });
}

function restorePixels(canvas: Canvas, compressed: Buffer) {
  const raw = inflateSync(compressed);
  const data = new Uint8ClampedArray(
    raw.buffer,
    raw.byteOffset,
    raw.byteLength,
  );
  const image = new CanvasImageData(data, canvas.width, canvas.height);
  ctxOf(canvas).putImageData(image, 0, 0);
}

function decodeDataUrl(source: string) {
  const comma = source.indexOf(",");
  if (comma < 0) throw new Error("That image data could not be read");
  const header = source.slice(0, comma);
  const payload = source.slice(comma + 1);
  return header.includes(";base64")
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload));
}

export class Studio {
  pages: Page[] = [];
  activePageIndex = 0;
  projectName: string;
  brush: BrushSettings;
  color: string;
  saved = true;

  private layerSerial = 1;
  private pageSerial = 0;
  private strokeCanvas: Canvas | null = null;
  private strokeCtx: SKRSContext2D | null = null;

  constructor() {
    this.projectName = "Untitled";
    this.brush = { ...DEFAULT_BRUSH };
    this.color = "#e2b264";
    const doc: DocSettings = {
      width: 1920,
      height: 1080,
      background: "#0f0f0f",
      transparent: false,
    };
    this.layerSerial = 0;
    const layer = this.makeLayer("Layer 1", doc.width, doc.height);
    this.pages = [
      {
        id: this.nextPageId(),
        name: "Page 1",
        doc,
        layers: [layer],
        activeLayerId: layer.id,
        history: [],
        redoStack: [],
      },
    ];
  }

  /** `doc`, `layers`, `activeLayerId` and both history stacks follow the active page. */
  private get currentPage(): Page {
    return this.pages[Math.min(this.activePageIndex, this.pages.length - 1)] ?? this.pages[0];
  }

  get doc(): DocSettings {
    return this.currentPage.doc;
  }

  set doc(next: DocSettings) {
    this.currentPage.doc = next;
  }

  get layers(): Layer[] {
    return this.currentPage.layers;
  }

  set layers(next: Layer[]) {
    this.currentPage.layers = next;
  }

  get activeLayerId(): string {
    return this.currentPage.activeLayerId;
  }

  set activeLayerId(next: string) {
    this.currentPage.activeLayerId = next;
  }

  private get history(): HistoryEntry[] {
    return this.currentPage.history;
  }

  private set history(next: HistoryEntry[]) {
    this.currentPage.history = next;
  }

  private get redoStack(): HistoryEntry[] {
    return this.currentPage.redoStack;
  }

  private set redoStack(next: HistoryEntry[]) {
    this.currentPage.redoStack = next;
  }

  private nextPageId() {
    this.pageSerial += 1;
    return `page-${this.pageSerial}`;
  }

  // ------------------------------------------------------------- document

  private makeLayer(name: string, width = this.doc.width, height = this.doc.height) {
    this.layerSerial += 1;
    const canvas = createCanvas(width, height);
    return {
      id: `layer-${this.layerSerial}`,
      name,
      canvas,
      visible: true,
      opacity: 1,
      blend: "source-over" as BlendMode,
    };
  }

  newDocument(options: {
    width?: number;
    height?: number;
    background?: string;
    transparent?: boolean;
    name?: string;
  } = {}) {
    const width = Math.round(options.width ?? 1920);
    const height = Math.round(options.height ?? 1080);
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < MIN_DOC_SIZE ||
      height < MIN_DOC_SIZE ||
      width > MAX_DOC_SIZE ||
      height > MAX_DOC_SIZE
    ) {
      throw new Error(
        `Canvas size must be between ${MIN_DOC_SIZE} and ${MAX_DOC_SIZE} px per side`,
      );
    }
    if (width * height > MAX_DOC_PIXELS) {
      throw new Error("The requested size exceeds the safe memory limit");
    }
    const background =
      normalizeHex(options.background ?? "#0f0f0f") ?? "#0f0f0f";

    const doc: DocSettings = {
      width,
      height,
      background,
      transparent: options.transparent === true,
    };
    this.projectName = options.name?.trim().slice(0, 60) || "Untitled";
    this.layerSerial = 0;
    const layer = this.makeLayer("Layer 1", width, height);
    this.pages = [
      {
        id: this.nextPageId(),
        name: "Page 1",
        doc,
        layers: [layer],
        activeLayerId: layer.id,
        history: [],
        redoStack: [],
      },
    ];
    this.activePageIndex = 0;
    this.strokeCanvas = null;
    this.strokeCtx = null;
    this.saved = true;
    return this.info();
  }

  info(): StudioInfo {
    return {
      project: this.projectName,
      pageIndex: this.activePageIndex,
      pages: this.pageSummaries(),
      canvas: { ...this.doc },
      layers: this.layers.map((layer, index) => ({
        index,
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        blend: layer.blend,
        active: layer.id === this.activeLayerId,
      })),
      activeLayerId: this.activeLayerId,
      order: "bottom to top",
      canUndo: this.history.length > 0,
      canRedo: this.redoStack.length > 0,
      history: this.history.length,
      saved: this.saved,
      brush: { ...this.brush },
      color: this.color,
    };
  }

  // ---------------------------------------------------------------- pages

  pageSummaries(): PageSummary[] {
    return this.pages.map((page, index) => ({
      index,
      id: page.id,
      name: page.name,
      width: page.doc.width,
      height: page.doc.height,
      layers: page.layers.length,
      active: index === this.activePageIndex,
    }));
  }

  private makePage(
    name: string,
    doc: DocSettings,
    layers: Layer[],
    activeLayerId: string,
  ): Page {
    return {
      id: this.nextPageId(),
      name,
      doc,
      layers,
      activeLayerId,
      history: [],
      redoStack: [],
    };
  }

  private resetStrokeState() {
    this.strokeCanvas = null;
    this.strokeCtx = null;
  }

  addPage(options: {
    name?: string;
    width?: number;
    height?: number;
    background?: string;
  } = {}) {
    if (this.pages.length >= MAX_PROJECT_PAGES) {
      throw new Error(`A project can hold at most ${MAX_PROJECT_PAGES} pages`);
    }
    const width = Math.round(
      clamp(options.width ?? this.doc.width, MIN_DOC_SIZE, MAX_DOC_SIZE),
    );
    const height = Math.round(
      clamp(options.height ?? this.doc.height, MIN_DOC_SIZE, MAX_DOC_SIZE),
    );
    if (width * height > MAX_DOC_PIXELS) {
      throw new Error("The requested page size exceeds the safe memory limit");
    }
    const background =
      normalizeHex(options.background ?? "") ?? this.doc.background;
    this.layerSerial = 0;
    const layer = this.makeLayer("Layer 1", width, height);
    const page = this.makePage(
      options.name?.trim().slice(0, 40) || `Page ${this.pages.length + 1}`,
      { width, height, background, transparent: false },
      [layer],
      layer.id,
    );
    this.pages.push(page);
    this.activePageIndex = this.pages.length - 1;
    this.resetStrokeState();
    this.saved = false;
    return {
      page: this.pageSummaries()[this.activePageIndex],
      pages: this.pageSummaries(),
    };
  }

  selectPage(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.pages.length) {
      throw new Error(
        `Page index ${String(index)} is out of range (0-${this.pages.length - 1})`,
      );
    }
    if (index === this.activePageIndex) return this.info();
    this.resetStrokeState();
    this.activePageIndex = index;
    return this.info();
  }

  duplicatePage(index = this.activePageIndex) {
    if (this.pages.length >= MAX_PROJECT_PAGES) {
      throw new Error(`A project can hold at most ${MAX_PROJECT_PAGES} pages`);
    }
    const source = this.pages[index];
    if (!source) {
      throw new Error(`Page index ${index} is out of range (0-${this.pages.length - 1})`);
    }
    const active = source.layers.findIndex(
      (layer) => layer.id === source.activeLayerId,
    );
    const layers = source.layers.map((layer) => {
      const canvas = createCanvas(source.doc.width, source.doc.height);
      ctxOf(canvas).drawImage(layer.canvas, 0, 0);
      this.layerSerial += 1;
      return { ...layer, id: `layer-${this.layerSerial}`, canvas };
    });
    const page = this.makePage(
      `${source.name} copy`.slice(0, 40),
      { ...source.doc },
      layers,
      layers[Math.max(0, active)]?.id ?? layers[0].id,
    );
    this.pages.splice(index + 1, 0, page);
    this.activePageIndex = index + 1;
    this.resetStrokeState();
    this.saved = false;
    return {
      page: this.pageSummaries()[this.activePageIndex],
      pages: this.pageSummaries(),
    };
  }

  deletePage(index = this.activePageIndex) {
    if (this.pages.length <= 1) {
      throw new Error("The last page cannot be deleted");
    }
    if (!this.pages[index]) {
      throw new Error(`Page index ${index} is out of range (0-${this.pages.length - 1})`);
    }
    const [removed] = this.pages.splice(index, 1);
    const previous = this.activePageIndex;
    this.activePageIndex =
      index < previous
        ? previous - 1
        : index === previous
          ? Math.min(index, this.pages.length - 1)
          : previous;
    this.resetStrokeState();
    this.saved = false;
    return {
      deleted: removed.name,
      page: this.pageSummaries()[this.activePageIndex],
      pages: this.pageSummaries(),
    };
  }

  renamePage(index: number, name: string) {
    const page = this.pages[index];
    if (!page) {
      throw new Error(`Page index ${index} is out of range (0-${this.pages.length - 1})`);
    }
    const next = name.trim().replace(/\s+/g, " ").slice(0, 40) || page.name;
    if (next !== page.name) {
      page.name = next;
      this.saved = false;
    }
    return this.pageSummaries()[index];
  }

  resolveLayer(ref?: string | number | null): Layer {
    if (ref === undefined || ref === null || ref === "") {
      const active = this.layers.find((layer) => layer.id === this.activeLayerId);
      if (!active) throw new Error("The document has no active layer");
      return active;
    }
    if (typeof ref === "number") {
      const layer = this.layers[ref];
      if (!layer) {
        throw new Error(
          `Layer index ${ref} is out of range (0-${this.layers.length - 1})`,
        );
      }
      return layer;
    }
    const byId = this.layers.find((layer) => layer.id === ref);
    if (byId) return byId;
    const byName = this.layers.filter((layer) => layer.name === ref);
    if (byName.length === 1) return byName[0];
    throw new Error(`Layer not found: ${ref}`);
  }

  // ---------------------------------------------------------------- history

  private snapshot(): StateSnapshot {
    return {
      doc: { ...this.doc },
      layers: [...this.layers],
      activeLayerId: this.activeLayerId,
      projectName: this.projectName,
    };
  }

  private sameState(a: StateSnapshot, b: StateSnapshot) {
    if (
      a.doc.width !== b.doc.width ||
      a.doc.height !== b.doc.height ||
      a.doc.background !== b.doc.background ||
      a.doc.transparent !== b.doc.transparent ||
      a.projectName !== b.projectName ||
      a.activeLayerId !== b.activeLayerId ||
      a.layers.length !== b.layers.length
    ) {
      return false;
    }
    for (let i = 0; i < a.layers.length; i += 1) {
      const left = a.layers[i];
      const right = b.layers[i];
      if (
        left.id !== right.id ||
        left.canvas !== right.canvas ||
        left.visible !== right.visible ||
        left.opacity !== right.opacity ||
        left.blend !== right.blend ||
        left.name !== right.name
      ) {
        return false;
      }
    }
    return true;
  }

  private push(entry: HistoryEntry) {
    this.history.push(entry);
    while (this.history.length > MAX_HISTORY) this.history.shift();
    this.redoStack = [];
    this.saved = false;
  }

  private commitState(before: StateSnapshot) {
    const after = this.snapshot();
    if (this.sameState(before, after)) return false;
    this.push({ kind: "state", before, after });
    return true;
  }

  private editPixels(layer: Layer, run: (ctx: SKRSContext2D) => void) {
    const before = capturePixels(layer.canvas);
    run(ctxOf(layer.canvas));
    const after = capturePixels(layer.canvas);
    if (before.equals(after)) return false;
    this.push({ kind: "pixels", layerId: layer.id, before, after });
    return true;
  }

  undo() {
    const entry = this.history.pop();
    if (!entry) return false;
    if (entry.kind === "pixels") {
      const layer = this.layers.find((item) => item.id === entry.layerId);
      if (layer) restorePixels(layer.canvas, entry.before);
    } else {
      this.restoreState(entry.before);
    }
    this.redoStack.push(entry);
    this.saved = false;
    return true;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    if (entry.kind === "pixels") {
      const layer = this.layers.find((item) => item.id === entry.layerId);
      if (layer) restorePixels(layer.canvas, entry.after);
    } else {
      this.restoreState(entry.after);
    }
    this.history.push(entry);
    this.saved = false;
    return true;
  }

  private restoreState(state: StateSnapshot) {
    this.doc = { ...state.doc };
    this.layers = [...state.layers];
    this.activeLayerId = state.activeLayerId;
    this.projectName = state.projectName;
    this.strokeCanvas = null;
    this.strokeCtx = null;
  }

  // ------------------------------------------------------------- layers

  addLayer(options: { name?: string; above?: boolean } = {}) {
    if (this.layers.length >= MAX_PROJECT_LAYERS) {
      throw new Error(`A project can hold at most ${MAX_PROJECT_LAYERS} layers`);
    }
    const before = this.snapshot();
    const layer = this.makeLayer(
      options.name?.trim().slice(0, 60) ||
        nextLayerName(this.layers.length + 1),
    );
    const index = this.layers.findIndex(
      (item) => item.id === this.activeLayerId,
    );
    const at = index < 0 ? this.layers.length : index + 1;
    this.layers = [
      ...this.layers.slice(0, at),
      layer,
      ...this.layers.slice(at),
    ];
    this.activeLayerId = layer.id;
    this.commitState(before);
    return this.layerSummary(layer);
  }

  updateLayer(ref: string | number | undefined, patch: LayerPatch) {
    const layer = this.resolveLayer(ref);
    const before = this.snapshot();
    const next: LayerPatch = {};
    if (patch.name !== undefined) {
      next.name = patch.name.trim().slice(0, 60) || layer.name;
    }
    if (patch.visible !== undefined) next.visible = patch.visible;
    if (patch.opacity !== undefined) {
      next.opacity = clamp(Number(patch.opacity), 0, 1);
    }
    if (patch.blend !== undefined) {
      if (!isBlendMode(patch.blend)) {
        throw new Error(`Unknown blend mode: ${String(patch.blend)}`);
      }
      next.blend = patch.blend;
    }
    this.layers = this.layers.map((item) =>
      item.id === layer.id ? { ...item, ...next } : item,
    );
    this.commitState(before);
    return this.layerSummary(this.resolveLayer(layer.id));
  }

  deleteLayer(ref?: string | number) {
    if (this.layers.length <= 1) {
      throw new Error("The last layer cannot be deleted");
    }
    const layer = this.resolveLayer(ref);
    const before = this.snapshot();
    const index = this.layers.findIndex((item) => item.id === layer.id);
    const remaining = this.layers.filter((item) => item.id !== layer.id);
    this.layers = remaining;
    const next = remaining[Math.min(index, remaining.length - 1)];
    this.activeLayerId = next.id;
    this.commitState(before);
    return { deleted: layer.id, activeLayerId: next.id };
  }

  clearLayer(ref?: string | number) {
    const layer = this.resolveLayer(ref);
    const before = this.snapshot();
    this.layers = this.layers.map((item) =>
      item.id === layer.id
        ? { ...item, canvas: createCanvas(this.doc.width, this.doc.height) }
        : item,
    );
    this.commitState(before);
    return this.layerSummary(this.resolveLayer(layer.id));
  }

  fillLayer(ref: string | number | undefined, color?: string) {
    const layer = this.resolveLayer(ref);
    const fill = normalizeHex(color ?? this.color);
    if (!fill) throw new Error(`Invalid color: ${String(color)}`);
    const before = this.snapshot();
    const canvas = createCanvas(this.doc.width, this.doc.height);
    const ctx = ctxOf(canvas);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, this.doc.width, this.doc.height);
    this.layers = this.layers.map((item) =>
      item.id === layer.id ? { ...item, canvas } : item,
    );
    this.color = fill;
    this.commitState(before);
    return this.layerSummary(this.resolveLayer(layer.id));
  }

  mergeDown(ref?: string | number) {
    const layer = this.resolveLayer(ref);
    const index = this.layers.findIndex((item) => item.id === layer.id);
    if (index <= 0) {
      throw new Error("There is no layer below to merge into");
    }
    const below = this.layers[index - 1];
    const before = this.snapshot();
    const canvas = createCanvas(this.doc.width, this.doc.height);
    const ctx = ctxOf(canvas);
    ctx.globalAlpha = below.opacity;
    ctx.globalCompositeOperation = below.blend;
    ctx.drawImage(below.canvas, 0, 0);
    if (layer.visible) {
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      ctx.drawImage(layer.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    const merged: Layer = {
      ...below,
      canvas,
      visible: true,
      opacity: 1,
      blend: "source-over",
      name: below.name,
    };
    this.layers = this.layers
      .map((item, i) => (i === index - 1 ? merged : item))
      .filter((_, i) => i !== index);
    this.activeLayerId = merged.id;
    this.commitState(before);
    return this.layerSummary(merged);
  }

  moveLayer(ref: string | number | undefined, direction: "up" | "down") {
    const layer = this.resolveLayer(ref);
    const index = this.layers.findIndex((item) => item.id === layer.id);
    const target = index + (direction === "up" ? 1 : -1);
    if (target < 0 || target >= this.layers.length) {
      throw new Error(`The layer is already at the ${direction === "up" ? "top" : "bottom"}`);
    }
    const before = this.snapshot();
    const layers = [...this.layers];
    [layers[index], layers[target]] = [layers[target], layers[index]];
    this.layers = layers;
    this.commitState(before);
    return this.layerSummary(layer);
  }

  selectLayer(ref: string | number) {
    const layer = this.resolveLayer(ref);
    this.activeLayerId = layer.id;
    return this.layerSummary(layer);
  }

  layerSummary(layer: Layer) {
    const index = this.layers.findIndex((item) => item.id === layer.id);
    return {
      index,
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      blend: layer.blend,
      active: layer.id === this.activeLayerId,
    };
  }

  // ------------------------------------------------------------- document ops

  resizeCanvas(options: {
    width: number;
    height: number;
    anchor?: "center" | "start";
    keepContent?: boolean;
  }) {
    const width = Math.round(options.width);
    const height = Math.round(options.height);
    if (
      width < MIN_DOC_SIZE ||
      height < MIN_DOC_SIZE ||
      width > MAX_DOC_SIZE ||
      height > MAX_DOC_SIZE
    ) {
      throw new Error(
        `Canvas size must be between ${MIN_DOC_SIZE} and ${MAX_DOC_SIZE} px per side`,
      );
    }
    if (width * height > MAX_DOC_PIXELS) {
      throw new Error("The requested size exceeds the safe memory limit");
    }
    if (width === this.doc.width && height === this.doc.height) {
      return this.info();
    }
    const before = this.snapshot();
    const anchor = options.anchor ?? "center";
    const dx =
      anchor === "center" ? Math.round((width - this.doc.width) / 2) : 0;
    const dy =
      anchor === "center" ? Math.round((height - this.doc.height) / 2) : 0;

    this.layers = this.layers.map((layer) => {
      const canvas = createCanvas(width, height);
      if (options.keepContent !== false) {
        ctxOf(canvas).drawImage(layer.canvas, dx, dy);
      }
      return { ...layer, canvas };
    });
    this.doc = { ...this.doc, width, height };
    this.strokeCanvas = null;
    this.strokeCtx = null;
    this.commitState(before);
    return this.info();
  }

  setBackground(options: { color?: string; transparent?: boolean }) {
    const before = this.snapshot();
    if (options.color !== undefined) {
      const next = normalizeHex(options.color);
      if (!next) throw new Error(`Invalid color: ${options.color}`);
      this.doc = { ...this.doc, background: next };
    }
    if (options.transparent !== undefined) {
      this.doc = { ...this.doc, transparent: options.transparent };
    }
    this.commitState(before);
    return this.info();
  }

  rename(name: string) {
    const before = this.snapshot();
    const next = name.trim().replace(/\s+/g, " ").slice(0, 60) || "Untitled";
    this.projectName = next;
    this.commitState(before);
    return { project: next };
  }

  // ---------------------------------------------------------------- drawing

  private ensureStrokeCanvas() {
    if (
      !this.strokeCanvas ||
      this.strokeCanvas.width !== this.doc.width ||
      this.strokeCanvas.height !== this.doc.height
    ) {
      this.strokeCanvas = createCanvas(this.doc.width, this.doc.height);
      this.strokeCtx = ctxOf(this.strokeCanvas);
    }
    return this.strokeCanvas;
  }

  private symmetricPoints(x: number, y: number, symmetry: Symmetry) {
    const cx = this.doc.width / 2;
    const cy = this.doc.height / 2;
    const points: Point[] = [{ x, y }];
    if (symmetry === "vertical" || symmetry === "quad") {
      const mx = 2 * cx - x;
      if (Math.abs(mx - x) > 0.35) points.push({ x: mx, y });
    }
    if (symmetry === "horizontal" || symmetry === "quad") {
      const my = 2 * cy - y;
      if (Math.abs(my - y) > 0.35) points.push({ x, y: my });
    }
    if (symmetry === "quad") {
      const mx = 2 * cx - x;
      const my = 2 * cy - y;
      if (Math.abs(mx - x) > 0.35 && Math.abs(my - y) > 0.35) {
        points.push({ x: mx, y: my });
      }
    }
    return points;
  }

  drawStroke(options: {
    points: StrokePoint[];
    layerId?: string | number;
    preset?: string;
    color?: string;
    mode?: "paint" | "erase";
    size?: number;
    opacity?: number;
    flow?: number;
    hardness?: number;
    spacing?: number;
    smoothing?: number;
    pressureSize?: boolean;
    pressureOpacity?: boolean;
    symmetry?: Symmetry;
  }): DrawResult {
    const layer = this.resolveLayer(options.layerId);
    const points = (options.points ?? []).filter(
      (point) =>
        Number.isFinite(point?.x) && Number.isFinite(point?.y),
    );
    if (points.length === 0) {
      throw new Error("A stroke needs at least one point with x and y");
    }

    let settings: BrushSettings = { ...this.brush };
    if (options.preset) {
      const preset = brushPreset(options.preset);
      if (!preset) {
        throw new Error(
          `Unknown brush preset: ${options.preset}. Try pencil, ink, marker, airbrush or charcoal.`,
        );
      }
      settings = { ...settings, ...preset.settings };
    }
    const overrides: Partial<BrushSettings> = {};
    if (options.size !== undefined) overrides.size = options.size;
    if (options.opacity !== undefined) overrides.opacity = options.opacity;
    if (options.flow !== undefined) overrides.flow = options.flow;
    if (options.hardness !== undefined) overrides.hardness = options.hardness;
    if (options.spacing !== undefined) overrides.spacing = options.spacing;
    if (options.smoothing !== undefined) overrides.smoothing = options.smoothing;
    if (options.pressureSize !== undefined) {
      overrides.pressureSize = options.pressureSize;
    }
    if (options.pressureOpacity !== undefined) {
      overrides.pressureOpacity = options.pressureOpacity;
    }
    if (options.symmetry !== undefined) overrides.symmetry = options.symmetry;
    settings = { ...settings, ...overrides };

    settings.size = clamp(settings.size, 1, 400);
    settings.opacity = clamp(settings.opacity, 0, 1);
    settings.flow = clamp(settings.flow, 0.01, 1);
    settings.hardness = clamp(settings.hardness, 0, 1);
    settings.spacing = clamp(settings.spacing, 0.01, 2);
    settings.smoothing = clamp(settings.smoothing, 0, 0.95);

    const color = normalizeHex(options.color ?? this.color);
    if (!color) throw new Error(`Invalid color: ${String(options.color)}`);
    const mode = options.mode ?? "paint";
    this.brush = { ...settings };
    this.color = color;

    const strokeCanvas = this.ensureStrokeCanvas();
    const strokeCtx = this.strokeCtx!;
    strokeCtx.clearRect(0, 0, this.doc.width, this.doc.height);

    const smoothing = settings.smoothing;
    let filtered = points;
    if (smoothing > 0.005 && points.length > 2) {
      const follow = 1 - smoothing * 0.88;
      let sx = points[0].x;
      let sy = points[0].y;
      filtered = points.map((point, index) => {
        if (index > 0) {
          sx += (point.x - sx) * follow;
          sy += (point.y - sy) * follow;
        }
        return { x: sx, y: sy, pressure: point.pressure };
      });
    }

    const stampAt = (x: number, y: number, pressure: number) => {
      const sizeScale = settings.pressureSize
        ? 0.12 + 0.88 * pressure
        : 1;
      const size = Math.max(1, settings.size * sizeScale);
      const alpha = Math.max(
        0.008,
        settings.flow *
          (settings.pressureOpacity ? Math.max(0.04, pressure) : 1),
      );
      const stamp = stampCache.get(size, settings.hardness, color);
      const half = stamp.width / 2;
      const positions = this.symmetricPoints(x, y, settings.symmetry);

      const target =
        mode === "erase" ? ctxOf(layer.canvas) : strokeCtx;
      target.save();
      target.globalCompositeOperation =
        mode === "erase" ? "destination-out" : "source-over";
      target.globalAlpha =
        mode === "erase"
          ? clamp(alpha * settings.opacity, 0, 1)
          : clamp(alpha, 0, 1);
      for (const point of positions) {
        target.drawImage(stamp, point.x - half, point.y - half);
      }
      target.restore();
    };

    this.editPixels(layer, () => {
      const spacing = Math.max(0.6, settings.spacing * settings.size);
      let residual = 0;

      const first = filtered[0];
      stampAt(first.x, first.y, first.pressure ?? 1);

      for (let i = 1; i < filtered.length; i += 1) {
        const from = filtered[i - 1];
        const to = filtered[i];
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        if (distance === 0) continue;
        const pressureFrom = from.pressure ?? 1;
        const pressureTo = to.pressure ?? pressureFrom;

        let travelled = 0;
        let guard = 0;
        while (guard < 200_000) {
          guard += 1;
          const needed = spacing - residual;
          if (travelled + needed > distance) {
            residual += distance - travelled;
            break;
          }
          travelled += needed;
          residual = 0;
          const t = travelled / distance;
          stampAt(
            from.x + (to.x - from.x) * t,
            from.y + (to.y - from.y) * t,
            pressureFrom + (pressureTo - pressureFrom) * t,
          );
        }
      }

      if (mode === "paint") {
        const ctx = ctxOf(layer.canvas);
        ctx.save();
        ctx.globalAlpha = clamp(settings.opacity, 0, 1);
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(strokeCanvas, 0, 0);
        ctx.restore();
      }
    });

    return {
      layerId: layer.id,
      layerName: layer.name,
      history: this.history.length,
    };
  }

  drawShape(options: {
    shape: ShapeKind;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    stroke?: string;
    fill?: string;
    lineWidth?: number;
    opacity?: number;
    layerId?: string | number;
  }): DrawResult {
    const layer = this.resolveLayer(options.layerId);
    const stroke = options.stroke ? normalizeHex(options.stroke) : null;
    const fill = options.fill ? normalizeHex(options.fill) : null;
    if (!stroke && !fill) {
      throw new Error("A shape needs a stroke color, a fill color, or both");
    }
    if (options.stroke && !stroke) {
      throw new Error(`Invalid stroke color: ${options.stroke}`);
    }
    if (options.fill && !fill) {
      throw new Error(`Invalid fill color: ${options.fill}`);
    }
    const lineWidth = clamp(Number(options.lineWidth ?? 4), 0.1, 400);
    const opacity = clamp(Number(options.opacity ?? 1), 0, 1);

    this.editPixels(layer, (ctx) => {
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      if (options.shape === "line") {
        ctx.moveTo(options.x1, options.y1);
        ctx.lineTo(options.x2, options.y2);
      } else if (options.shape === "rect") {
        ctx.rect(
          Math.min(options.x1, options.x2),
          Math.min(options.y1, options.y2),
          Math.abs(options.x2 - options.x1),
          Math.abs(options.y2 - options.y1),
        );
      } else {
        const cx = (options.x1 + options.x2) / 2;
        const cy = (options.y1 + options.y2) / 2;
        const rx = Math.abs(options.x2 - options.x1) / 2;
        const ry = Math.abs(options.y2 - options.y1) / 2;
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      }
      if (fill && options.shape !== "line") {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
      ctx.restore();
    });

    return {
      layerId: layer.id,
      layerName: layer.name,
      history: this.history.length,
    };
  }

  drawText(options: {
    text: string;
    x: number;
    y: number;
    fontSize?: number;
    fontFamily?: string;
    weight?: number | string;
    italic?: boolean;
    color?: string;
    align?: "left" | "center" | "right";
    baseline?: "top" | "middle" | "bottom" | "alphabetic";
    lineHeight?: number;
    maxWidth?: number;
    opacity?: number;
    layerId?: string | number;
  }): DrawResult {
    const text = String(options.text ?? "");
    if (!text.trim()) throw new Error("Text is required");
    const layer = this.resolveLayer(options.layerId);
    const color = normalizeHex(options.color ?? this.color);
    if (!color) throw new Error(`Invalid color: ${String(options.color)}`);
    this.color = color;

    const fontSize = clamp(Number(options.fontSize ?? 48), 1, 2000);
    const family = options.fontFamily?.trim() || defaultFontFamily();
    const weight = options.weight ?? 400;
    const style = options.italic ? "italic " : "";
    const font = `${style}${weight} ${fontSize}px ${JSON.stringify(family)}`;
    const lineHeight = clamp(Number(options.lineHeight ?? 1.25), 0.6, 4);
    const opacity = clamp(Number(options.opacity ?? 1), 0, 1);
    const lines = text.split(/\r?\n/);

    this.editPixels(layer, (ctx) => {
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = color;
      ctx.font = font;
      ctx.textAlign = options.align ?? "left";
      ctx.textBaseline = options.baseline ?? "top";
      const step = fontSize * lineHeight;
      lines.forEach((line, index) => {
        const y = options.y + index * step;
        if (options.maxWidth) {
          ctx.fillText(line, options.x, y, options.maxWidth);
        } else {
          ctx.fillText(line, options.x, y);
        }
      });
      ctx.restore();
    });

    return {
      layerId: layer.id,
      layerName: layer.name,
      history: this.history.length,
    };
  }

  async loadImageSource(source: string): Promise<{
    image: Image;
    name: string;
  }> {
    const value = source.trim();
    if (!value) throw new Error("An image source is required");
    let buffer: Buffer;
    let name = "Image";

    if (value.startsWith("data:")) {
      buffer = decodeDataUrl(value);
    } else if (/^https?:\/\//i.test(value)) {
      const response = await fetch(value, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new Error(`Could not download the image (HTTP ${response.status})`);
      }
      buffer = Buffer.from(await response.arrayBuffer());
      name = decodeURIComponent(new URL(value).pathname.split("/").pop() || name);
    } else {
      const filePath = resolveUserPath(value);
      const info = await stat(filePath).catch(() => null);
      if (!info?.isFile()) throw new Error(`Image not found: ${filePath}`);
      if (info.size > MAX_IMAGE_BYTES) {
        throw new Error("That image is too large to place");
      }
      buffer = await readFile(filePath);
      name = filePath.split(/[\\/]/).pop() || name;
    }

    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("That image is too large to place");
    }
    const image = await loadImage(buffer);
    name = name.replace(/\.[^.]+$/, "").slice(0, 40) || "Image";
    return { image, name };
  }

  async placeImage(options: {
    source: string;
    name?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    fit?: "contain" | "cover" | "stretch";
    rotation?: number;
    opacity?: number;
  }) {
    if (this.layers.length >= MAX_PROJECT_LAYERS) {
      throw new Error(`A project can hold at most ${MAX_PROJECT_LAYERS} layers`);
    }
    const { image, name } = await this.loadImageSource(options.source);
    const docWidth = this.doc.width;
    const docHeight = this.doc.height;

    let width = options.width;
    let height = options.height;
    const fit = options.fit ?? "contain";

    if (width === undefined && height === undefined) {
      if (fit === "stretch") {
        width = docWidth;
        height = docHeight;
      } else {
        const scale =
          fit === "cover"
            ? Math.max(docWidth / image.width, docHeight / image.height)
            : Math.min(1, docWidth / image.width, docHeight / image.height);
        width = image.width * scale;
        height = image.height * scale;
      }
    } else if (width === undefined) {
      width = (image.width / image.height) * (height as number);
    } else if (height === undefined) {
      height = (image.height / image.width) * width;
    }

    const drawWidth = Math.max(1, width as number);
    const drawHeight = Math.max(1, height as number);
    const x = options.x ?? (docWidth - drawWidth) / 2;
    const y = options.y ?? (docHeight - drawHeight) / 2;

    const before = this.snapshot();
    const layer = this.makeLayer(
      options.name?.trim().slice(0, 60) || name,
      docWidth,
      docHeight,
    );
    const ctx = ctxOf(layer.canvas);
    ctx.save();
    ctx.globalAlpha = clamp(options.opacity ?? 1, 0, 1);
    ctx.imageSmoothingQuality = "high";
    if (options.rotation) {
      ctx.translate(x + drawWidth / 2, y + drawHeight / 2);
      ctx.rotate((options.rotation * Math.PI) / 180);
      ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    } else {
      ctx.drawImage(image, x, y, drawWidth, drawHeight);
    }
    ctx.restore();

    const activeIndex = this.layers.findIndex(
      (item) => item.id === this.activeLayerId,
    );
    const at = activeIndex < 0 ? this.layers.length : activeIndex + 1;
    this.layers = [
      ...this.layers.slice(0, at),
      layer,
      ...this.layers.slice(at),
    ];
    this.activeLayerId = layer.id;
    this.commitState(before);

    return {
      ...this.layerSummary(layer),
      placedWidth: Math.round(drawWidth),
      placedHeight: Math.round(drawHeight),
    };
  }

  // ---------------------------------------------------------------- render

  renderComposite(options: {
    scale?: number;
    width?: number;
    height?: number;
    background?: "doc" | "white" | "none" | "checker";
    page?: number;
  } = {}) {
    const page =
      options.page === undefined ? this.currentPage : this.pages[options.page];
    if (!page) {
      throw new Error(
        `Page index ${String(options.page)} is out of range (0-${this.pages.length - 1})`,
      );
    }
    const background = options.background ?? "doc";
    let width = Math.round(options.width ?? page.doc.width * (options.scale ?? 1));
    let height = Math.round(
      options.height ?? page.doc.height * (options.scale ?? 1),
    );
    if (width < 1 || height < 1) throw new Error("The render size is too small");
    if (width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE) {
      throw new Error(`The render is limited to ${MAX_EXPORT_SIDE} px per side`);
    }

    const canvas = createCanvas(width, height);
    const ctx = ctxOf(canvas);

    if (background === "doc") {
      ctx.fillStyle = page.doc.background;
      ctx.fillRect(0, 0, width, height);
    } else if (background === "white") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    } else if (background === "checker") {
      const tile = createCanvas(24, 24);
      const tctx = ctxOf(tile);
      tctx.fillStyle = "#26262b";
      tctx.fillRect(0, 0, 24, 24);
      tctx.fillStyle = "#1d1d21";
      tctx.fillRect(0, 0, 12, 12);
      tctx.fillRect(12, 12, 12, 12);
      const pattern = ctx.createPattern(tile, "repeat");
      ctx.fillStyle = pattern ?? "#1d1d21";
      ctx.fillRect(0, 0, width, height);
    }

    for (const layer of page.layers) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      ctx.drawImage(layer.canvas, 0, 0, width, height);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    return canvas;
  }

  async preview(options: { maxWidth?: number; page?: number } = {}) {
    const page =
      options.page === undefined ? this.currentPage : this.pages[options.page];
    if (!page) {
      throw new Error(
        `Page index ${String(options.page)} is out of range (0-${this.pages.length - 1})`,
      );
    }
    const maxWidth = clamp(Number(options.maxWidth ?? 0), 0, MAX_EXPORT_SIDE);
    const scale =
      maxWidth > 0 && page.doc.width > maxWidth ? maxWidth / page.doc.width : 1;
    const canvas = this.renderComposite({
      scale,
      background: page.doc.transparent ? "checker" : "doc",
      page: options.page,
    });
    const data = await canvas.encode("png");
    return {
      data,
      width: canvas.width,
      height: canvas.height,
      pageIndex: options.page ?? this.activePageIndex,
      pageName: page.name,
      mimeType: "image/png" as const,
    };
  }

  async exportImage(options: {
    format?: ExportFormat;
    path?: string;
    scale?: number;
    width?: number;
    quality?: number;
    transparent?: boolean;
    page?: number;
  }): Promise<ExportResult> {
    const format = options.format ?? "png";
    if (!(format in MIME)) {
      throw new Error(`Unsupported export format: ${String(options.format)}`);
    }
    const page =
      options.page === undefined ? this.currentPage : this.pages[options.page];
    if (!page) {
      throw new Error(
        `Page index ${String(options.page)} is out of range (0-${this.pages.length - 1})`,
      );
    }

    let width: number;
    if (options.width !== undefined) {
      width = Math.round(options.width);
    } else {
      width = Math.round(page.doc.width * clamp(options.scale ?? 1, 0.1, 8));
    }
    width = clamp(width, 1, MAX_EXPORT_SIDE);
    const height = Math.max(
      1,
      Math.min(
        MAX_EXPORT_SIDE,
        Math.round((width / page.doc.width) * page.doc.height),
      ),
    );

    const keepAlpha =
      (format === "png" || format === "webp") &&
      (options.transparent ?? page.doc.transparent);

    // Blend modes must composite over the real backdrop, so the background is
    // laid down first when the export is opaque. Only a transparent PNG/WebP
    // keeps the layers over nothing, matching the web studio.
    const canvas = this.renderComposite({
      width,
      height,
      background: keepAlpha
        ? "none"
        : page.doc.transparent
          ? "white"
          : "doc",
      page: options.page,
    });

    const quality = clamp(Number(options.quality ?? 0.92), 0.05, 1);
    const data =
      format === "png"
        ? await canvas.encode("png")
        : await canvas.encode(format, Math.round(quality * 100));

    const target = resolveUserPath(
      options.path ||
        `${safeName(this.projectName)}.${
          format === "jpeg" ? "jpg" : format
        }`,
    );
    await ensureParent(target);
    await writeFile(target, data);

    return {
      path: target,
      format,
      mimeType: MIME[format],
      width,
      height,
      bytes: data.byteLength,
      pageIndex: options.page ?? this.activePageIndex,
      pageName: page.name,
    };
  }

  async exportAllPages(options: {
    format?: ExportFormat;
    path?: string;
    scale?: number;
    width?: number;
    quality?: number;
    transparent?: boolean;
  } = {}): Promise<ExportResult[]> {
    const extension = (options.format ?? "png") === "jpeg" ? "jpg" : options.format ?? "png";
    const base = options.path;
    const results: ExportResult[] = [];
    for (let index = 0; index < this.pages.length; index += 1) {
      let path = base;
      if (base) {
        const dot = base.lastIndexOf(".");
        const stem = dot > 0 ? base.slice(0, dot) : base;
        path = `${stem}-${String(index + 1).padStart(2, "0")}.${extension}`;
      }
      results.push(await this.exportImage({ ...options, page: index, path }));
    }
    return results;
  }

  // --------------------------------------------------------------- projects

  serializeProject() {
    const pages = this.pages.map((page) => {
      const activeIndex = Math.max(
        0,
        page.layers.findIndex((layer) => layer.id === page.activeLayerId),
      );
      return {
        name: page.name,
        doc: { ...page.doc },
        activeIndex,
        layers: page.layers.map((layer) => ({
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          blend: layer.blend,
          image: `data:image/png;base64,${layer.canvas
            .toBuffer("image/png")
            .toString("base64")}`,
        })),
      };
    });
    return JSON.stringify({
      app: PROJECT_APP_ID,
      version: PROJECT_VERSION,
      savedAt: new Date().toISOString(),
      name: this.projectName,
      activePage: this.activePageIndex,
      pages,
    });
  }

  async saveProject(path?: string): Promise<SaveResult> {
    const text = this.serializeProject();
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_PROJECT_BYTES) {
      throw new Error("This project is too large to save");
    }
    const target = resolveUserPath(
      path || `${safeName(this.projectName)}.marsam`,
    );
    await ensureParent(target);
    await writeFile(target, text, "utf8");
    this.saved = true;
    return {
      path: target,
      bytes,
      layers: this.layers.length,
      pages: this.pages.length,
    };
  }

  async openProject(path: string): Promise<OpenResult> {
    const target = resolveUserPath(path);
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) throw new Error(`Project not found: ${target}`);
    if (info.size > MAX_PROJECT_BYTES) {
      throw new Error("This project file is too large to open");
    }
    const text = await readFile(target, "utf8");
    const parsed = parseProjectFile(text);

    const pages: Page[] = [];
    for (const pageData of parsed.pages) {
      const { width, height } = pageData.doc;
      const layers: Layer[] = [];
      for (const item of pageData.layers) {
        const canvas = createCanvas(width, height);
        if (item.image) {
          let image: Image;
          try {
            image = await loadImage(decodeDataUrl(item.image));
          } catch {
            throw new Error("A layer image in this project could not be read");
          }
          const ctx = ctxOf(canvas);
          ctx.imageSmoothingQuality = "high";
          const scale = Math.min(
            1,
            width / image.width,
            height / image.height,
          );
          const drawWidth = image.width * scale;
          const drawHeight = image.height * scale;
          ctx.drawImage(
            image,
            (width - drawWidth) / 2,
            (height - drawHeight) / 2,
            drawWidth,
            drawHeight,
          );
        }
        this.layerSerial += 1;
        layers.push({
          id: `layer-${this.layerSerial}`,
          name: item.name,
          canvas,
          visible: item.visible,
          opacity: item.opacity,
          blend: item.blend,
        });
      }
      pages.push(
        this.makePage(
          pageData.name,
          { ...pageData.doc },
          layers,
          layers[Math.min(pageData.activeIndex, layers.length - 1)]?.id ??
            layers[0].id,
        ),
      );
    }

    this.pages = pages;
    this.activePageIndex = Math.min(
      Math.max(0, parsed.activePage),
      pages.length - 1,
    );
    this.projectName = parsed.name;
    this.resetStrokeState();
    this.saved = true;

    return {
      path: target,
      project: parsed.name,
      width: this.doc.width,
      height: this.doc.height,
      layers: this.layers.length,
      pageIndex: this.activePageIndex,
      pages: this.pageSummaries(),
    };
  }

  /** Adds a font file to the headless renderer. */
  registerFont(path: string, family?: string) {
    const target = resolveUserPath(path);
    const key = GlobalFonts.registerFromPath(target, family);
    if (!key) throw new Error(`Could not load the font: ${target}`);
    return {
      path: target,
      family: family ?? null,
      families: GlobalFonts.families.map((item) => item.family),
    };
  }

  fontFamilies() {
    return GlobalFonts.families.map((item) => item.family).sort();
  }
}
