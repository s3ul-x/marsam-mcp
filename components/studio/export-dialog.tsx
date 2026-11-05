"use client";

import * as React from "react";
import { Download, Loader2 } from "lucide-react";

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
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { downloadBlob, safeFilename } from "@/lib/download";
import { clamp } from "@/lib/paint/color";
import type { ExportFormat } from "@/lib/paint/studio";
import { cn, formatBytes, formatNumber, timestampForFile } from "@/lib/utils";
import { useStudio } from "./studio-context";

const FORMATS: {
  id: ExportFormat;
  label: string;
  hint: string;
  extension: string;
}[] = [
  { id: "image/png", label: "PNG", hint: "Full transparency", extension: "png" },
  { id: "image/jpeg", label: "JPEG", hint: "Smaller file", extension: "jpg" },
  { id: "image/webp", label: "WebP", hint: "Quality and compression", extension: "webp" },
];

const SCALES = [0.5, 1, 2, 3, 4];

export function ExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { studio, notify } = useStudio();
  const [format, setFormat] = React.useState<ExportFormat>("image/png");
  const [scale, setScale] = React.useState(1);
  const [quality, setQuality] = React.useState(0.92);
  const [includeBackground, setIncludeBackground] = React.useState(true);
  const [filename, setFilename] = React.useState("marsam");
  const [scope, setScope] = React.useState<"page" | "all">("page");
  const [busy, setBusy] = React.useState(false);

  const extension = FORMATS.find((item) => item.id === format)?.extension ?? "png";
  const pageSizes =
    scope === "all"
      ? studio.pageSummaries.map((_, index) => studio.exportDimensions(scale, index))
      : [studio.exportDimensions(scale)];
  const dimensions = pageSizes[studio.activePageIndex] ?? pageSizes[0];
  const tooLarge = pageSizes.some(
    (size) =>
      size.width * size.height > 80_000_000 ||
      Math.max(size.width, size.height) > 16000,
  );
  const lossy = format === "image/jpeg" || format === "image/webp";

  React.useEffect(() => {
    if (open) {
      setBusy(false);
      setFilename(safeFilename(studio.projectName || "marsam"));
    }
  }, [open, studio]);

  const handleExport = async () => {
    if (tooLarge) {
      notify("The requested dimensions are too large. Pick a smaller scale.", "error");
      return;
    }
    setBusy(true);
    try {
      const options = {
        format,
        scale,
        quality,
        includeBackground: format === "image/jpeg" ? true : includeBackground,
      };
      const stamp = timestampForFile();
      if (scope === "all" && studio.pages.length > 1) {
        const results = await studio.exportAllPages(options);
        results.forEach((item) => {
          const label = safeFilename(item.name || `page-${item.index + 1}`);
          downloadBlob(
            item.result.blob,
            `${safeFilename(filename)}-${String(item.index + 1).padStart(2, "0")}-${label}-${stamp}.${extension}`,
          );
        });
        const total = results.reduce((sum, item) => sum + item.result.blob.size, 0);
        notify(
          `Exported ${results.length} pages · ${extension.toUpperCase()} · ${formatBytes(total)}`,
        );
      } else {
        const result = await studio.exportPage(studio.activePageIndex, options);
        downloadBlob(
          result.blob,
          `${safeFilename(filename)}-${timestampForFile()}.${extension}`,
        );
        notify(
          `Exported · ${extension.toUpperCase()} · ${formatNumber(result.width)}×${formatNumber(
            result.height,
          )} · ${formatBytes(result.blob.size)}`,
        );
      }
      onOpenChange(false);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not export the image",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[440px] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle>Export artwork</DialogTitle>
          <DialogDescription>
            Choose a format, resolution and quality. The file downloads right
            away.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>What to export</Label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setScope("page")}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-[11px] transition-colors",
                  scope === "page"
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                Current page
              </button>
              <button
                type="button"
                onClick={() => setScope("all")}
                disabled={studio.pages.length <= 1}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-40",
                  scope === "all"
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                All pages ({studio.pages.length})
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Format</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {FORMATS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFormat(item.id)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-md border py-2 transition-colors",
                    format === item.id
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border bg-background/40 text-foreground/80 hover:bg-accent",
                  )}
                >
                  <span className="text-[12px] font-semibold">{item.label}</span>
                  <span className="text-[9px] text-muted-foreground">
                    {item.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Resolution</Label>
            <div className="grid grid-cols-5 gap-1">
              {SCALES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScale(value)}
                  className={cn(
                    "rounded-sm border py-1.5 text-[11px] tabular-nums transition-colors",
                    Math.abs(scale - value) < 0.001
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {value}×
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="export-width">Width (px)</Label>
              <Input
                id="export-width"
                type="number"
                min={32}
                max={16000}
                value={dimensions.width}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next) || next <= 0) return;
                  setScale(clamp(next / studio.doc.width, 0.05, 8));
                }}
                className="tabular-nums"
              />
            </div>
            <span className="pb-2.5 text-[11px] text-muted-foreground">×</span>
            <div className="space-y-1">
              <Label htmlFor="export-height">Height (px)</Label>
              <Input
                id="export-height"
                readOnly
                value={dimensions.height}
                className="tabular-nums text-muted-foreground"
              />
            </div>
          </div>

          {lossy ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Quality</Label>
                <span className="text-[10.5px] tabular-nums text-muted-foreground">
                  {Math.round(quality * 100)}%
                </span>
              </div>
              <Slider
                value={[quality]}
                min={0.4}
                max={1}
                step={0.01}
                onValueChange={(values) => setQuality(values[0])}
              />
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                90% or higher suits finished artwork. Lower values shrink the file
                at the cost of detail.
              </p>
            </div>
          ) : null}

          <div className="space-y-2 rounded-md border border-border p-2.5">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="text-[11.5px] text-foreground/80">
                {format === "image/jpeg"
                  ? "Merge the background color (required for JPEG)"
                  : "Merge the background color into the image"}
              </span>
              <Switch
                checked={format === "image/jpeg" ? true : includeBackground}
                disabled={format === "image/jpeg"}
                onCheckedChange={setIncludeBackground}
              />
            </label>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {studio.doc.transparent
                ? "The canvas background is transparent right now. Leave this off to keep transparency in PNG and WebP."
                : "Turn this off to export a PNG with a transparent background instead of the canvas color."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="export-filename">File name</Label>
            <div className="flex items-center gap-2">
              <Input
                id="export-filename"
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
                onBlur={() =>
                  setFilename((value) => safeFilename(value))
                }
                spellCheck={false}
              />
              <span className="shrink-0 rounded-sm border border-border bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                .{extension}
              </span>
            </div>
          </div>

          <div
            className={cn(
              "flex items-center justify-between rounded-md bg-muted px-2.5 py-2 text-[10.5px]",
              tooLarge ? "text-destructive" : "text-muted-foreground",
            )}
          >
            <span>{scope === "all" ? "Per page" : "Final size"}</span>
            <span className="tabular-nums" dir="ltr">
              {formatNumber(dimensions.width)} × {formatNumber(dimensions.height)} px
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleExport}
            disabled={busy || tooLarge}
            className="gap-2"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {busy
              ? "Exporting…"
              : scope === "all" && studio.pages.length > 1
                ? `Download ${studio.pages.length} images`
                : "Download image"}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
