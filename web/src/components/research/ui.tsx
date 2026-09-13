"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as Progress from "@radix-ui/react-progress";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export const motionTiming = { duration: 0.28, ease: [0.2, 0, 0, 1] as const };
export { Root as Tabs, List as TabsList, Trigger as TabsTrigger, Content as TabsContent } from "@radix-ui/react-tabs";
export const TooltipProvider = Tooltip.Provider;

export function Hint({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip.Root><Tooltip.Trigger asChild>{children}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="rs-tooltip" sideOffset={7}>{label}<Tooltip.Arrow className="rs-tooltip-arrow" /></Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
}

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (notify) => { const media = window.matchMedia(query); media.addEventListener("change", notify); return () => media.removeEventListener("change", notify); },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Desktop rails animate layout; narrow screens use Radix's focus-trapped sheet. */
export function ResearchPanel({ open, onOpenChange, side, title, children, container }: {
  open: boolean; onOpenChange: (open: boolean) => void; side: "left" | "right";
  title: string; children: ReactNode; container: HTMLElement | null;
}) {
  const overlay = useMediaQuery(side === "left" ? "(max-width: 799px)" : "(max-width: 1000px)");
  const reduced = useReducedMotion();
  if (overlay) return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal container={container}>
    <Dialog.Overlay className="rs-sheet-overlay" />
    <Dialog.Content className={`rs-sheet rs-sheet-${side}`} aria-describedby={undefined} onCloseAutoFocus={(event) => {
      event.preventDefault();
      container?.querySelector<HTMLButtonElement>(side === "left" ? '[data-panel-trigger="sidebar"]' : '[data-panel-trigger="report"]')?.focus();
    }}>
      <Dialog.Title className="rs-sr-only">{title}</Dialog.Title>
      {children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
  return <AnimatePresence initial={false}>{open && <motion.div className={`rs-panel-rail rs-panel-rail-${side}`} initial={{ width: 0, opacity: 0 }} animate={{ width: side === "left" ? 224 : 380, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={reduced ? { duration: 0 } : motionTiming}>{children}</motion.div>}</AnimatePresence>;
}

export function ResearchProgress({ value }: { value: number }) {
  const reduced = useReducedMotion();
  return <Progress.Root className="rs-progress" value={value} aria-label="研究节点完成进度"><Progress.Indicator asChild><motion.div initial={false} animate={{ scaleX: value / 100 }} transition={{ duration: reduced ? 0 : 0.55, ease: "easeOut" }} style={{ width: "100%", transformOrigin: "left" }} /></Progress.Indicator></Progress.Root>;
}
