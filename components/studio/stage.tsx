"use client";

import * as React from "react";
import {
  Maximize,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Point } from "@/lib/paint/studio";
import { cn } from "@/lib/utils";
import { useStudio, useStudioVersion } from "./studio-context";

type Drag = { id: number; mode: "paint" | "pan"; last: Point };

type Gesture = {
  distance: number;
  angle: number;
  mid: Point;
};

function buildGesture(a: Point, b: Point): Gesture {
  return {
    distance: Math.hypot(a.x - b.x, a.y - b.y),
    angle: Math.atan2(b.y - a.y, b.x - a.x),
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

export function Stage({ onOpenCanvasSettings }: { onOpenCanvasSettings: () => void }) {
  const { studio, notify } = useStudio();
  useStudioVersion();

  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const cursorRef = React.useRef<HTMLDivElement>(null);
  const pointersRef = React.useRef(new Map<number, Point>());
  const dragRef = React.useRef<Drag | null>(null);
  const gestureRef = React.useRef<Gesture | null>(null);
  const spaceRef = React.useRef(false);
  const hoverRef = React.useRef<Point | null>(null);
  const [spaceHeld, setSpaceHeld] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);

  const isRingTool = studio.tool === "brush" || studio.tool === "eraser";

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    studio.attach(canvas);
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) studio.setViewportSize(rect.width, rect.height);
    });
    observer.observe(wrap);
    studio.setViewportSize(wrap.clientWidth, wrap.clientHeight);

    return () => {
      observer.disconnect();
      studio.detach(canvas);
    };
  }, [studio]);

  React.useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const factor = Math.exp(-event.deltaY * 0.0016);
      studio.zoomAt(factor, point.x, point.y);
    };
    wrap.addEventListener("wheel", handleWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", handleWheel);
  }, [studio]);

  React.useEffect(() => {
    const handleDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTypingTarget(event.target)) return;
      event.preventDefault();
      if (!spaceRef.current) {
        spaceRef.current = true;
        setSpaceHeld(true);
      }
    };
    const handleUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    const handleBlur = () => {
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener("keydown", handleDown);
    window.addEventListener("keyup", handleUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleDown);
      window.removeEventListener("keyup", handleUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  React.useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor || !hoverRef.current) return;
    const size = Math.max(4, studio.brush.size * studio.view.scale);
    cursor.style.width = `${size}px`;
    cursor.style.height = `${size}px`;
  }, [studio, studio.brush.size, studio.view.scale]);

  const pointFromEvent = React.useCallback((event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const updateCursor = React.useCallback(
    (point: Point) => {
      hoverRef.current = point;
      const cursor = cursorRef.current;
      if (!cursor) return;
      const size = Math.max(4, studio.brush.size * studio.view.scale);
      cursor.style.left = `${point.x}px`;
      cursor.style.top = `${point.y}px`;
      cursor.style.width = `${size}px`;
      cursor.style.height = `${size}px`;
      cursor.style.opacity = "1";
    },
    [studio],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (event.button === 2) return;

    const point = pointFromEvent(event);
    if (event.pointerType !== "touch") updateCursor(point);
    else if (cursorRef.current) cursorRef.current.style.opacity = "0";
    pointersRef.current.set(event.pointerId, point);

    if (pointersRef.current.size === 2) {
      studio.cancelStroke();
      dragRef.current = null;
      const [a, b] = Array.from(pointersRef.current.values());
      gestureRef.current = buildGesture(a, b);
      pointersRef.current.forEach((_value, id) => {
        try {
          canvas.setPointerCapture(id);
        } catch {
          // capture is best effort; the gesture still works without it
        }
      });
      return;
    }
    if (pointersRef.current.size > 2) return;

    const wantsPan =
      studio.tool === "pan" || spaceRef.current || event.button === 1;
    if (wantsPan) {
      dragRef.current = { id: event.pointerId, mode: "pan", last: point };
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    if (event.altKey || studio.tool === "eyedropper") {
      const sampled = studio.sampleColor(point);
      if (sampled) {
        studio.setColor(sampled);
        studio.pushRecentColor(sampled);
      }
      return;
    }

    if (event.button !== 0) return;
    const started = studio.beginStroke(
      point,
      event.pressure,
      event.pointerType,
      event.timeStamp,
    );
    if (started) {
      dragRef.current = { id: event.pointerId, mode: "paint", last: point };
      canvas.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointFromEvent(event);
    if (event.pointerType !== "touch") updateCursor(point);

    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, point);
    }

    const gesture = gestureRef.current;
    if (gesture && pointersRef.current.size >= 2) {
      const [a, b] = Array.from(pointersRef.current.values());
      const next = buildGesture(a, b);

      if (gesture.distance > 0) {
        studio.zoomAt(next.distance / gesture.distance, next.mid.x, next.mid.y);
      }
      studio.panBy(next.mid.x - gesture.mid.x, next.mid.y - gesture.mid.y);
      const delta = next.angle - gesture.angle;
      if (Math.abs(delta) > 0.004) {
        studio.rotateAt(delta, next.mid.x, next.mid.y);
      }
      gestureRef.current = next;
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;

    if (drag.mode === "pan") {
      studio.panBy(point.x - drag.last.x, point.y - drag.last.y);
      drag.last = point;
      return;
    }

    const native = event.nativeEvent;
    const coalesced =
      typeof native.getCoalescedEvents === "function"
        ? native.getCoalescedEvents()
        : [];
    if (coalesced.length > 1) {
      for (const coalescedEvent of coalesced) {
        studio.strokeTo(
          pointFromEvent(coalescedEvent),
          coalescedEvent.pressure,
          coalescedEvent.timeStamp,
        );
      }
    } else {
      studio.strokeTo(point, event.pressure, event.timeStamp);
    }
  };

  const finishPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId);
    const remaining = Array.from(pointersRef.current.values());
    gestureRef.current =
      remaining.length >= 2 ? buildGesture(remaining[0], remaining[1]) : null;
    if (pointersRef.current.size === 0 && event.pointerType === "touch") {
      if (cursorRef.current) cursorRef.current.style.opacity = "0";
    }
    const drag = dragRef.current;
    if (drag && drag.id === event.pointerId) {
      if (drag.mode === "paint") studio.endStroke();
      else studio.flushEmit();
      dragRef.current = null;
    }
  };

  const handlePointerLeave = () => {
    const cursor = cursorRef.current;
    if (cursor && !dragRef.current) cursor.style.opacity = "0";
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    try {
      await studio.addImageFile(file);
      notify("Image added as a new layer");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not insert the image",
        "error",
      );
    }
  };

  const cursorClass = spaceHeld
    ? "cursor-grab active:cursor-grabbing"
    : studio.tool === "pan"
      ? "cursor-grab active:cursor-grabbing"
      : studio.tool === "eyedropper"
        ? "cursor-crosshair"
        : "cursor-none";

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden bg-stage surface-grain"
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute inset-0 size-full touch-none select-none",
          cursorClass,
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onLostPointerCapture={() => {
          if (dragRef.current?.mode === "paint") studio.endStroke();
          dragRef.current = null;
        }}
        onPointerLeave={handlePointerLeave}
        onPointerEnter={() => {
          if (cursorRef.current) cursorRef.current.style.opacity = "1";
        }}
        onContextMenu={(event) => event.preventDefault()}
        onDoubleClick={() => studio.fitToScreen()}
      />

      <div
        ref={cursorRef}
        aria-hidden
        className={cn(
          "pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 opacity-0 mix-blend-difference transition-opacity",
          !isRingTool && "hidden",
        )}
      >
        <span className="absolute left-1/2 top-1/2 size-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90" />
      </div>

      <div className="pointer-events-none absolute right-3 top-3 hidden items-center gap-1.5 rounded-md border border-white/5 bg-black/25 px-2 py-1 text-[10px] text-white/45 xl:flex">
        <span>Space + drag to pan</span>
        <span className="opacity-40">·</span>
        <span>Scroll to zoom</span>
      </div>

      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-panel/95 px-1 py-1 shadow-xl backdrop-blur-sm">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => studio.zoomStep(1 / 1.25)}
              className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Zoom out"
            >
              <Minus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Zoom out</TooltipContent>
        </Tooltip>
        <button
          type="button"
          onClick={() => studio.actualSize()}
          className="min-w-[46px] rounded-sm px-1 py-1 text-[11px] tabular-nums text-foreground/85 transition-colors hover:bg-accent"
          aria-label="Zoom to 100%"
        >
          {Math.round(studio.view.scale * 100)}%
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => studio.zoomStep(1.25)}
              className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Zoom in"
            >
              <Plus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Zoom in</TooltipContent>
        </Tooltip>
        <span className="mx-1 h-4 w-px bg-border" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => studio.fitToScreen()}
              className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Fit to screen"
            >
              <Maximize className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Fit to screen · Ctrl+0</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => studio.rotateBy(-15)}
              className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Rotate left"
            >
              <RotateCcw className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Rotate 15°</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => studio.rotateBy(15)}
              className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Rotate right"
            >
              <RotateCw className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Rotate 15°</TooltipContent>
        </Tooltip>
        {Math.abs(studio.view.rotation) > 0.001 ? (
          <button
            type="button"
            onClick={() => studio.resetRotation()}
            className="flex h-7 items-center gap-1 rounded-sm px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Reset rotation"
          >
            <X className="size-3" />
            <span className="tabular-nums">
              {Math.round((studio.view.rotation * 180) / Math.PI)}°
            </span>
          </button>
        ) : null}
      </div>

      {dragOver ? (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-xl border border-dashed border-primary/60 bg-background/60 text-[12px] text-primary">
          Drop an image to add it as a layer
        </div>
      ) : null}
    </div>
  );
}
