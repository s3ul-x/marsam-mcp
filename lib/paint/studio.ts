import {
  DEFAULT_BRUSH,
  stampCache,
  type BrushPreset,
  type BrushSettings,
} from "./brush";
import { clamp, hexToRgb, normalizeHex, rgbToHex } from "./color";
import {
  PROJECT_APP_ID,
  PROJECT_VERSION,
  parseProjectFile,
  readLayerImage,
} from "./project";

export type Point = { x: number; y: number };

export type ToolId = "brush" | "eraser" | "eyedropper" | "pan";

export type BlendMode =
  | "source-over"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: "source-over", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "color-dodge", label: "Color Dodge" },
  { value: "color-burn", label: "Color Burn" },
  { value: "hard-light", label: "Hard Light" },
  { value: "soft-light", label: "Soft Light" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
];

export type Layer = {
  id: string;
  name: string;
  canvas: HTMLCanvasElement | null;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
};

export type DocSettings = {
  width: number;
  height: number;
  background: string;
  transparent: boolean;
};

/**
 * One page of a project. Every page owns its canvas size, its layers and its
 * own undo history, so switching pages never mixes documents together.
 */
export type Page = {
  id: string;
  name: string;
  doc: DocSettings;
  layers: Layer[];
  activeLayerId: string;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
};

export type PageSummary = {
  id: string;
  name: string;
  width: number;
  height: number;
  layers: number;
  active: boolean;
};

export const MAX_PAGES = 24;

export type ExportFormat = "image/png" | "image/jpeg" | "image/webp";

export type ExportOptions = {
  format: ExportFormat;
  scale: number;
  quality: number;
  includeBackground: boolean;
};

export type ExportResult = {
  blob: Blob;
  width: number;
  height: number;
};

export type ViewState = {
  cx: number;
  cy: number;
  scale: number;
  rotation: number;
  initialized: boolean;
};

export type LayerPatch = Partial<Pick<Layer, "name" | "visible" | "opacity" | "blend">>;

type TileSnapshot = {
  x: number;
  y: number;
  w: number;
  h: number;
  data: ImageData;
};

type StateSnapshot = {
  doc: DocSettings;
  layers: Layer[];
  activeLayerId: string;
};

type PixelEntry = {
  kind: "pixels";
  layerId: string;
  before: TileSnapshot[];
  after: TileSnapshot[];
};

type StateEntry = {
  kind: "state";
  before: StateSnapshot;
  after: StateSnapshot;
};

type HistoryEntry = PixelEntry | StateEntry;

type StrokeState = {
  layer: Layer;
  mode: "paint" | "erase";
  lastDraw: Point;
  smooth: Point;
  lastPressure: number;
  lastTime: number;
  residual: number;
  tiles: Map<string, TileSnapshot>;
  pointerType: string;
};

const TILE_SIZE = 256;
const MAX_HISTORY = 30;
export const MIN_DOC_SIZE = 64;
export const MAX_DOC_SIZE = 6000;
export const MAX_DOC_PIXELS = 40_000_000;

let layerSerial = 1;
let idCounter = 0;

function nextLayerId() {
  idCounter += 1;
  return `layer-${Date.now().toString(36)}-${idCounter}`;
}

function nextPageId() {
  idCounter += 1;
  return `page-${Date.now().toString(36)}-${idCounter}`;
}

function createElementCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function ctx2d(canvas: HTMLCanvasElement) {
  return canvas.getContext("2d", { willReadFrequently: false });
}

export class Studio {
  pages: Page[] = [
    {
      id: "page-primary",
      name: "Page 1",
      doc: {
        width: 1920,
        height: 1080,
        background: "#0f0f0f",
        transparent: false,
      },
      layers: [
        {
          id: "layer-primary",
          name: "Layer 1",
          canvas: null,
          visible: true,
          opacity: 1,
          blend: "source-over",
        },
      ],
      activeLayerId: "layer-primary",
      undoStack: [],
      redoStack: [],
    },
  ];

  activePageIndex = 0;

  /**
   * `doc`, `layers`, `activeLayerId` and the two history stacks always point at
   * the active page, so every existing tool keeps working unchanged.
   */
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

  private get undoStack(): HistoryEntry[] {
    return this.currentPage.undoStack;
  }

  private set undoStack(next: HistoryEntry[]) {
    this.currentPage.undoStack = next;
  }

  private get redoStack(): HistoryEntry[] {
    return this.currentPage.redoStack;
  }

  private set redoStack(next: HistoryEntry[]) {
    this.currentPage.redoStack = next;
  }

  projectName = "Untitled";
  tool: ToolId = "brush";
  color = "#f6f3ec";
  brush: BrushSettings = { ...DEFAULT_BRUSH };
  activePresetId = "custom";
  recentColors: string[] = ["#f6f3ec", "#0f0f0f", "#e2b264"];
  view: ViewState = { cx: 0, cy: 0, scale: 1, rotation: 0, initialized: false };
  version = 0;
  dirtyArtwork = false;

  private listeners = new Set<() => void>();
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private dpr = 1;
  private vw = 0;
  private vh = 0;
  private rafId = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEmitAt = 0;
  private checkerPattern: CanvasPattern | null = null;

  private stroke: StrokeState | null = null;
  private strokeCanvas: HTMLCanvasElement | null = null;
  private strokeCtx: CanvasRenderingContext2D | null = null;
  private speedEma = 0;

  private pendingSnapshot: StateSnapshot | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.version;

  emit() {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }

