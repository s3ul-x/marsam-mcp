"use client";

import {
  Brush,
  Eraser,
  Hand,
  Pipette,
  type LucideIcon,
} from "lucide-react";

import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ToolId } from "@/lib/paint/studio";
import { cn } from "@/lib/utils";
import { useStudio, useStudioVersion, type PanelTab } from "./studio-context";

const TOOLS: {
  id: ToolId;
  label: string;
  shortcut: string;
  icon: LucideIcon;
}[] = [
  { id: "brush", label: "Brush", shortcut: "B", icon: Brush },
  { id: "eraser", label: "Eraser", shortcut: "E", icon: Eraser },
  { id: "eyedropper", label: "Eyedropper", shortcut: "I", icon: Pipette },
  { id: "pan", label: "Pan", shortcut: "H", icon: Hand },
];

export function ToolRail({ onOpenTab }: { onOpenTab: (tab: PanelTab) => void }) {
  const { studio } = useStudio();
  useStudioVersion();

  return (
    <nav
      aria-label="Tools"
      className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-e border-border bg-panel py-2"
    >
      {TOOLS.map((tool) => {
        const Icon = tool.icon;
        const active = studio.tool === tool.id;
        return (
          <Tooltip key={tool.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => studio.setTool(tool.id)}
                aria-label={tool.label}
                aria-pressed={active}
                className={cn(
                  "relative flex size-9 items-center justify-center rounded-md transition-colors",
                  active
                    ? "bg-secondary text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-[18px]" strokeWidth={1.75} />
                {active ? (
                  <span className="absolute -end-[9px] top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-primary" />
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {tool.label}
              <span className="ms-1.5 text-muted-foreground">({tool.shortcut})</span>
            </TooltipContent>
          </Tooltip>
        );
      })}

      <Separator className="my-1 w-6" />

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onOpenTab("color")}
            aria-label="Current color"
            className="relative flex size-9 items-center justify-center rounded-md border border-border/80 bg-background/40 transition-colors hover:border-primary/40"
          >
            <span
              className="size-5 rounded-full border border-white/20 shadow-inner"
              style={{ backgroundColor: studio.color }}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Color · {studio.color}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onOpenTab("brush")}
            aria-label="Brush size"
            className="flex h-8 w-9 flex-col items-center justify-center rounded-md text-[10px] tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <span className="font-semibold text-foreground/85">
              {Math.round(studio.brush.size)}
            </span>
            <span className="text-[8.5px] leading-none">px</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Brush size · [ ]</TooltipContent>
      </Tooltip>
    </nav>
  );
}
