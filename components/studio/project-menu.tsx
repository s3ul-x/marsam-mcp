"use client";

import * as React from "react";
import {
  ChevronDown,
  FilePlus2,
  FolderOpen,
  Loader2,
  PencilLine,
  Save,
} from "lucide-react";

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
import { downloadBlob, safeFilename } from "@/lib/download";
import { matchKey } from "@/lib/keyboard";
import { PROJECT_EXTENSION } from "@/lib/paint/project";
import { cn, formatBytes } from "@/lib/utils";
import { useStudio, useStudioVersion } from "./studio-context";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

type MenuItemProps = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
};

function MenuItem({ icon: Icon, label, shortcut, onSelect, disabled }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[11.5px] text-foreground/85 transition-colors",
        "hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-45",
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">{label}</span>
      {shortcut ? (
        <kbd className="shrink-0 font-mono text-[9.5px] text-muted-foreground">
          {shortcut}
        </kbd>
      ) : null}
    </button>
  );
}

export function ProjectMenu() {
  const { studio, notify } = useStudio();
  useStudioVersion();

  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState<"new" | "open" | null>(null);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [draftName, setDraftName] = React.useState(studio.projectName);
  const [busy, setBusy] = React.useState(false);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const startNew = () => {
    studio.newProject();
    notify("New project started · 1920 × 1080");
  };

  const pickFile = () => {
    fileRef.current?.click();
  };

  const requestNew = () => {
    setOpen(false);
    if (studio.dirtyArtwork) setPending("new");
    else startNew();
  };

  const requestOpen = () => {
    setOpen(false);
    if (studio.dirtyArtwork) setPending("open");
    else pickFile();
  };

  const confirmDiscard = () => {
    const action = pending;
    setPending(null);
    if (action === "new") {
      startNew();
      return;
    }
    if (action === "open") {
      // Still inside the click gesture, so the file picker is allowed to open.
      pickFile();
    }
  };

  const saveProject = async () => {
    setOpen(false);
    if (busy) return;
    setBusy(true);
    try {
      const blob = await studio.serializeProject();
      downloadBlob(
        blob,
        `${safeFilename(studio.projectName || "project")}.${PROJECT_EXTENSION}`,
      );
      studio.markSaved();
      notify(
        `Project saved · ${studio.pages.length} ${
          studio.pages.length === 1 ? "page" : "pages"
        } · ${formatBytes(blob.size)}`,
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not save the project",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const openRename = () => {
    setOpen(false);
    setDraftName(studio.projectName);
    setRenameOpen(true);
  };

  const submitRename = () => {
    studio.setProjectName(draftName);
    setRenameOpen(false);
    notify("Project renamed");
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      await studio.loadProject(text);
      notify(`Opened "${studio.projectName}"`);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not open this project",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const actionsRef = React.useRef({ requestNew, requestOpen, saveProject });
  actionsRef.current = { requestNew, requestOpen, saveProject };

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (isTypingTarget(event.target)) return;

      if (event.altKey && matchKey(event, ["n"])) {
        event.preventDefault();
        actionsRef.current.requestNew();
        return;
      }
      if (event.shiftKey && !event.altKey && matchKey(event, ["s"])) {
        event.preventDefault();
        void actionsRef.current.saveProject();
        return;
      }
      if (!event.altKey && !event.shiftKey && matchKey(event, ["o"])) {
        event.preventDefault();
        actionsRef.current.requestOpen();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div ref={rootRef} className="relative flex min-w-0 items-center">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Project menu"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex max-w-[100px] min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px] transition-colors sm:max-w-[180px]",
          open
            ? "border-border bg-accent/70"
            : "border-transparent hover:border-border hover:bg-accent/50",
        )}
      >
        <span className="truncate font-medium text-foreground/75">
          {studio.projectName}
        </span>
        {studio.dirtyArtwork ? (
          <span
            className="size-1.5 shrink-0 rounded-full bg-primary"
            title="Unsaved changes"
          />
        ) : null}
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Project"
          className="absolute left-0 top-[calc(100%+6px)] z-50 w-[224px] rounded-lg border border-border bg-panel p-1 shadow-2xl"
        >
          <MenuItem
            icon={FilePlus2}
            label="New project"
            shortcut="Ctrl+Alt+N"
            onSelect={requestNew}
          />
          <MenuItem
            icon={FolderOpen}
            label="Open project…"
            shortcut="Ctrl+O"
            onSelect={requestOpen}
          />
          <MenuItem
            icon={Save}
            label={busy ? "Saving…" : "Save project"}
            shortcut="Ctrl+Shift+S"
            onSelect={() => void saveProject()}
            disabled={busy}
          />
          <div className="my-1 h-px bg-border" />
          <MenuItem icon={PencilLine} label="Rename project…" onSelect={openRename} />
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept={`.${PROJECT_EXTENSION},application/json`}
        className="hidden"
        onChange={handleFile}
      />

      {busy && !open ? (
        <Loader2 className="ml-1 size-3 animate-spin text-muted-foreground" />
      ) : null}

      <Dialog open={pending !== null} onOpenChange={(value) => !value && setPending(null)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              The current artwork has not been saved to a project file. Opening
              another project or starting a new one will replace it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={confirmDiscard}>
              {pending === "new" ? "Discard and start new" : "Discard and open"}
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>
              The name is used for the project file and the top bar label.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitRename();
                }
              }}
              maxLength={60}
              autoFocus
              spellCheck={false}
            />
          </div>
          <DialogFooter>
            <Button onClick={submitRename}>Save name</Button>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
