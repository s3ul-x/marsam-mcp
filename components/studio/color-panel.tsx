"use client";

import * as React from "react";
import { Check, Pipette } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clamp,
  hexToHsv,
  hsvToRgb,
  normalizeHex,
  PAINTER_PALETTE,
  rgbToHex,
  type HSV,
} from "@/lib/paint/color";
import { cn } from "@/lib/utils";
import { useStudio, useStudioVersion } from "./studio-context";
import { PanelSection } from "./panel-parts";

export function ColorPanel() {
  const { studio } = useStudio();
  useStudioVersion();
  const color = studio.color;

  const [hsv, setHsv] = React.useState<HSV>(() => hexToHsv(color));
  const [hexDraft, setHexDraft] = React.useState(color);
  const svRef = React.useRef<HTMLDivElement>(null);
  const hueRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef<"sv" | "hue" | null>(null);

  React.useEffect(() => {
    setHsv((previous) => {
      const rgb = hsvToRgb(previous.h, previous.s, previous.v);
      const current = rgbToHex(rgb.r, rgb.g, rgb.b);
      if (current.toLowerCase() === color.toLowerCase()) return previous;
      const next = hexToHsv(color);
      return { h: next.s < 0.005 ? previous.h : next.h, s: next.s, v: next.v };
    });
    setHexDraft(color);
  }, [color]);

  const commitHsv = React.useCallback(
    (next: HSV) => {
      setHsv(next);
      const rgb = hsvToRgb(next.h, next.s, next.v);
      studio.setColor(rgbToHex(rgb.r, rgb.g, rgb.b));
    },
    [studio],
  );

  const updateSv = (clientX: number, clientY: number) => {
    const element = svRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const s = clamp((clientX - rect.left) / rect.width, 0, 1);
    const v = 1 - clamp((clientY - rect.top) / rect.height, 0, 1);
    commitHsv({ ...hsv, s, v });
  };

  const updateHue = (clientX: number) => {
    const element = hueRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const h = clamp((clientX - rect.left) / rect.width, 0, 1) * 360;
    commitHsv({ ...hsv, h });
  };

  const commitHex = () => {
    const next = normalizeHex(hexDraft);
    if (next) {
      studio.setColor(next);
      studio.pushRecentColor(next);
    } else {
      setHexDraft(color);
    }
  };

  return (
    <div className="space-y-4">
      <div
        ref={svRef}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.v * 100)}
        tabIndex={0}
        className="relative h-40 w-full cursor-crosshair touch-none overflow-hidden rounded-md border border-border"
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          draggingRef.current = "sv";
          updateSv(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (draggingRef.current === "sv") updateSv(event.clientX, event.clientY);
        }}
        onPointerUp={() => {
          draggingRef.current = null;
          studio.pushRecentColor(color);
        }}
        onPointerCancel={() => {
          draggingRef.current = null;
        }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0))",
          }}
        />
        <span
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            backgroundColor: color,
          }}
        />
      </div>

      <div
        ref={hueRef}
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        tabIndex={0}
        className="relative h-3 w-full cursor-pointer touch-none rounded-full border border-border"
        style={{
          backgroundImage:
            "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          draggingRef.current = "hue";
          updateHue(event.clientX);
        }}
        onPointerMove={(event) => {
          if (draggingRef.current === "hue") updateHue(event.clientX);
        }}
        onPointerUp={() => {
          draggingRef.current = null;
          studio.pushRecentColor(color);
        }}
        onPointerCancel={() => {
          draggingRef.current = null;
        }}
      >
        <span
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
          style={{
            left: `${(hsv.h / 360) * 100}%`,
            backgroundColor: `hsl(${hsv.h} 100% 50%)`,
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        <span
          className="size-9 shrink-0 rounded-md border border-white/15"
          style={{ backgroundColor: color }}
        />
        <Input
          value={hexDraft}
          onChange={(event) => setHexDraft(event.target.value)}
          onBlur={commitHex}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitHex();
              event.currentTarget.blur();
            }
          }}
          dir="ltr"
          className="h-9 text-left font-mono text-[12px] uppercase tracking-wide"
          aria-label="Color value"
          spellCheck={false}
        />
        <Button
          variant={studio.tool === "eyedropper" ? "secondary" : "outline"}
          size="icon"
          onClick={() =>
            studio.setTool(studio.tool === "eyedropper" ? "brush" : "eyedropper")
          }
          aria-label="Color picker"
          title="Color picker (I)"
          className="shrink-0"
        >
          <Pipette className="size-4" />
        </Button>
      </div>

      <PanelSection title="Painter's palette">
        <div className="grid grid-cols-8 gap-1">
          {PAINTER_PALETTE.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={swatch}
              title={swatch}
              onClick={() => {
                studio.setColor(swatch);
                studio.pushRecentColor(swatch);
              }}
              className={cn(
                "relative flex aspect-square items-center justify-center rounded-[4px] border border-white/10 transition-transform hover:scale-110",
                color.toLowerCase() === swatch.toLowerCase() &&
                  "ring-1 ring-primary ring-offset-1 ring-offset-panel",
              )}
              style={{ backgroundColor: swatch }}
            >
              {color.toLowerCase() === swatch.toLowerCase() ? (
                <Check
                  className={cn(
                    "size-3",
                    swatch === "#ffffff" || swatch === "#f6f3ec"
                      ? "text-black/70"
                      : "text-white/80",
                  )}
                />
              ) : null}
            </button>
          ))}
        </div>
      </PanelSection>

      {studio.recentColors.length > 0 ? (
        <PanelSection title="Recent colors">
          <div className="flex flex-wrap gap-1">
            {studio.recentColors.map((swatch, index) => (
              <button
                key={`${swatch}-${index}`}
                type="button"
                aria-label={swatch}
                title={swatch}
                onClick={() => studio.setColor(swatch)}
                className="size-6 rounded-[5px] border border-white/10 transition-transform hover:scale-110"
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>
        </PanelSection>
      ) : null}

      <PanelSection title="Apply color">
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="text-[11px]"
            onClick={() => {
              studio.setBackground(color);
              studio.pushRecentColor(color);
            }}
          >
            Canvas color
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-[11px]"
            onClick={() => {
              studio.fillLayer();
              studio.pushRecentColor(color);
            }}
          >
            Fill layer
          </Button>
        </div>
      </PanelSection>
    </div>
  );
}
