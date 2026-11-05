"use client";

import { useStudio, useStudioVersion } from "./studio-context";

const TOOL_LABEL: Record<string, string> = {
  brush: "Brush",
  eraser: "Eraser",
  eyedropper: "Eyedropper",
  pan: "Pan",
};

export function StatusBar() {
  const { studio } = useStudio();
  useStudioVersion();

  return (
    <footer className="flex h-7 shrink-0 items-center gap-2.5 overflow-hidden border-t border-border bg-panel px-3 text-[10.5px] text-muted-foreground">
      <span className="text-foreground/70">{TOOL_LABEL[studio.tool]}</span>
      <span className="h-2.5 w-px bg-border" />
      <span className="tabular-nums">{Math.round(studio.brush.size)} px</span>
      <span className="h-2.5 w-px bg-border" />
      <span className="tabular-nums">
        {Math.round(studio.view.scale * 100)}%
      </span>
      {Math.abs(studio.view.rotation) > 0.001 ? (
        <>
          <span className="h-2.5 w-px bg-border" />
          <span className="tabular-nums">
            {Math.round((studio.view.rotation * 180) / Math.PI)}°
          </span>
        </>
      ) : null}
      <span className="ms-auto flex items-center gap-1.5 tabular-nums" dir="ltr">
        Page {studio.activePageIndex + 1}/{studio.pages.length}
      </span>
      <span className="h-2.5 w-px bg-border" />
      <span className="flex items-center gap-1.5 tabular-nums" dir="ltr">
        {studio.doc.width} × {studio.doc.height}
      </span>
      <span className="h-2.5 w-px bg-border" />
      <span className="flex items-center gap-1">
        <span
          className="size-2.5 rounded-[3px] border border-white/15"
          style={{ backgroundColor: studio.doc.background }}
        />
        <span className="tabular-nums uppercase">
          {studio.doc.transparent ? "transparent" : studio.doc.background}
        </span>
      </span>
    </footer>
  );
}
