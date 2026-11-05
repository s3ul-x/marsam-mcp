"use client";

import * as React from "react";
import { AlertCircle, Check } from "lucide-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { matchKey } from "@/lib/keyboard";
import { clamp } from "@/lib/paint/color";
import { Studio } from "@/lib/paint/studio";
import { cn } from "@/lib/utils";
import { CanvasDialog } from "./canvas-dialog";
import { ExportDialog } from "./export-dialog";
import { PagesBar } from "./pages-bar";
import { RightPanel } from "./right-panel";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { Stage } from "./stage";
import { StatusBar } from "./status-bar";
import { StudioProvider, type PanelTab } from "./studio-context";
import { ToolRail } from "./tool-rail";
import { TopBar } from "./top-bar";

const PREFS_KEY = "marsam.prefs.v1";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

export function StudioShell() {
  const [studio] = React.useState(() => new Studio());
  const [tab, setTab] = React.useState<PanelTab>("brush");
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [canvasOpen, setCanvasOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{
    id: number;
    message: string;
    tone: "default" | "error";
  } | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = React.useCallback(
    (message: string, tone: "default" | "error" = "default") => {
      setToast({ id: Date.now(), message, tone });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 3600);
    },
    [],
  );

  const openPanel = React.useCallback((nextTab?: PanelTab) => {
    if (nextTab) setTab(nextTab);
    setPanelOpen(true);
  }, []);

  const contextValue = React.useMemo(
    () => ({ studio, notify, openPanel }),
    [studio, notify, openPanel],
  );

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (raw) studio.applyPrefs(JSON.parse(raw));
    } catch {
      // ignore corrupt preferences
    }
  }, [studio]);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = studio.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          window.localStorage.setItem(
            PREFS_KEY,
            JSON.stringify(studio.serializePrefs()),
          );
        } catch {
          // storage may be unavailable
        }
      }, 500);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [studio]);

  React.useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!studio.dirtyArtwork) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [studio]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;

      if (event.key === "Escape") {
        studio.cancelStroke();
        if (!document.querySelector('[role="dialog"][data-state="open"]')) {
          setPanelOpen(false);
        }
        return;
      }

      if (mod && !event.shiftKey && matchKey(event, ["s"])) {
        event.preventDefault();
        setExportOpen(true);
        return;
      }

      if (isTypingTarget(event.target)) return;

      if (mod && matchKey(event, ["z"])) {
        event.preventDefault();
        if (event.shiftKey) studio.redo();
        else studio.undo();
        return;
      }
      if (mod && matchKey(event, ["y"])) {
        event.preventDefault();
        studio.redo();
        return;
      }
      if (mod && matchKey(event, ["0"])) {
        event.preventDefault();
        studio.fitToScreen();
        return;
      }
      if (mod && matchKey(event, ["1"])) {
        event.preventDefault();
        studio.actualSize();
        return;
      }
      if (mod || event.altKey) return;

      if (matchKey(event, ["["])) {
        event.preventDefault();
        studio.setBrush({
          size: clamp(studio.brush.size - (studio.brush.size < 20 ? 1 : 4), 1, 400),
        });
        return;
      }
      if (matchKey(event, ["]"])) {
        event.preventDefault();
        studio.setBrush({
          size: clamp(studio.brush.size + (studio.brush.size < 20 ? 1 : 4), 1, 400),
        });
        return;
      }

      if (matchKey(event, ["b"])) {
        studio.setTool("brush");
      } else if (matchKey(event, ["e"])) {
        studio.setTool("eraser");
      } else if (matchKey(event, ["i"])) {
        studio.setTool("eyedropper");
      } else if (matchKey(event, ["h"])) {
        studio.setTool("pan");
      } else if (event.shiftKey ? matchKey(event, ["?", "/"]) : matchKey(event, ["?"])) {
        setShortcutsOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [studio]);

  return (
    <StudioProvider value={contextValue}>
      <TooltipProvider delayDuration={350}>
        <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
          <TopBar
            onExport={() => setExportOpen(true)}
            onCanvasSettings={() => setCanvasOpen(true)}
            onShortcuts={() => setShortcutsOpen(true)}
            onTogglePanel={() => setPanelOpen((open) => !open)}
            panelOpen={panelOpen}
          />

          <div className="relative flex min-h-0 flex-1">
            <ToolRail onOpenTab={openPanel} />
            <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="relative min-h-0 min-w-0 flex-1">
                <Stage onOpenCanvasSettings={() => setCanvasOpen(true)} />
              </div>
              <PagesBar />
            </main>
            <RightPanel
              tab={tab}
              onTabChange={setTab}
              mobileOpen={panelOpen}
              onClose={() => setPanelOpen(false)}
              onOpenCanvas={() => setCanvasOpen(true)}
            />
            {panelOpen ? (
              <button
                type="button"
                aria-label="Close the side panel"
                className="fixed inset-0 z-30 bg-black/55 lg:hidden"
                onClick={() => setPanelOpen(false)}
              />
            ) : null}
          </div>

          <StatusBar />

          <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
          <CanvasDialog open={canvasOpen} onOpenChange={setCanvasOpen} />
          <ShortcutsDialog
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
          />
        </div>

        {toast ? (
          <div
            key={toast.id}
            className="pointer-events-none fixed bottom-24 left-1/2 z-[80] -translate-x-1/2 animate-toast-in"
            role="status"
          >
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] shadow-xl",
                toast.tone === "error"
                  ? "border-destructive/40 bg-[#2a1414] text-[#ffd9d6]"
                  : "border-border bg-raised text-foreground",
              )}
            >
              {toast.tone === "error" ? (
                <AlertCircle className="size-3.5 text-destructive" />
              ) : (
                <Check className="size-3.5 text-primary" />
              )}
              <span>{toast.message}</span>
            </div>
          </div>
        ) : null}
      </TooltipProvider>
    </StudioProvider>
  );
}
