"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Hide without changing document flow, so the subtitle being read stays put. */
export function AutoHideHeader({ children, locked }: { children: ReactNode; locked: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    let hidden = false;
    let height = header.offsetHeight;
    let previous = window.scrollY;
    let travel = 0;
    let frame = 0;
    const show = (visible: boolean) => {
      hidden = !visible;
      header.dataset.collapsed = String(hidden);
      document.documentElement.style.setProperty("--sticky-header-height", `${hidden ? 0 : height}px`);
    };
    const protectedInteraction = () => locked || !!header.querySelector("details[open]") ||
      header.contains(document.activeElement) || !!document.querySelector('[role="dialog"][aria-modal="true"]');
    const update = () => {
      frame = 0;
      // Clamp rubber-band scrolling at both ends.
      const y = Math.max(0, Math.min(window.scrollY, document.documentElement.scrollHeight - window.innerHeight));
      const delta = y - previous;
      previous = y;
      if (y <= height + 24 || protectedInteraction()) {
        travel = 0;
        show(true);
        return;
      }
      if (Math.sign(delta) !== Math.sign(travel)) travel = 0;
      travel += delta;
      if (!hidden && travel >= 36) { show(false); travel = 0; }
      if (hidden && travel <= -12) { show(true); travel = 0; }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    const reset = () => {
      height = header.offsetHeight;
      previous = window.scrollY;
      travel = 0;
      show(true);
    };
    const observer = new ResizeObserver(reset);
    observer.observe(header);
    reset();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", reset);
    header.addEventListener("focusin", reset);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", reset);
      header.removeEventListener("focusin", reset);
      document.documentElement.style.removeProperty("--sticky-header-height");
    };
  }, [locked]);

  return <div ref={ref} data-collapsed="false" className="sticky top-0 z-30 transition-transform duration-200 ease-out data-[collapsed=true]:-translate-y-full motion-reduce:transition-none">{children}</div>;
}