  emitSoon() {
    const now = performance.now();
    if (now - this.lastEmitAt > 70) {
      this.lastEmitAt = now;
      this.emit();
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.lastEmitAt = performance.now();
      this.emit();
    }, 80);
  }

  flushEmit() {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.lastEmitAt = performance.now();
    this.emit();
  }

  // ---------------------------------------------------------------- canvas

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.layers = this.layers.map((layer) =>
      layer.canvas ? layer : { ...layer, canvas: this.createCanvas() },
    );
    this.requestRender();
  }

  detach(canvas: HTMLCanvasElement) {
    if (this.canvas !== canvas) return;
    this.canvas = null;
    this.ctx = null;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  setViewportSize(width: number, height: number) {
    const nextW = Math.max(1, Math.floor(width));
    const nextH = Math.max(1, Math.floor(height));
    const prevW = this.vw;
    const prevH = this.vh;
    this.vw = nextW;
    this.vh = nextH;
    this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));

    if (this.canvas) {
      const pixelW = Math.round(nextW * this.dpr);
      const pixelH = Math.round(nextH * this.dpr);
      if (this.canvas.width !== pixelW) this.canvas.width = pixelW;
      if (this.canvas.height !== pixelH) this.canvas.height = pixelH;
    }

    if (!this.view.initialized) {
      this.fitView();
    } else if (prevW && prevH) {
      this.view.cx += (nextW - prevW) / 2;
      this.view.cy += (nextH - prevH) / 2;
    }
    this.requestRender();
    this.emit();
  }

  private fitView(pad = 72) {
    // Keep a visible margin on small screens without wasting the whole viewport.
    const margin = Math.min(pad, Math.max(12, Math.min(this.vw, this.vh) * 0.06));
    const availableW = Math.max(40, this.vw - margin * 2);
    const availableH = Math.max(40, this.vh - margin * 2);
    const scale = Math.min(availableW / this.doc.width, availableH / this.doc.height);
    this.view = {
      cx: this.vw / 2,
      cy: this.vh / 2,
      scale: clamp(scale, 0.02, 8),
      rotation: 0,
      initialized: true,
    };
  }

  fitToScreen() {
    this.fitView();
    this.requestRender();
    this.flushEmit();
  }

  actualSize() {
    this.zoomAt(1 / this.view.scale, this.vw / 2, this.vh / 2);
    this.flushEmit();
  }

  setZoom(scale: number) {
    this.zoomAt(scale / this.view.scale, this.vw / 2, this.vh / 2);
    this.flushEmit();
  }

  zoomStep(factor: number) {
    this.zoomAt(factor, this.vw / 2, this.vh / 2);
    this.flushEmit();
  }

  zoomAt(factor: number, screenX: number, screenY: number) {
    const anchor = this.screenToDoc({ x: screenX, y: screenY });
    const next = clamp(this.view.scale * factor, 0.02, 16);
    if (next === this.view.scale) return;
    this.view.scale = next;
    const projected = this.docToScreen(anchor);
    this.view.cx += screenX - projected.x;
    this.view.cy += screenY - projected.y;
    this.requestRender();
    this.emitSoon();
  }

  rotateAt(delta: number, screenX: number, screenY: number) {
    const anchor = this.screenToDoc({ x: screenX, y: screenY });
    this.view.rotation += delta;
    const projected = this.docToScreen(anchor);
    this.view.cx += screenX - projected.x;
    this.view.cy += screenY - projected.y;
    this.requestRender();
    this.emitSoon();
  }

  rotateBy(degrees: number) {
    this.rotateAt((degrees * Math.PI) / 180, this.vw / 2, this.vh / 2);
    this.flushEmit();
  }

  resetRotation() {
    this.view.rotation = 0;
    this.requestRender();
    this.flushEmit();
  }

  panBy(dx: number, dy: number) {
    this.view.cx += dx;
    this.view.cy += dy;
    this.requestRender();
    this.emitSoon();
  }

  matrix() {
    const matrix = new DOMMatrix();
    matrix.translateSelf(this.view.cx, this.view.cy);
    matrix.rotateSelf((this.view.rotation * 180) / Math.PI);
    matrix.scaleSelf(this.view.scale, this.view.scale);
    matrix.translateSelf(-this.doc.width / 2, -this.doc.height / 2);
    return matrix;
  }

  docToScreen(point: Point) {
    const matrix = this.matrix();
    const result = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: result.x, y: result.y };
  }

  screenToDoc(point: Point): Point {
    const { cx, cy, scale, rotation } = this.view;
    const dx = (point.x - cx) / scale;
    const dy = (point.y - cy) / scale;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const x = dx * cos + dy * sin;
    const y = -dx * sin + dy * cos;
    return { x: x + this.doc.width / 2, y: y + this.doc.height / 2 };
  }

  private docCorners() {
    const matrix = this.matrix();
    const points = [
      { x: 0, y: 0 },
      { x: this.doc.width, y: 0 },
      { x: this.doc.width, y: this.doc.height },
      { x: 0, y: this.doc.height },
    ];
    return points.map((point) => {
      const result = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: result.x, y: result.y };
    });
  }

  // ---------------------------------------------------------------- render

  requestRender() {
    if (this.rafId || typeof window === "undefined") return;
    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = 0;
      this.render();
    });
  }

  render() {
    const ctx = this.ctx;
    if (!ctx || !this.canvas || !this.vw || !this.vh) return;
    const { dpr } = this;
    const corners = this.docCorners();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);

    // Soft drop shadow under the sheet.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = 46;
    ctx.shadowOffsetY = 16;
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();

    if (this.doc.transparent) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.clip();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = this.getCheckerPattern(ctx);
      ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.restore();
    }

    ctx.save();
    const matrix = this.matrix();
    ctx.setTransform(
      dpr * matrix.a,
      dpr * matrix.b,
      dpr * matrix.c,
      dpr * matrix.d,
      dpr * matrix.e,
      dpr * matrix.f,
    );

    if (!this.doc.transparent) {
      ctx.fillStyle = this.doc.background;
      ctx.fillRect(0, 0, this.doc.width, this.doc.height);
    }

    for (const layer of this.layers) {
      if (!layer.visible || !layer.canvas) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      ctx.drawImage(layer.canvas, 0, 0, this.doc.width, this.doc.height);
      if (
        this.stroke &&
        this.stroke.mode === "paint" &&
        this.stroke.layer.id === layer.id &&
        this.strokeCanvas
      ) {
        ctx.globalAlpha = layer.opacity * clamp(this.brush.opacity, 0, 1);
        ctx.drawImage(
          this.strokeCanvas,
          0,
          0,
          this.doc.width,
          this.doc.height,
        );
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();

    // Sheet border and symmetry guides in screen space.
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    ctx.stroke();

    if (this.brush.symmetry !== "none" && this.tool !== "pan") {
      const center = this.docToScreen({
        x: this.doc.width / 2,
        y: this.doc.height / 2,
      });
      const horizontal = this.docToScreen({
        x: this.doc.width,
        y: this.doc.height / 2,
      });
      const vertical = this.docToScreen({
        x: this.doc.width / 2,
        y: this.doc.height,
      });
      ctx.strokeStyle = "rgba(226, 178, 100, 0.5)";
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      if (this.brush.symmetry === "vertical" || this.brush.symmetry === "quad") {
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(horizontal.x, horizontal.y);
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(2 * center.x - horizontal.x, 2 * center.y - horizontal.y);
      }
      if (this.brush.symmetry === "horizontal" || this.brush.symmetry === "quad") {
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(vertical.x, vertical.y);
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(2 * center.x - vertical.x, 2 * center.y - vertical.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  private getCheckerPattern(ctx: CanvasRenderingContext2D) {
    if (this.checkerPattern) return this.checkerPattern;
    const tile = document.createElement("canvas");
    tile.width = 20;
    tile.height = 20;
    const tctx = tile.getContext("2d");
    if (tctx) {
      tctx.fillStyle = "#17171b";
      tctx.fillRect(0, 0, 20, 20);
      tctx.fillStyle = "#212127";
      tctx.fillRect(0, 0, 10, 10);
      tctx.fillRect(10, 10, 10, 10);
    }
    this.checkerPattern = ctx.createPattern(tile, "repeat");
    return this.checkerPattern ?? "#17171b";
  }

  // ---------------------------------------------------------------- stroke

  private createCanvas(width = this.doc.width, height = this.doc.height) {
    return createElementCanvas(width, height);
  }

  private ensureStrokeCanvas() {
    if (
      !this.strokeCanvas ||
      this.strokeCanvas.width !== this.doc.width ||
      this.strokeCanvas.height !== this.doc.height
    ) {
      this.strokeCanvas = this.createCanvas();
      this.strokeCtx = this.strokeCanvas.getContext("2d");
    }
    return this.strokeCanvas;
  }

  getActiveLayer() {
    return this.layers.find((layer) => layer.id === this.activeLayerId) ?? null;
  }

  beginStroke(screen: Point, pressure: number, pointerType: string, time: number) {
    if (this.tool !== "brush" && this.tool !== "eraser") return false;
    const layer = this.getActiveLayer();
    if (!layer) return false;
    if (!layer.canvas) layer.canvas = this.createCanvas();
    const point = this.screenToDoc(screen);

    this.ensureStrokeCanvas();
    this.strokeCtx?.clearRect(0, 0, this.doc.width, this.doc.height);

    const initialPressure =
      pointerType === "pen" ? clamp(pressure || 0.5, 0.02, 1) : 1;
    this.speedEma = 0;
    this.stroke = {
      layer,
      mode: this.tool === "eraser" ? "erase" : "paint",
      lastDraw: point,
      smooth: point,
      lastPressure: initialPressure,
      lastTime: time,
      residual: 0,
      tiles: new Map(),
      pointerType,
    };
    this.stampAt(point.x, point.y, initialPressure);
    this.requestRender();
    return true;
  }

  strokeTo(screen: Point, pressure: number, time: number) {
    const stroke = this.stroke;
    if (!stroke) return;
    const raw = this.screenToDoc(screen);
    const smoothing = clamp(this.brush.smoothing, 0, 0.95);
    let target = raw;
    if (smoothing > 0.005) {
      const follow = 1 - smoothing * 0.88;
      stroke.smooth = {
        x: stroke.smooth.x + (raw.x - stroke.smooth.x) * follow,
        y: stroke.smooth.y + (raw.y - stroke.smooth.y) * follow,
      };
      target = stroke.smooth;
    }

    const from = stroke.lastDraw;
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.2) return;

    const dt = Math.max(6, time - stroke.lastTime);
    let nextPressure: number;
    if (stroke.pointerType === "pen") {
      nextPressure = clamp(pressure || 0.5, 0.02, 1);
    } else {
      const screenSpeed = (distance * this.view.scale) / dt;
      this.speedEma = this.speedEma * 0.72 + screenSpeed * 0.28;
      nextPressure = clamp(1 - this.speedEma * 0.16, 0.45, 1);
    }

    this.drawSegment(from, target, stroke.lastPressure, nextPressure);
    stroke.lastDraw = target;
    stroke.lastPressure = nextPressure;
    stroke.lastTime = time;
    this.requestRender();
  }

  private drawSegment(from: Point, to: Point, pressureFrom: number, pressureTo: number) {
    const stroke = this.stroke;
    if (!stroke) return;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (distance === 0) return;

    const spacing = Math.max(0.6, this.brush.spacing * this.brush.size);
    let travelled = 0;
    let guard = 0;

    while (guard < 20000) {
      guard += 1;
      const needed = spacing - stroke.residual;
      if (travelled + needed > distance) {
        stroke.residual += distance - travelled;
        break;
      }
      travelled += needed;
      stroke.residual = 0;
      const t = travelled / distance;
      this.stampAt(
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
        pressureFrom + (pressureTo - pressureFrom) * t,
      );
    }
  }

  private symmetricPoints(x: number, y: number) {
    const cx = this.doc.width / 2;
    const cy = this.doc.height / 2;
    const points: Point[] = [{ x, y }];
    const symmetry = this.brush.symmetry;
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

  private stampAt(x: number, y: number, pressure: number) {
    const stroke = this.stroke;
    const layer = stroke?.layer;
    if (!stroke || !layer?.canvas) return;

    const sizeScale = this.brush.pressureSize ? 0.12 + 0.88 * pressure : 1;
    const size = Math.max(1, this.brush.size * sizeScale);
    const alpha = Math.max(
      0.008,
      this.brush.flow *
        (this.brush.pressureOpacity ? Math.max(0.04, pressure) : 1),
    );
    const stamp = stampCache.get(size, this.brush.hardness, this.color);
    const half = stamp.width / 2;
    const positions = this.symmetricPoints(x, y);

    // Snapshot every tile the dab will touch before it is modified.
    for (const point of positions) {
      this.captureTiles(point.x - half, point.y - half, stamp.width, stamp.width);
    }

    const target =
      stroke.mode === "erase" ? ctx2d(layer.canvas) : this.strokeCtx;
    if (!target) return;
    target.save();
    target.globalCompositeOperation =
      stroke.mode === "erase" ? "destination-out" : "source-over";
    target.globalAlpha =
      stroke.mode === "erase"
        ? clamp(alpha * this.brush.opacity, 0, 1)
        : clamp(alpha, 0, 1);
    for (const point of positions) {
      target.drawImage(stamp, point.x - half, point.y - half);
    }
    target.restore();
  }

  private captureTiles(left: number, top: number, width: number, height: number) {
    const stroke = this.stroke;
    const layer = stroke?.layer;
    if (!stroke || !layer?.canvas) return;
    const ctx = ctx2d(layer.canvas);
    if (!ctx) return;

    const tilesX = Math.ceil(this.doc.width / TILE_SIZE);
    const tilesY = Math.ceil(this.doc.height / TILE_SIZE);
    const startX = Math.max(0, Math.floor(left / TILE_SIZE));
    const startY = Math.max(0, Math.floor(top / TILE_SIZE));
    const endX = Math.min(tilesX - 1, Math.floor((left + width) / TILE_SIZE));
    const endY = Math.min(tilesY - 1, Math.floor((top + height) / TILE_SIZE));

    for (let tx = startX; tx <= endX; tx += 1) {
      for (let ty = startY; ty <= endY; ty += 1) {
        const key = `${tx}:${ty}`;
        if (stroke.tiles.has(key)) continue;
        const sx = tx * TILE_SIZE;
        const sy = ty * TILE_SIZE;
        const w = Math.min(TILE_SIZE, this.doc.width - sx);
        const h = Math.min(TILE_SIZE, this.doc.height - sy);
        if (w <= 0 || h <= 0) continue;
        stroke.tiles.set(key, {
          x: sx,
          y: sy,
          w,
          h,
          data: ctx.getImageData(sx, sy, w, h),
        });
      }
    }
  }

  endStroke() {
    const stroke = this.stroke;
    if (!stroke) return;
    const layer = stroke.layer;
    if (!layer.canvas) {
      this.stroke = null;
      return;
    }

    if (stroke.mode === "paint" && this.strokeCanvas) {
      const ctx = ctx2d(layer.canvas);
      if (ctx) {
        ctx.save();
        ctx.globalAlpha = clamp(this.brush.opacity, 0, 1);
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(this.strokeCanvas, 0, 0);
        ctx.restore();
      }
    }

    if (stroke.tiles.size > 0) {
      const ctx = ctx2d(layer.canvas);
      if (ctx) {
        const after: TileSnapshot[] = [];
        stroke.tiles.forEach((tile) => {
          after.push({
            x: tile.x,
            y: tile.y,
            w: tile.w,
            h: tile.h,
            data: ctx.getImageData(tile.x, tile.y, tile.w, tile.h),
          });
        });
        this.pushHistory({
          kind: "pixels",
          layerId: layer.id,
          before: Array.from(stroke.tiles.values()),
          after,
        });
      }
    }

    this.stroke = null;
    this.strokeCtx?.clearRect(0, 0, this.doc.width, this.doc.height);
    this.dirtyArtwork = true;
    this.emit();
    this.requestRender();
  }

  cancelStroke() {
    const stroke = this.stroke;
    if (!stroke) return;
    const canvas = stroke.layer.canvas;
    if (canvas) {
      const ctx = ctx2d(canvas);
      if (ctx) {
        stroke.tiles.forEach((tile) => ctx.putImageData(tile.data, tile.x, tile.y));
      }
    }
    this.stroke = null;
    this.strokeCtx?.clearRect(0, 0, this.doc.width, this.doc.height);
    this.emit();
    this.requestRender();
  }

  sampleColor(screen: Point): string | null {
    if (!this.ctx) return null;
    const x = Math.round(screen.x * this.dpr);
    const y = Math.round(screen.y * this.dpr);
    if (x < 0 || y < 0 || x >= this.canvas!.width || y >= this.canvas!.height) {
      return null;
    }
    const data = this.ctx.getImageData(x, y, 1, 1).data;
    if (data[3] === 0) return null;
    return rgbToHex(data[0], data[1], data[2]);
  }

  // ---------------------------------------------------------------- tools

  setTool(tool: ToolId) {
    if (this.tool === tool) return;
    this.tool = tool;
    this.emit();
  }

  setColor(color: string, options?: { recent?: boolean }) {
    const next = normalizeHex(color);
    if (!next) return;
    this.color = next;
    if (options?.recent) this.pushRecentColor(next);
    this.emit();
  }

  pushRecentColor(color: string) {
    const next = normalizeHex(color);
    if (!next) return;
    this.recentColors = [next, ...this.recentColors.filter((c) => c !== next)].slice(0, 12);
    this.emit();
  }

  setBrush(patch: Partial<BrushSettings>, presetId = "custom") {
    this.brush = { ...this.brush, ...patch };
    this.activePresetId = presetId;
    this.emit();
    this.requestRender();
  }

  applyBrushPreset(preset: BrushPreset) {
    this.brush = {
      ...this.brush,
      ...preset.settings,
      symmetry: this.brush.symmetry,
    };
    this.activePresetId = preset.id;
    this.emit();
  }

  findPresetForSettings() {
    return this.activePresetId;
  }

  // ---------------------------------------------------------------- history

  private snapshotState(): StateSnapshot {
    return {
      doc: { ...this.doc },
      layers: [...this.layers],
      activeLayerId: this.activeLayerId,
    };
  }

  private sameState(a: StateSnapshot, b: StateSnapshot) {
    if (
      a.doc.width !== b.doc.width ||
      a.doc.height !== b.doc.height ||
      a.doc.background !== b.doc.background ||
      a.doc.transparent !== b.doc.transparent
    ) {
      return false;
    }
    if (a.activeLayerId !== b.activeLayerId) return false;
    if (a.layers.length !== b.layers.length) return false;
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

  private trimHistory() {
    while (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
  }

  private pushHistory(entry: HistoryEntry) {
    this.undoStack.push(entry);
    this.trimHistory();
    this.redoStack = [];
    this.dirtyArtwork = true;
  }

  private pushState(before: StateSnapshot) {
    const after = this.snapshotState();
    if (this.sameState(before, after)) return;
    this.pushHistory({ kind: "state", before, after });
  }

  beginEdit() {
    if (!this.pendingSnapshot) this.pendingSnapshot = this.snapshotState();
  }

  commitEdit() {
    if (!this.pendingSnapshot) return;
    const before = this.pendingSnapshot;
    this.pendingSnapshot = null;
    this.pushState(before);
    this.emit();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (this.stroke) this.cancelStroke();
    const entry = this.undoStack.pop();
    if (!entry) return;
    if (entry.kind === "pixels") {
      const layer = this.layers.find((item) => item.id === entry.layerId);
      const ctx = layer?.canvas ? ctx2d(layer.canvas) : null;
      if (ctx) {
        entry.before.forEach((tile) => ctx.putImageData(tile.data, tile.x, tile.y));
      }
    } else {
      this.restoreState(entry.before);
    }
    this.redoStack.push(entry);
    this.emit();
    this.requestRender();
  }

  redo() {
    if (this.stroke) this.cancelStroke();
    const entry = this.redoStack.pop();
    if (!entry) return;
    if (entry.kind === "pixels") {
      const layer = this.layers.find((item) => item.id === entry.layerId);
      const ctx = layer?.canvas ? ctx2d(layer.canvas) : null;
      if (ctx) {
        entry.after.forEach((tile) => ctx.putImageData(tile.data, tile.x, tile.y));
      }
    } else {
      this.restoreState(entry.after);
    }
    this.undoStack.push(entry);
    this.emit();
    this.requestRender();
  }

  private restoreState(state: StateSnapshot) {
    this.doc = { ...state.doc };
    this.layers = [...state.layers];
    this.activeLayerId = state.activeLayerId;
    this.strokeCanvas = null;
    this.strokeCtx = null;
    this.checkerPattern = null;
  }

  // ---------------------------------------------------------------- layers

  insertAboveActive(layer: Layer) {
    const index = this.layers.findIndex((item) => item.id === this.activeLayerId);
    const at = index < 0 ? this.layers.length : index + 1;
    this.layers = [
      ...this.layers.slice(0, at),
      layer,
      ...this.layers.slice(at),
    ];
  }

  addLayer() {
    const before = this.snapshotState();
    layerSerial += 1;
    const layer: Layer = {
      id: nextLayerId(),
      name: `Layer ${layerSerial}`,
      canvas: this.createCanvas(),
      visible: true,
      opacity: 1,
      blend: "source-over",
    };
    this.insertAboveActive(layer);
    this.activeLayerId = layer.id;
    this.pushState(before);
    this.emit();
    this.requestRender();
  }

  duplicateLayer() {
    const source = this.getActiveLayer();
    if (!source?.canvas) return;
    const before = this.snapshotState();
    const canvas = this.createCanvas();
    ctx2d(canvas)?.drawImage(source.canvas, 0, 0);
    layerSerial += 1;
    const copy: Layer = {
      ...source,
      id: nextLayerId(),
      name: `${source.name} copy`,
      canvas,
    };
    this.insertAboveActive(copy);
    this.activeLayerId = copy.id;
    this.pushState(before);
    this.emit();
    this.requestRender();
  }

  deleteLayer() {
    if (this.layers.length <= 1) return;
    const before = this.snapshotState();
    const index = this.layers.findIndex((layer) => layer.id === this.activeLayerId);
    if (index < 0) return;
    const remaining = this.layers.filter((layer) => layer.id !== this.activeLayerId);
    this.layers = remaining;
    const next = remaining[Math.min(index, remaining.length - 1)];
    this.activeLayerId = next.id;
    this.pushState(before);
    this.emit();
    this.requestRender();
  }

  clearLayer() {
    const layer = this.getActiveLayer();
    if (!layer) return;
    const before = this.snapshotState();
    this.layers = this.layers.map((item) =>
      item.id === layer.id ? { ...item, canvas: this.createCanvas() } : item,
    );
    this.pushState(before);
    this.emit();
    this.requestRender();
  }

  fillLayer() {
    const layer = this.getActiveLayer();
    if (!layer) return;
    const before = this.snapshotState();
    const canvas = this.createCanvas();
    const ctx = ctx2d(canvas);
    if (ctx) {
      ctx.fillStyle = this.color;
      ctx.fillRect(0, 0, this.doc.width, this.doc.height);
    }
    this.layers = this.layers.map((item) =>
      item.id === layer.id ? { ...item, canvas } : item,
    );
    this.pushState(before);
    this.emit();
    this.requestRender();
  }

  mergeDown() {
    const index = this.layers.findIndex((layer) => layer.id === this.activeLayerId);
    if (index <= 0) return;
    const top = this.layers[index];
    const below = this.layers[index - 1];
    if (!top.canvas || !below.canvas) return;
    const before = this.snapshotState();
    const canvas = this.createCanvas();
    const ctx = ctx2d(canvas);
    if (ctx) {
      ctx.globalAlpha = below.opacity;
      ctx.globalCompositeOperation = below.blend;
      ctx.drawImage(below.canvas, 0, 0);
      if (top.visible) {
        ctx.globalAlpha = top.opacity;
        ctx.globalCompositeOperation = top.blend;
        ctx.drawImage(top.canvas, 0, 0);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    const merged: Layer = {
      ...below,
      canvas,
      visible: true,
      opacity: 1,
      blend: "source-over",
      name: below.name,
    };
    this.layers = this.layers
      .map((layer, i) => (i === index - 1 ? merged : layer))
      .filter((_, i) => i !== index);
    this.activeLayerId = merged.id;
    this.pushState(before);
    this.emit();
    this.requestRender();
  }

  moveLayer(direction: -1 | 1) {
    const index = this.layers.findIndex((layer) => layer.id === this.activeLayerId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= this.layers.length) return;
    const before = this.snapshotState();
    const layers = [...this.layers];
    [layers[index], layers[target]] = [layers[target], layers[index]];
    this.layers = layers;
    this.pushState(before);
    this.emit();
    this.requestRender();
  }

  setActiveLayer(id: string) {
    if (this.activeLayerId === id) return;
    this.activeLayerId = id;
    this.emit();
  }

  setLayerProps(id: string, patch: LayerPatch, options?: { history?: boolean }) {
    const before = options?.history ? this.snapshotState() : null;
    this.layers = this.layers.map((layer) =>
      layer.id === id ? { ...layer, ...patch } : layer,
    );
    if (before) this.pushState(before);
    this.emit();
    this.requestRender();
  }

  // ---------------------------------------------------------------- document

  setBackground(color: string) {
    const next = normalizeHex(color);
    if (!next) return;
    this.doc = { ...this.doc, background: next, transparent: false };
    this.emit();
    this.requestRender();
  }

  setTransparent(transparent: boolean) {
    this.doc = { ...this.doc, transparent };
    this.emit();
    this.requestRender();
  }

  resizeDoc(
    width: number,
    height: number,
    options: { anchor: "center" | "start"; keepContent: boolean },
  ) {
    const nextWidth = clamp(Math.round(width), MIN_DOC_SIZE, MAX_DOC_SIZE);
    const nextHeight = clamp(Math.round(height), MIN_DOC_SIZE, MAX_DOC_SIZE);
    if (nextWidth * nextHeight > MAX_DOC_PIXELS) {
      throw new Error("The requested size exceeds the safe memory limit");
    }
    if (nextWidth === this.doc.width && nextHeight === this.doc.height) return false;

    const before = this.snapshotState();
    const dx = options.anchor === "center" ? Math.round((nextWidth - this.doc.width) / 2) : 0;
    const dy = options.anchor === "center" ? Math.round((nextHeight - this.doc.height) / 2) : 0;

    const layers = this.layers.map((layer) => {
      const canvas = createElementCanvas(nextWidth, nextHeight);
      if (options.keepContent && layer.canvas) {
        const ctx = ctx2d(canvas);
        if (ctx) ctx.drawImage(layer.canvas, dx, dy);
      }
      return { ...layer, canvas };
    });

    this.doc = { ...this.doc, width: nextWidth, height: nextHeight };
    this.layers = layers;
    this.strokeCanvas = null;
    this.strokeCtx = null;
    this.checkerPattern = null;
    this.pushState(before);
    this.fitToScreen();
    this.emit();
    return true;
  }

  async addImageFile(file: File) {
    if (!file.type.startsWith("image/")) {
      throw new Error("This file is not a supported image");
    }
    const bitmap = await createImageBitmap(file);
    try {
      const before = this.snapshotState();
      const canvas = this.createCanvas();
      const ctx = ctx2d(canvas);
      if (ctx) {
        const scale = Math.min(
          1,
          this.doc.width / bitmap.width,
          this.doc.height / bitmap.height,
        );
        const width = bitmap.width * scale;
        const height = bitmap.height * scale;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(
          bitmap,
          (this.doc.width - width) / 2,
          (this.doc.height - height) / 2,
          width,
          height,
        );
      }
      layerSerial += 1;
      const layer: Layer = {
        id: nextLayerId(),
        name: file.name.replace(/\.[^.]+$/, "").slice(0, 32) || `Image ${layerSerial}`,
        canvas,
        visible: true,
        opacity: 1,
        blend: "source-over",
      };
      this.insertAboveActive(layer);
      this.activeLayerId = layer.id;
      this.pushState(before);
      this.emit();
      this.requestRender();
    } finally {
      bitmap.close?.();
    }
  }

  // ---------------------------------------------------------------- project

  setProjectName(name: string) {
    const next = name.trim().replace(/\s+/g, " ").slice(0, 60) || "Untitled";
    if (next === this.projectName) return;
    this.projectName = next;
    this.emit();
  }

  markSaved() {
    this.dirtyArtwork = false;
    this.emit();
  }

  newProject() {
    this.cancelStroke();
    const doc: DocSettings = {
      width: 1920,
      height: 1080,
      background: "#0f0f0f",
      transparent: false,
    };
    const layer: Layer = {
      id: nextLayerId(),
      name: "Layer 1",
      canvas: this.createCanvas(doc.width, doc.height),
      visible: true,
      opacity: 1,
      blend: "source-over",
    };
    layerSerial = 1;
    this.pages = [this.makePage("Page 1", doc, [layer], layer.id)];
    this.activePageIndex = 0;
    this.projectName = "Untitled";
    this.resetStrokeState();
    this.pendingSnapshot = null;
    this.dirtyArtwork = false;
    this.fitToScreen();
    this.emit();
  }

  async serializeProject(): Promise<Blob> {
    const pages = this.pages.map((page) => {
      const activeIndex = Math.max(
        0,
        page.layers.findIndex((layer) => layer.id === page.activeLayerId),
      );
      const layers = page.layers.map((layer) => ({
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        blend: layer.blend,
        image: layer.canvas ? layer.canvas.toDataURL("image/png") : null,
      }));
      return {
        name: page.name,
        doc: { ...page.doc },
        activeIndex,
        layers,
      };
    });
    const payload = {
      app: PROJECT_APP_ID,
      version: PROJECT_VERSION,
      savedAt: new Date().toISOString(),
      name: this.projectName,
      activePage: this.activePageIndex,
      pages,
    };
    return new Blob([JSON.stringify(payload)], { type: "application/json" });
  }

  async loadProject(text: string) {
    const parsed = parseProjectFile(text);
    const built: Page[] = [];

    for (const pageData of parsed.pages) {
      const { width, height } = pageData.doc;
      const layers: Layer[] = [];
      for (const item of pageData.layers) {
        const canvas = createElementCanvas(width, height);
        if (item.image) {
          let bitmap: ImageBitmap | null = null;
          try {
            bitmap = (await readLayerImage(item.image)) as ImageBitmap;
          } catch {
            throw new Error("A layer image in this project could not be read");
          }
          const ctx = ctx2d(canvas);
          if (ctx) {
            ctx.imageSmoothingQuality = "high";
            const scale = Math.min(1, width / bitmap.width, height / bitmap.height);
            const drawWidth = bitmap.width * scale;
            const drawHeight = bitmap.height * scale;
            ctx.drawImage(
              bitmap,
              (width - drawWidth) / 2,
              (height - drawHeight) / 2,
              drawWidth,
              drawHeight,
            );
          }
          bitmap.close?.();
        }
        layers.push({
          id: nextLayerId(),
          name: item.name,
          canvas,
          visible: item.visible,
          opacity: item.opacity,
          blend: item.blend,
        });
      }
      const activeLayerId =
        layers[Math.min(pageData.activeIndex, layers.length - 1)]?.id ?? layers[0].id;
      built.push(this.makePage(pageData.name, { ...pageData.doc }, layers, activeLayerId));
    }

    if (built.length === 0) throw new Error("This project has no pages");

    this.cancelStroke();
    this.pages = built;
    this.activePageIndex = Math.min(
      Math.max(0, parsed.activePage),
      built.length - 1,
    );
    this.projectName = parsed.name;
    this.resetStrokeState();
    this.pendingSnapshot = null;
    this.dirtyArtwork = false;
    layerSerial = Math.max(1, built[0].layers.length);
    this.fitToScreen();
    this.emit();
  }

  // ---------------------------------------------------------------- pages

  private makePage(
    name: string,
    doc: DocSettings,
    layers: Layer[],
    activeLayerId: string,
  ): Page {
    return {
      id: nextPageId(),
      name,
      doc,
      layers,
      activeLayerId,
      undoStack: [],
      redoStack: [],
    };
  }

  private resetStrokeState() {
    this.stroke = null;
    this.strokeCanvas = null;
    this.strokeCtx = null;
    this.checkerPattern = null;
  }

  private afterPageChange() {
    this.resetStrokeState();
    this.pendingSnapshot = null;
  }

  get pageSummaries(): PageSummary[] {
    const active = this.activePageIndex;
    return this.pages.map((page, index) => ({
      id: page.id,
      name: page.name,
      width: page.doc.width,
      height: page.doc.height,
      layers: page.layers.length,
      active: index === active,
    }));
  }

  pageName(index: number) {
    return this.pages[index]?.name ?? "";
  }

  addPage(options?: {
    name?: string;
    width?: number;
    height?: number;
    background?: string;
  }) {
    if (this.pages.length >= MAX_PAGES) {
      throw new Error(`A project can hold at most ${MAX_PAGES} pages`);
    }
    this.cancelStroke();
    const source = this.currentPage;
    const width = Math.round(
      clamp(options?.width ?? source.doc.width, MIN_DOC_SIZE, MAX_DOC_SIZE),
    );
    const height = Math.round(
      clamp(options?.height ?? source.doc.height, MIN_DOC_SIZE, MAX_DOC_SIZE),
    );
    if (width * height > MAX_DOC_PIXELS) {
      throw new Error("The requested page size exceeds the safe memory limit");
    }
    const background =
      normalizeHex(options?.background ?? "") ?? source.doc.background;
    const doc: DocSettings = { width, height, background, transparent: false };
    const layer: Layer = {
      id: nextLayerId(),
      name: "Layer 1",
      canvas: createElementCanvas(width, height),
      visible: true,
      opacity: 1,
      blend: "source-over",
    };
    const page = this.makePage(
      options?.name?.trim().slice(0, 40) || `Page ${this.pages.length + 1}`,
      doc,
      [layer],
      layer.id,
    );
    this.pages = [...this.pages, page];
    this.activePageIndex = this.pages.length - 1;
    this.dirtyArtwork = true;
    this.afterPageChange();
    this.fitToScreen();
    this.emit();
    return this.activePageIndex;
  }

  duplicatePage(index = this.activePageIndex) {
    if (this.pages.length >= MAX_PAGES) {
      throw new Error(`A project can hold at most ${MAX_PAGES} pages`);
    }
    this.cancelStroke();
    const source = this.pages[index];
    if (!source) throw new Error("That page does not exist");
    const layerIndex = source.layers.findIndex(
      (layer) => layer.id === source.activeLayerId,
    );
    const layers = source.layers.map((layer) => {
      const canvas = createElementCanvas(source.doc.width, source.doc.height);
      if (layer.canvas) ctx2d(canvas)?.drawImage(layer.canvas, 0, 0);
      return { ...layer, id: nextLayerId(), canvas };
    });
    const page = this.makePage(
      `${source.name} copy`.slice(0, 40),
      { ...source.doc },
      layers,
      layers[Math.max(0, layerIndex)]?.id ?? layers[0].id,
    );
    this.pages = [
      ...this.pages.slice(0, index + 1),
      page,
      ...this.pages.slice(index + 1),
    ];
    this.activePageIndex = index + 1;
    this.dirtyArtwork = true;
    this.afterPageChange();
    this.fitToScreen();
    this.emit();
    return this.activePageIndex;
  }

  deletePage(index = this.activePageIndex) {
    if (this.pages.length <= 1) return false;
    const target = this.pages[index];
    if (!target) return false;
    this.cancelStroke();
    const previous = this.activePageIndex;
    this.pages = this.pages.filter((_, i) => i !== index);
    this.activePageIndex =
      index < previous
        ? previous - 1
        : index === previous
          ? Math.min(index, this.pages.length - 1)
          : previous;
    this.dirtyArtwork = true;
    this.afterPageChange();
    this.fitToScreen();
    this.emit();
    return true;
  }

  renamePage(index: number, name: string) {
    const page = this.pages[index];
    if (!page) return;
    const next = name.trim().replace(/\s+/g, " ").slice(0, 40) || page.name;
    if (next === page.name) return;
    page.name = next;
    this.dirtyArtwork = true;
    this.emit();
  }

  selectPage(index: number) {
    if (index < 0 || index >= this.pages.length) return;
    if (index === this.activePageIndex) return;
    this.cancelStroke();
    this.activePageIndex = index;
    this.afterPageChange();
    this.fitToScreen();
    this.emit();
  }

  pageThumbnail(index: number, maxWidth = 96) {
    const page = this.pages[index];
    if (!page) return null;
    const scale = Math.min(maxWidth / page.doc.width, 1);
    const width = Math.max(1, Math.round(page.doc.width * scale));
    const height = Math.max(1, Math.round(page.doc.height * scale));
    const canvas = createElementCanvas(width, height);
    const ctx = ctx2d(canvas);
    if (!ctx) return null;
    if (!page.doc.transparent) {
      ctx.fillStyle = page.doc.background;
      ctx.fillRect(0, 0, width, height);
    }
    for (const layer of page.layers) {
      if (!layer.visible || !layer.canvas) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      ctx.drawImage(layer.canvas, 0, 0, width, height);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    return canvas.toDataURL("image/png");
  }

  // ---------------------------------------------------------------- export

  exportDimensions(scale: number, pageIndex = this.activePageIndex) {
    const doc = this.pages[pageIndex]?.doc ?? this.doc;
    return {
      width: Math.max(1, Math.round(doc.width * scale)),
      height: Math.max(1, Math.round(doc.height * scale)),
    };
  }

  async exportImage(options: ExportOptions): Promise<ExportResult> {
    return this.exportPage(this.activePageIndex, options);
  }

  async exportPage(
    index: number,
    options: ExportOptions,
  ): Promise<ExportResult> {
    const page = this.pages[index];
    if (!page) throw new Error("That page does not exist");
    return this.renderPage(page, options);
  }

  async exportAllPages(
    options: ExportOptions,
  ): Promise<{ index: number; name: string; result: ExportResult }[]> {
    const pages: { index: number; name: string; result: ExportResult }[] = [];
    for (let index = 0; index < this.pages.length; index += 1) {
      const page = this.pages[index];
      pages.push({
        index,
        name: page.name,
        result: await this.renderPage(page, options),
      });
    }
    return pages;
  }

  private async renderPage(
    page: Page,
    options: ExportOptions,
  ): Promise<ExportResult> {
    const width = Math.max(1, Math.round(page.doc.width * options.scale));
    const height = Math.max(1, Math.round(page.doc.height * options.scale));
    if (Math.max(width, height) > 16000 || width * height > 120_000_000) {
      throw new Error("The export dimensions are too large");
    }

    const canvas = createElementCanvas(width, height);
    const ctx = ctx2d(canvas);
    if (!ctx) throw new Error("Could not initialize the export surface");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const isJpeg = options.format === "image/jpeg";
    if (options.includeBackground || isJpeg) {
      const background = page.doc.transparent
        ? isJpeg
          ? "#ffffff"
          : page.doc.background
        : page.doc.background;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }

    for (const layer of page.layers) {
      if (!layer.visible || !layer.canvas) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      ctx.drawImage(layer.canvas, 0, 0, width, height);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    const quality =
      options.format === "image/png" ? undefined : clamp(options.quality, 0.1, 1);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, options.format, quality);
    });
    if (!blob) throw new Error("Could not create the image file");
    return { blob, width, height };
  }

  // ---------------------------------------------------------------- prefs

  serializePrefs() {
    return {
      brush: this.brush,
      color: this.color,
      recentColors: this.recentColors,
      tool: this.tool,
      background: this.doc.background,
      transparent: this.doc.transparent,
      activePresetId: this.activePresetId,
    };
  }

  applyPrefs(raw: unknown) {
    if (!raw || typeof raw !== "object") return;
    const data = raw as Record<string, unknown>;
    if (data.brush && typeof data.brush === "object") {
      const incoming = data.brush as Partial<BrushSettings>;
      const brush: BrushSettings = {
        size: clamp(Number(incoming.size) || DEFAULT_BRUSH.size, 1, 400),
        opacity: clamp(Number(incoming.opacity) || 1, 0.01, 1),
        flow: clamp(Number(incoming.flow) || 0.6, 0.01, 1),
        hardness: clamp(Number(incoming.hardness) || 0.8, 0, 1),
        spacing: clamp(Number(incoming.spacing) || 0.1, 0.01, 1),
        smoothing: clamp(Number(incoming.smoothing) || 0, 0, 0.95),
        pressureSize: Boolean(incoming.pressureSize),
        pressureOpacity: Boolean(incoming.pressureOpacity),
        symmetry: ["none", "vertical", "horizontal", "quad"].includes(
          String(incoming.symmetry),
        )
          ? (incoming.symmetry as BrushSettings["symmetry"])
          : "none",
      };
      this.brush = brush;
    }
    if (typeof data.color === "string") {
      const color = normalizeHex(data.color);
      if (color) this.color = color;
    }
    if (Array.isArray(data.recentColors)) {
      this.recentColors = data.recentColors
        .map((item) => (typeof item === "string" ? normalizeHex(item) : null))
        .filter((item): item is string => Boolean(item))
        .slice(0, 12);
    }
    if (data.tool === "brush" || data.tool === "eraser" || data.tool === "eyedropper") {
      this.tool = data.tool;
    }
    if (typeof data.background === "string") {
      const background = normalizeHex(data.background);
      if (background) this.doc = { ...this.doc, background };
    }
    if (typeof data.transparent === "boolean") {
      this.doc = { ...this.doc, transparent: data.transparent };
    }
    if (typeof data.activePresetId === "string") {
      this.activePresetId = data.activePresetId;
    }
    this.emit();
  }
}
