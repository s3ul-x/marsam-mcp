"use client";

import * as React from "react";
import { Copy, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MAX_PAGES } from "@/lib/paint/studio";
import { cn } from "@/lib/utils";
import { useStudio, useStudioVersion } from "./studio-context";

type Thumb = { id: string; url: string | null };

export function PagesBar() {
  const { studio, notify } = useStudio();
  const version = useStudioVersion();
  const [thumbs, setThumbs] = React.useState<Thumb[]>([]);
  const [renaming, setRenaming] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState("");
  const [deleteIndex, setDeleteIndex] = React.useState<number | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const pages = studio.pageSummaries;

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setThumbs(
        studio.pages.map((page, index) => ({
          id: page.id,
          url: studio.pageThumbnail(index, 120),
        })),
      );
    }, 180);
    return () => clearTimeout(timer);
  }, [studio, version]);

  React.useEffect(() => {
    if (renaming === null) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [renaming]);

  if (pages.length === 0) return null;

  const commitRename = (index: number) => {
    studio.renamePage(index, draft);
    setRenaming(null);
  };

  const handleAdd = () => {
    try {
      studio.addPage();
      notify(`Added page ${studio.pages.length}`);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not add a page",
        "error",
      );
    }
  };

  const handleDuplicate = () => {
    try {
      const index = studio.duplicatePage();
      notify(`Duplicated as page ${index + 1}`);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not duplicate the page",
        "error",
      );
    }
  };

  const handleDelete = (index: number) => {
    if (studio.pages.length <= 1) return;
    setDeleteIndex(index);
  };

  const confirmedDelete = () => {
    if (deleteIndex === null) return;
    studio.deletePage(deleteIndex);
    setDeleteIndex(null);
  };

  const deleting = deleteIndex === null ? null : pages[deleteIndex];

  return (
    <>
      <div className="flex h-16 shrink-0 items-stretch gap-1.5 overflow-x-auto border-t border-border bg-panel px-2 py-1.5">
        <div className="flex shrink-0 items-center ps-0.5 pe-1 text-[9.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Pages
        </div>

        {pages.map((page, index) => {
          const thumb = thumbs.find((item) => item.id === page.id)?.url ?? null;
          const aspect = page.width / Math.max(1, page.height);
          const thumbWidth = Math.round(
            40 * Math.min(2.4, Math.max(0.4, aspect)),
          );
          const isRenaming = renaming === index;
          return (
            <div
              key={page.id}
              role="button"
              tabIndex={0}
              aria-pressed={page.active}
              onClick={() => {
                if (isRenaming) return;
                studio.selectPage(index);
              }}
              onDoubleClick={() => {
                setDraft(page.name);
                setRenaming(index);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  studio.selectPage(index);
                }
              }}
              className={cn(
                "group flex shrink-0 items-center gap-2 rounded-md border px-1.5 py-1 text-start transition-colors",
                page.active
                  ? "border-primary/70 bg-accent/70"
                  : "border-border/70 bg-background/40 hover:border-border hover:bg-accent/40",
              )}
              title={`${page.name} · ${page.width} × ${page.height} · ${
                page.layers
              } ${page.layers === 1 ? "layer" : "layers"}`}
            >
              <span
                className={cn(
                  "relative flex h-11 items-center justify-center overflow-hidden rounded-[3px] border bg-[#17171b]",
                  page.active ? "border-white/25" : "border-white/10",
                )}
                style={{ width: thumbWidth + 2 }}
              >
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumb}
                    alt=""
                    draggable={false}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : null}
              </span>
              <span className="flex min-w-0 flex-col justify-center">
                {isRenaming ? (
                  <input
                    ref={inputRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => commitRename(index)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") commitRename(index);
                      if (event.key === "Escape") setRenaming(null);
                    }}
                    maxLength={40}
                    className="h-5 w-28 rounded-sm border border-primary/50 bg-background px-1 text-[11px] text-foreground outline-none"
                    aria-label="Page name"
                  />
                ) : (
                  <span className="max-w-36 truncate text-[11px] font-medium text-foreground/90">
                    {page.name}
                  </span>
                )}
                <span className="text-[9.5px] tabular-nums text-muted-foreground">
                  {index + 1} · {page.width}×{page.height} · {page.layers}{" "}
                  {page.layers === 1 ? "layer" : "layers"}
                </span>
              </span>
            </div>
          );
        })}

        <div className="ms-1 flex shrink-0 items-center gap-1 self-center">
          <button
            type="button"
            onClick={handleAdd}
            disabled={pages.length >= MAX_PAGES}
            className="flex h-11 items-center gap-1.5 rounded-md border border-dashed border-border px-2 text-[10.5px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            title={`Add a page (max ${MAX_PAGES})`}
          >
            <Plus className="size-3.5" />
            Add
          </button>
          <button
            type="button"
            onClick={handleDuplicate}
            disabled={pages.length >= MAX_PAGES}
            className="flex h-11 items-center gap-1.5 rounded-md border border-border/70 px-2 text-[10.5px] text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            title="Duplicate the current page"
          >
            <Copy className="size-3.5" />
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => handleDelete(studio.activePageIndex)}
            disabled={pages.length <= 1}
            className="flex size-11 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
            title="Delete the current page"
            aria-label="Delete the current page"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <Dialog
        open={deleteIndex !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteIndex(null);
        }}
      >
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete page</DialogTitle>
            <DialogDescription>
              Delete “{deleting?.name ?? "this page"}” with its layers and
              artwork? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="destructive" onClick={confirmedDelete}>
              Delete page
            </Button>
            <Button variant="ghost" onClick={() => setDeleteIndex(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
