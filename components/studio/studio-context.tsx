"use client";

import * as React from "react";
import { useSyncExternalStore } from "react";

import type { Studio } from "@/lib/paint/studio";

export type PanelTab = "brush" | "color" | "layers";

type StudioContextValue = {
  studio: Studio;
  notify: (message: string, tone?: "default" | "error") => void;
  openPanel: (tab?: PanelTab) => void;
};

const StudioContext = React.createContext<StudioContextValue | null>(null);

export function StudioProvider({
  value,
  children,
}: {
  value: StudioContextValue;
  children: React.ReactNode;
}) {
  return (
    <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
  );
}

export function useStudio() {
  const context = React.useContext(StudioContext);
  if (!context) throw new Error("useStudio must be used inside StudioProvider");
  return context;
}

export function useStudioVersion() {
  const { studio } = useStudio();
  return useSyncExternalStore(studio.subscribe, studio.getVersion, () => 0);
}
