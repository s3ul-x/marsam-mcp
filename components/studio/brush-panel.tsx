"use client";

import * as React from "react";

import { clamp } from "@/lib/paint/color";
import {
  BRUSH_PRESETS,
  stampCache,
  type BrushSettings,
  type Symmetry,
} from "@/lib/paint/brush";
import { cn } from "@/lib/utils";
import { useStudio, useStudioVersion } from "./studio-context";
import { PanelSection, SliderRow } from "./panel-parts";
import { Switch } from "@/components/ui/switch";

const SYMMETRY_OPTIONS: { value: Symmetry; label: string }[] = [
  { value: "none", label: "None" },
  { value: "vertical", label: "Vertical" },
  { value: "horizontal", label: "Horizontal" },
  { value: "quad", label: "Quad" },
];

function paintPreview(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  brush: BrushSettings,
  color: string,
) {
  const padding = Math.min(18, width * 0.08);
  const startX = padding;
  const endX = Math.max(startX + 1, width - padding);
  const midY = height / 2;
  const amplitude = height * 0.17;
  const baseSize = clamp(brush.size * 0.55, 2, height * 0.55);
  const spacingBase = Math.max(0.55, brush.spacing * baseSize);
  let residual = spacingBase;
  let lastX = startX;
  let lastY = midY;
  const steps = Math.max(140, Math.round(width * 1.6));

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = startX + (endX - startX) * t;
    const y = midY + Math.sin(t * Math.PI * 1.7) * amplitude * 0.9;
    const segmentLength = Math.hypot(x - lastX, y - lastY);
    const pressure = 0.18 + 0.82 * Math.pow(Math.sin(Math.PI * t), 0.65);

    let travelled = 0;
    while (residual + travelled <= segmentLength) {
      const step = residual;
      residual = spacingBase;
      travelled += step;
      if (step > 0.001) {
        const ratio = travelled / Math.max(segmentLength, 0.001);
        const px = lastX + (x - lastX) * ratio;
        const py = lastY + (y - lastY) * ratio;
        const size = brush.pressureSize
          ? Math.max(1.5, baseSize * (0.2 + 0.8 * pressure))
          : baseSize;
        const stamp = stampCache.get(size, brush.hardness, color);
        ctx.globalAlpha = clamp(
          brush.flow * (brush.pressureOpacity ? Math.max(0.05, pressure) : 1),
          0.01,
          1,
        );
        ctx.drawImage(
          stamp,
          px - stamp.width / 2,
          py - stamp.height / 2,
        );
      }
    }
    residual -= segmentLength - travelled;
    if (residual < 0) residual = 0;
    lastX = x;
    lastY = y;
  }
  ctx.globalAlpha = 1;
}

function BrushPreview() {
  const { studio } = useStudio();
  useStudioVersion();
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      paintPreview(ctx, width, height, studio.brush, studio.color);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [studio, studio.brush, studio.color]);

  return (
    <div className="checkerboard relative h-[92px] w-full overflow-hidden rounded-md border border-border">
      <canvas ref={ref} className="absolute inset-0 size-full" />
      <span className="absolute bottom-1.5 start-2 text-[9px] text-white/35">
        Brush preview
      </span>
    </div>
  );
}

export function BrushPanel() {
  const { studio } = useStudio();
  useStudioVersion();
  const brush = studio.brush;

  return (
    <div className="space-y-4">
      <BrushPreview />

      <PanelSection title="Brush presets">
        <div className="grid grid-cols-5 gap-1">
          {BRUSH_PRESETS.map((preset) => {
            const active = studio.activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                title={preset.hint}
                onClick={() => studio.applyBrushPreset(preset)}
                className={cn(
                  "rounded-sm border px-1 py-1.5 text-[10.5px] transition-colors",
                  active
                    ? "border-primary/45 bg-primary/10 text-primary"
                    : "border-border bg-background/40 text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground",
                )}
              >
                {preset.name}
              </button>
            );
          })}
        </div>
      </PanelSection>

      <PanelSection title="Brush settings">
        <div className="space-y-2.5">
          <SliderRow
            label="Size"
            value={brush.size}
            min={1}
            max={400}
            step={1}
            display={`${Math.round(brush.size)} px`}
            onChange={(value) => studio.setBrush({ size: value })}
          />
          <SliderRow
            label="Opacity"
            value={brush.opacity}
            min={0.01}
            max={1}
            step={0.01}
            display={`${Math.round(brush.opacity * 100)}%`}
            onChange={(value) => studio.setBrush({ opacity: value })}
          />
          <SliderRow
            label="Flow"
            value={brush.flow}
            min={0.01}
            max={1}
            step={0.01}
            display={`${Math.round(brush.flow * 100)}%`}
            onChange={(value) => studio.setBrush({ flow: value })}
          />
          <SliderRow
            label="Hardness"
            value={brush.hardness}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(brush.hardness * 100)}%`}
            onChange={(value) => studio.setBrush({ hardness: value })}
          />
          <SliderRow
            label="Spacing"
            value={brush.spacing}
            min={0.02}
            max={0.6}
            step={0.01}
            display={`${Math.round(brush.spacing * 100)}%`}
            onChange={(value) => studio.setBrush({ spacing: value })}
          />
          <SliderRow
            label="Smoothing"
            value={brush.smoothing}
            min={0}
            max={0.95}
            step={0.01}
            display={`${Math.round(brush.smoothing * 100)}%`}
            onChange={(value) => studio.setBrush({ smoothing: value })}
          />
        </div>
      </PanelSection>

      <PanelSection title="Pen pressure">
        <div className="rounded-md border border-border">
          <label className="flex cursor-pointer items-center justify-between gap-3 border-b border-border px-2.5 py-2">
            <span className="text-[11.5px] text-foreground/80">
              Pressure controls size
            </span>
            <Switch
              checked={brush.pressureSize}
              onCheckedChange={(checked) =>
                studio.setBrush({ pressureSize: checked })
              }
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3 px-2.5 py-2">
            <span className="text-[11.5px] text-foreground/80">
              Pressure controls opacity
            </span>
            <Switch
              checked={brush.pressureOpacity}
              onCheckedChange={(checked) =>
                studio.setBrush({ pressureOpacity: checked })
              }
            />
          </label>
        </div>
      </PanelSection>

      <PanelSection title="Symmetry">
        <div className="grid grid-cols-4 gap-1 rounded-md bg-muted p-1">
          {SYMMETRY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => studio.setBrush({ symmetry: option.value })}
              className={cn(
                "rounded-[5px] py-1 text-[10.5px] transition-colors",
                brush.symmetry === option.value
                  ? "bg-raised text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </PanelSection>
    </div>
  );
}
