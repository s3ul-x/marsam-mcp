/**
 * Brush primitives for the headless engine. This is the same stamp math the
 * browser app uses (`lib/paint/brush.ts`), re-implemented on top of
 * `@napi-rs/canvas` so strokes look identical outside the browser.
 */
import { createCanvas, type Canvas } from "@napi-rs/canvas";

import { hexToRgb } from "./color.js";

export type Symmetry = "none" | "vertical" | "horizontal" | "quad";

export type BrushSettings = {
  size: number;
  opacity: number;
  flow: number;
  hardness: number;
  spacing: number;
  smoothing: number;
  pressureSize: boolean;
  pressureOpacity: boolean;
  symmetry: Symmetry;
};

export type BrushPreset = {
  id: string;
  name: string;
  hint: string;
  settings: Omit<BrushSettings, "symmetry">;
};

export const DEFAULT_BRUSH: BrushSettings = {
  size: 22,
  opacity: 1,
  flow: 0.62,
  hardness: 0.82,
  spacing: 0.1,
  smoothing: 0.34,
  pressureSize: true,
  pressureOpacity: false,
  symmetry: "none",
};

export const BRUSH_PRESETS: BrushPreset[] = [
  {
    id: "pencil",
    name: "Pencil",
    hint: "Thin line, crisp texture",
    settings: {
      size: 6,
      opacity: 1,
      flow: 0.85,
      hardness: 0.92,
      spacing: 0.07,
      smoothing: 0.16,
      pressureSize: true,
      pressureOpacity: true,
    },
  },
  {
    id: "ink",
    name: "Ink",
    hint: "Clean line, full flow",
    settings: {
      size: 14,
      opacity: 1,
      flow: 1,
      hardness: 0.96,
      spacing: 0.05,
      smoothing: 0.46,
      pressureSize: true,
      pressureOpacity: false,
    },
  },
  {
    id: "marker",
    name: "Marker",
    hint: "Broad semi-transparent fill",
    settings: {
      size: 36,
      opacity: 0.72,
      flow: 0.5,
      hardness: 0.7,
      spacing: 0.05,
      smoothing: 0.24,
      pressureSize: false,
      pressureOpacity: false,
    },
  },
  {
    id: "airbrush",
    name: "Airbrush",
    hint: "Soft, gradual spray",
    settings: {
      size: 120,
      opacity: 0.9,
      flow: 0.08,
      hardness: 0.02,
      spacing: 0.03,
      smoothing: 0.5,
      pressureSize: true,
      pressureOpacity: true,
    },
  },
  {
    id: "charcoal",
    name: "Charcoal",
    hint: "Soft edge, dense pigment",
    settings: {
      size: 28,
      opacity: 0.9,
      flow: 0.34,
      hardness: 0.34,
      spacing: 0.1,
      smoothing: 0.2,
      pressureSize: true,
      pressureOpacity: true,
    },
  },
];

export function brushPreset(id: string): BrushPreset | undefined {
  return BRUSH_PRESETS.find((preset) => preset.id === id);
}

const SMOOTH_STOPS = 10;

function smoothFalloff(t: number) {
  return 1 - t * t * (3 - 2 * t);
}

/**
 * A cached round brush stamp. Stamps are rasterized once per (size, hardness,
 * color) combination and reused for every dab.
 */
class StampCache {
  private cache = new Map<string, Canvas>();
  private limit = 64;

  get(size: number, hardness: number, color: string): Canvas {
    const px = Math.max(1, Math.round(size * 2) / 2);
    const hard = Math.round(Math.min(1, Math.max(0, hardness)) * 100) / 100;
    const key = `${px}|${hard}|${color}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const stamp = this.create(px, hard, color);
    this.cache.set(key, stamp);
    if (this.cache.size > this.limit) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    return stamp;
  }

  private create(size: number, hardness: number, color: string) {
    const canvas = createCanvas(
      Math.ceil(size) + 4,
      Math.ceil(size) + 4,
    );
    const pad = 2;
    const side = Math.ceil(size) + pad * 2;
    const ctx = canvas.getContext("2d");

    const center = side / 2;
    const radius = size / 2;
    const rgb = hexToRgb(color) ?? { r: 255, g: 255, b: 255 };
    const rgbString = `${rgb.r}, ${rgb.g}, ${rgb.b}`;

    if (hardness >= 0.99) {
      ctx.fillStyle = `rgb(${rgbString})`;
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.fill();
      return canvas;
    }

    const inner = Math.max(0.01, Math.min(radius * 0.995, radius * hardness));
    const gradient = ctx.createRadialGradient(
      center,
      center,
      inner,
      center,
      center,
      Math.max(inner + 0.01, radius),
    );
    for (let i = 0; i <= SMOOTH_STOPS; i += 1) {
      const t = i / SMOOTH_STOPS;
      gradient.addColorStop(t, `rgba(${rgbString}, ${smoothFalloff(t)})`);
    }
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fill();
    return canvas;
  }
}

export const stampCache = new StampCache();

export function brushSizeLabel(size: number) {
  return `${Math.round(size)} px`;
}
