"use client";

import { Brush, Layers, Palette, X } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { BrushPanel } from "./brush-panel";
import { ColorPanel } from "./color-panel";
import { LayersPanel } from "./layers-panel";
import type { PanelTab } from "./studio-context";

export function RightPanel({
  tab,
  onTabChange,
  mobileOpen,
  onClose,
  onOpenCanvas,
}: {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  mobileOpen: boolean;
  onClose: () => void;
  onOpenCanvas: () => void;
}) {
  return (
    <aside
      aria-label="Tool panels"
      className={cn(
        "z-40 flex h-full w-[318px] shrink-0 flex-col border-s border-border bg-panel",
        "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:w-[88vw] max-lg:max-w-[334px] max-lg:shadow-2xl max-lg:transition-transform max-lg:duration-200 max-lg:ease-out",
        mobileOpen ? "max-lg:translate-x-0" : "max-lg:-translate-x-full",
      )}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as PanelTab)}
        dir="ltr"
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex items-center gap-1 border-b border-border px-2 py-2">
          <TabsList className="flex-1">
            <TabsTrigger value="brush">
              <Brush className="size-3.5" />
              Brush
            </TabsTrigger>
            <TabsTrigger value="color">
              <Palette className="size-3.5" />
              Color
            </TabsTrigger>
            <TabsTrigger value="layers">
              <Layers className="size-3.5" />
              Layers
            </TabsTrigger>
          </TabsList>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
          <TabsContent value="brush">
            <BrushPanel />
          </TabsContent>
          <TabsContent value="color">
            <ColorPanel />
          </TabsContent>
          <TabsContent value="layers">
            <LayersPanel onOpenCanvas={onOpenCanvas} />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}
