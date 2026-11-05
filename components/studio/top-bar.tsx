"use client";

import * as React from "react";
import {
  CircleHelp,
  Download,
  Frame,
  Redo2,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/utils";
import { ProjectMenu } from "./project-menu";
import { useStudio, useStudioVersion } from "./studio-context";

type TopBarProps = {
  onExport: () => void;
  onCanvasSettings: () => void;
  onShortcuts: () => void;
  onTogglePanel: () => void;
  panelOpen: boolean;
};

export function TopBar({
  onExport,
  onCanvasSettings,
  onShortcuts,
  onTogglePanel,
  panelOpen,
}: TopBarProps) {
  const { studio } = useStudio();
  useStudioVersion();

  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-panel px-2 sm:px-3">
      <div className="flex items-center gap-2 pe-1">
        <div className="flex size-7 items-center justify-center rounded-md border border-primary/25 bg-primary/10">
          <svg viewBox="0 0 24 24" className="size-4 text-primary" aria-hidden>
            <path
              d="M5 19.5c2.8.4 4.7-.9 5.7-2.7l7.2-9.4-3.2-2.6-7.6 7.2c-1.7 1.6-2.7 4.5-2.1 7.5Z"
              fill="currentColor"
            />
            <path
              d="M16.3 4.6 19 2.9c.7-.4 1.5-.2 1.9.5.4.7.2 1.4-.5 1.9l-2.8 1.9Z"
              fill="currentColor"
              opacity=".55"
            />
          </svg>
        </div>
        <div className="hidden flex-col leading-none sm:flex">
          <span className="text-[13px] font-semibold tracking-tight">Marsam</span>
          <span className="mt-0.5 flex items-center gap-1 text-[9.5px] text-muted-foreground">
            Painting studio
            <span className="rounded-sm border border-primary/30 bg-primary/10 px-1 py-px text-[8px] font-medium tracking-wider text-primary">
              MCP
            </span>
          </span>
        </div>
      </div>

      <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />

      <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <ProjectMenu />
        <span className="hidden size-[3px] rounded-full bg-border md:block" />
        <span className="hidden tabular-nums md:block" dir="ltr">
          {formatNumber(studio.doc.width)} × {formatNumber(studio.doc.height)}
        </span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => studio.undo()}
              disabled={!studio.canUndo}
              aria-label="Undo"
            >
              <Undo2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo · Ctrl+Z</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => studio.redo()}
              disabled={!studio.canRedo}
              aria-label="Redo"
            >
              <Redo2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo · Ctrl+Shift+Z</TooltipContent>
        </Tooltip>
      </div>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onCanvasSettings}
              aria-label="Canvas settings"
            >
              <Frame className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Canvas size and color</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onShortcuts}
              aria-label="Keyboard shortcuts"
              className="hidden sm:inline-flex"
            >
              <CircleHelp className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Keyboard shortcuts · ?</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={panelOpen ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={onTogglePanel}
              aria-label="Tool panels"
              className="lg:hidden"
            >
              <SlidersHorizontal className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Brush and layer panels</TooltipContent>
        </Tooltip>
      </div>

      <Button size="sm" onClick={onExport} className="ms-1 gap-1.5">
        <Download className="size-3.5" />
        Export
      </Button>
    </header>
  );
}
