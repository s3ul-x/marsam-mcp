"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  Combine,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  ImagePlus,
  PaintBucket,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { normalizeHex } from "@/lib/paint/color";
import { BLEND_MODES, type BlendMode, type DocSettings, type Layer } from "@/lib/paint/studio";
import { cn } from "@/lib/utils";
import { useStudio, useStudioVersion } from "./studio-context";
import { IconAction, PanelSection, SliderRow } from "./panel-parts";

const BLEND_LABEL = new Map(
  BLEND_MODES.map((mode) => [mode.value, mode.label]),
);

function layersCountLabel(count: number) {
  return count === 1 ? "1 layer" : `${count} layers`;
}

function LayerThumb({ layer, doc }: { layer: Layer; doc: DocSettings }) {
  const version = useStudioVersion();
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const width = 42;
    const height = 32;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (layer.canvas) {
      const scale = Math.min(width / doc.width, height / doc.height);
      const drawWidth = doc.width * scale;
      const drawHeight = doc.height * scale;
      ctx.imageSmoothingQuality = "medium";
      ctx.drawImage(
        layer.canvas,
        (width - drawWidth) / 2,
        (height - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
    }
  }, [layer, doc.width, doc.height, version]);

  return (
    <div className="checkerboard flex size-[42px] shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-border">
      <canvas ref={ref} className="size-[42px]" />
    </div>
  );
}

function LayerRow({
  layer,
  doc,
  active,
  onSelect,
  onRename,
}: {
  layer: Layer;
  doc: DocSettings;
  active: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
}) {
  const { studio } = useStudio();
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState(layer.name);

  React.useEffect(() => {
    if (!renaming) setDraft(layer.name);
  }, [layer.name, renaming]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md border px-1.5 py-1.5 text-start transition-colors",
        active
          ? "border-primary/40 bg-primary/[0.06]"
          : "border-transparent hover:bg-accent/60",
      )}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          studio.setLayerProps(layer.id, { visible: !layer.visible }, { history: true });
        }}
        aria-label={layer.visible ? "Hide layer" : "Show layer"}
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-secondary",
          layer.visible ? "text-foreground/70" : "text-muted-foreground/40",
        )}
      >
        {layer.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
      </button>

      <LayerThumb layer={layer} doc={doc} />

      <div className="min-w-0 flex-1">
        {renaming ? (
          <Input
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={() => {
              setRenaming(false);
              onRename(draft.trim() || layer.name);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                setDraft(layer.name);
                setRenaming(false);
              }
            }}
            className="h-6 px-1 text-[11px]"
          />
        ) : (
          <div
            className="truncate text-[11.5px] text-foreground/85"
            onDoubleClick={(event) => {
              event.stopPropagation();
              setRenaming(true);
            }}
            title="Double-click to rename"
          >
            {layer.name}
          </div>
        )}
        <div className="mt-0.5 truncate text-[9.5px] text-muted-foreground">
          {BLEND_LABEL.get(layer.blend) ?? "Normal"}{" "}
          · {Math.round(layer.opacity * 100)}%
        </div>
      </div>
    </div>
  );
}

