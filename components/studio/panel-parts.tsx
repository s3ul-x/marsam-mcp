"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function PanelSection({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2", className)}>
      {title || action ? (
        <div className="flex items-center justify-between">
          {title ? (
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {title}
            </h3>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
  onCommit?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[11.5px] text-foreground/75">{label}</span>
        <span className="text-[10.5px] tabular-nums text-muted-foreground">
          {display}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(values) => onChange(values[0])}
        onValueCommit={() => onCommit?.()}
      />
    </div>
  );
}

export function IconAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  className,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "flex size-7 items-center justify-center rounded-sm transition-colors disabled:pointer-events-none disabled:opacity-30",
            active
              ? "bg-secondary text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
            className,
          )}
        >
          <Icon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
