"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { normalizeHex } from "@/lib/paint/color";
import {
  MAX_DOC_PIXELS,
  MAX_DOC_SIZE,
  MIN_DOC_SIZE,
} from "@/lib/paint/studio";
import { cn, formatNumber } from "@/lib/utils";
import { useStudio } from "./studio-context";

const PRESETS: { label: string; width: number; height: number }[] = [
  { label: "Widescreen", width: 1920, height: 1080 },
  { label: "Square", width: 2048, height: 2048 },
  { label: "Portrait", width: 1080, height: 1350 },
  { label: "A4 print", width: 2480, height: 3508 },
  { label: "Artwork", width: 3000, height: 2000 },
  { label: "Quick sketch", width: 1280, height: 960 },
];

export function CanvasDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { studio, notify } = useStudio();
  const [width, setWidth] = React.useState(studio.doc.width);
  const [height, setHeight] = React.useState(studio.doc.height);
  const [anchor, setAnchor] = React.useState<"center" | "start">("center");
  const [keepContent, setKeepContent] = React.useState(true);
  const [background, setBackground] = React.useState(studio.doc.background);
  const [transparent, setTransparent] = React.useState(studio.doc.transparent);
  const [hexDraft, setHexDraft] = React.useState(studio.doc.background);

  React.useEffect(() => {
    if (!open) return;
    setWidth(studio.doc.width);
    setHeight(studio.doc.height);
    setBackground(studio.doc.background);
    setTransparent(studio.doc.transparent);
    setHexDraft(studio.doc.background);
    setAnchor("center");
    setKeepContent(true);
  }, [open, studio]);

  const pixels = Math.max(0, width) * Math.max(0, height);
  const invalid =
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < MIN_DOC_SIZE ||
    height < MIN_DOC_SIZE ||
    width > MAX_DOC_SIZE ||
    height > MAX_DOC_SIZE ||
    pixels > MAX_DOC_PIXELS;

  const ratio = height > 0 ? width / height : 0;
  const ratioLabel =
    ratio > 0
      ? Math.abs(ratio - 1) < 0.01
        ? "1:1"
        : ratio > 1
          ? `${ratio.toFixed(2)}:1`
          : `1:${(1 / ratio).toFixed(2)}`
      : "—";

  const apply = () => {
    if (invalid) {
      notify("The size is invalid or exceeds the safe memory limit", "error");
      return;
    }
    try {
      // Apply the background first so the resize history entry captures the new
      // color in both its before/after snapshots. Otherwise undo would revert it
      // and a later redo of the resize would bring the old color back.
      studio.setBackground(background);
      studio.setTransparent(transparent);
      studio.resizeDoc(width, height, { anchor, keepContent });
      notify("Canvas settings updated");
      onOpenChange(false);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not change the canvas size",
        "error",
      );
    }
  };

  const commitHex = () => {
    const next = normalizeHex(hexDraft);
    if (next) {
      setBackground(next);
      setHexDraft(next);
    } else {
      setHexDraft(background);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[460px] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle>Canvas</DialogTitle>
          <DialogDescription>
            Change the size and background color of the current page. The
            default is a dark, easy-on-the-eyes{" "}
            <span className="font-mono text-foreground/70">#0f0f0f</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="canvas-width">Width</Label>
              <Input
                id="canvas-width"
                type="number"
                min={MIN_DOC_SIZE}
                max={MAX_DOC_SIZE}
                value={Number.isFinite(width) ? width : ""}
                onChange={(event) => setWidth(Number(event.target.value))}
                className="tabular-nums"
              />
            </div>
            <span className="pb-2.5 text-[11px] text-muted-foreground">×</span>
            <div className="space-y-1">
              <Label htmlFor="canvas-height">Height</Label>
              <Input
                id="canvas-height"
                type="number"
                min={MIN_DOC_SIZE}
                max={MAX_DOC_SIZE}
                value={Number.isFinite(height) ? height : ""}
                onChange={(event) => setHeight(Number(event.target.value))}
                className="tabular-nums"
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
            <span>Ratio {ratioLabel}</span>
            <span className={cn("tabular-nums", invalid && "text-destructive")}>
              {formatNumber(pixels)} px
            </span>
          </div>

          <div className="space-y-1.5">
            <Label>Presets</Label>
            <div className="grid grid-cols-3 gap-1">
              {PRESETS.map((preset) => {
                const active = width === preset.width && height === preset.height;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setWidth(preset.width);
                      setHeight(preset.height);
                    }}
                    className={cn(
                      "rounded-md border px-1.5 py-1.5 text-start transition-colors",
                      active
                        ? "border-primary/60 bg-primary/10"
                        : "border-border bg-background/40 hover:bg-accent",
                    )}
                  >
                    <div
                      className={cn(
                        "text-[10.5px] font-medium",
                        active ? "text-primary" : "text-foreground/80",
                      )}
                    >
                      {preset.label}
                    </div>
                    <div className="text-[9px] tabular-nums text-muted-foreground" dir="ltr">
                      {preset.width} × {preset.height}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>When resizing</Label>
              <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
                <button
                  type="button"
                  onClick={() => setAnchor("center")}
                  className={cn(
                    "rounded-[5px] py-1 text-[10.5px] transition-colors",
                    anchor === "center"
                      ? "bg-raised text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Center
                </button>
                <button
                  type="button"
                  onClick={() => setAnchor("start")}
                  className={cn(
                    "rounded-[5px] py-1 text-[10.5px] transition-colors",
                    anchor === "start"
                      ? "bg-raised text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Pin corner
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Content</Label>
              <label className="flex h-[34px] cursor-pointer items-center justify-between gap-2 rounded-md border border-border px-2">
                <span className="text-[10.5px] text-foreground/75">
                  Keep artwork
                </span>
                <Switch checked={keepContent} onCheckedChange={setKeepContent} />
              </label>
            </div>
          </div>

          <div className="space-y-2 rounded-md border border-border p-2.5">
            <div className="flex items-center justify-between">
              <Label>Canvas background</Label>
              <span className="font-mono text-[10px] uppercase text-muted-foreground" dir="ltr">
                {transparent ? "transparent" : background}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={background}
                onChange={(event) => {
                  setBackground(event.target.value);
                  setHexDraft(event.target.value);
                  setTransparent(false);
                }}
                aria-label="Canvas background color"
                className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
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
                className="h-8 font-mono text-[11px] uppercase"
                spellCheck={false}
                dir="ltr"
                aria-label="Background color value"
              />
              <div className="flex shrink-0 items-center gap-1.5">
                <Switch
                  checked={transparent}
                  onCheckedChange={setTransparent}
                  aria-label="Transparent background"
                />
                <span className="text-[10px] text-muted-foreground">Transparent</span>
              </div>
            </div>
            {keepContent ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Shrinking the canvas only crops what falls outside the new
                bounds; the artwork is not scaled.
              </p>
            ) : (
              <p className="text-[10px] leading-relaxed text-destructive/90">
                All layer content will be cleared when the canvas size changes.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={apply} disabled={invalid}>
            Apply
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