export function LayersPanel({ onOpenCanvas }: { onOpenCanvas: () => void }) {
  const { studio, notify } = useStudio();
  useStudioVersion();

  const layers = studio.layers;
  const activeLayer = studio.getActiveLayer();
  const activeIndex = layers.findIndex((layer) => layer.id === studio.activeLayerId);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [hexDraft, setHexDraft] = React.useState(studio.doc.background);

  React.useEffect(() => {
    setHexDraft(studio.doc.background);
  }, [studio.doc.background]);

  const commitHex = () => {
    const next = normalizeHex(hexDraft);
    if (next) studio.setBackground(next);
    else setHexDraft(studio.doc.background);
  };

  return (
    <div className="space-y-4">
      <PanelSection>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {layersCountLabel(layers.length)}
          </span>
          <div className="flex items-center gap-0.5">
            <IconAction icon={Plus} label="New layer" onClick={() => studio.addLayer()} />
            <IconAction
              icon={Copy}
              label="Duplicate layer"
              onClick={() => studio.duplicateLayer()}
            />
            <IconAction
              icon={Combine}
              label="Merge down"
              onClick={() => studio.mergeDown()}
              disabled={activeIndex === 0}
            />
            <IconAction
              icon={ChevronUp}
              label="Move layer up"
              onClick={() => studio.moveLayer(1)}
              disabled={activeIndex >= layers.length - 1}
            />
            <IconAction
              icon={ChevronDown}
              label="Move layer down"
              onClick={() => studio.moveLayer(-1)}
              disabled={activeIndex <= 0}
            />
            <IconAction
              icon={Trash2}
              label="Delete layer"
              onClick={() => studio.deleteLayer()}
              disabled={layers.length <= 1}
            />
          </div>
        </div>

        <div className="scroll-thin max-h-[252px] space-y-1 overflow-y-auto pe-0.5">
          {[...layers].reverse().map((layer) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              doc={studio.doc}
              active={layer.id === studio.activeLayerId}
              onSelect={() => studio.setActiveLayer(layer.id)}
              onRename={(name) =>
                studio.setLayerProps(layer.id, { name }, { history: true })
              }
            />
          ))}
        </div>
      </PanelSection>

      {activeLayer ? (
        <PanelSection title="Layer properties">
          <div className="space-y-2.5 rounded-md border border-border p-2.5">
            <div className="grid grid-cols-[1fr_auto] items-center gap-2">
              <Select
                dir="ltr"
                value={activeLayer.blend}
                onValueChange={(value) =>
                  studio.setLayerProps(
                    activeLayer.id,
                    { blend: value as BlendMode },
                    { history: true },
                  )
                }
              >
                <SelectTrigger aria-label="Blend mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BLEND_MODES.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-0.5">
                <IconAction
                  icon={PaintBucket}
                  label="Fill layer"
                  onClick={() => studio.fillLayer()}
                />
                <IconAction
                  icon={Eraser}
                  label="Clear layer"
                  onClick={() => studio.clearLayer()}
                />
              </div>
            </div>

            <SliderRow
              label="Opacity"
              value={Math.round(activeLayer.opacity * 100)}
              min={0}
              max={100}
              step={1}
              display={`${Math.round(activeLayer.opacity * 100)}%`}
              onChange={(value) => {
                studio.beginEdit();
                studio.setLayerProps(activeLayer.id, { opacity: value / 100 });
              }}
              onCommit={() => studio.commitEdit()}
            />
          </div>
        </PanelSection>
      ) : null}

      <PanelSection title="Canvas">
        <div className="space-y-2 rounded-md border border-border p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-foreground/80">Canvas background</span>
            <span className="font-mono text-[10px] uppercase text-muted-foreground" dir="ltr">
              {studio.doc.transparent ? "transparent" : studio.doc.background}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={studio.doc.background}
              onChange={(event) => studio.setBackground(event.target.value)}
              aria-label="Canvas background color"
              className="h-8 w-9 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
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
              aria-label="Background color hex"
              spellCheck={false}
              dir="ltr"
            />
          </div>
          <label className="flex cursor-pointer items-center justify-between border-t border-border pt-2">
            <span className="text-[11px] text-foreground/80">
              Transparent background (PNG export)
            </span>
            <Switch
              checked={studio.doc.transparent}
              onCheckedChange={(checked) => studio.setTransparent(checked)}
            />
          </label>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-2">
          <div>
            <div className="text-[11px] text-foreground/80">Canvas size</div>
            <div className="text-[10px] tabular-nums text-muted-foreground">
              {studio.doc.width} × {studio.doc.height} px
            </div>
          </div>
          <Button variant="outline" size="xs" onClick={onOpenCanvas}>
            Change
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5 text-[11px]"
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus className="size-3.5" />
          Insert image as layer
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
              await studio.addImageFile(file);
              notify("Image added as a new layer");
            } catch (error) {
              notify(
                error instanceof Error ? error.message : "Could not insert the image",
                "error",
              );
            } finally {
              event.target.value = "";
            }
          }}
        />
      </PanelSection>
    </div>
  );
}
