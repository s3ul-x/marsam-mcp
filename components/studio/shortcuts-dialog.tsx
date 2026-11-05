"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Tools",
    rows: [
      ["B", "Brush"],
      ["E", "Eraser"],
      ["I", "Eyedropper"],
      ["H", "Pan the canvas"],
      ["Space + drag", "Temporary pan"],
      ["Alt + click", "Pick a color from the canvas"],
    ],
  },
  {
    title: "Brush",
    rows: [
      ["[", "Smaller brush"],
      ["]", "Larger brush"],
      ["Pen pressure", "Controls size or opacity, depending on settings"],
    ],
  },
  {
    title: "View and file",
    rows: [
      ["Mouse wheel", "Zoom at the cursor"],
      ["Space + drag", "Pan the canvas"],
      ["Two fingers", "Pinch to zoom, drag to pan, twist to rotate"],
      ["Ctrl + 0", "Fit to screen"],
      ["Ctrl + 1", "Zoom to 100%"],
      ["Ctrl + S", "Open the export dialog"],
      ["Double-click", "Fit to screen"],
    ],
  },
  {
    title: "Project",
    rows: [
      ["Ctrl + Alt + N", "New project"],
      ["Ctrl + O", "Open a project file"],
      ["Ctrl + Shift + S", "Save the project"],
    ],
  },
  {
    title: "History",
    rows: [
      ["Ctrl + Z", "Undo"],
      ["Ctrl + Shift + Z", "Redo"],
      ["Ctrl + Y", "Redo"],
      ["Esc", "Cancel the current stroke"],
    ],
  },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[460px] overflow-y-auto scroll-thin">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts that work right on the canvas, with full pen and pressure
            support. Letter and digit shortcuts follow the physical key position,
            so they keep working on Arabic, Cyrillic and other layouts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {GROUPS.map((group) => (
            <div key={group.title} className="space-y-1.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {group.title}
              </h3>
              <div className="divide-y divide-border rounded-md border border-border">
                {group.rows.map(([keys, description]) => (
                  <div
                    key={keys}
                    className="flex items-center justify-between gap-3 px-2.5 py-1.5"
                  >
                    <span className="text-[11.5px] text-foreground/80">
                      {description}
                    </span>
                    <kbd className="shrink-0 rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground/80">
                      {keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
