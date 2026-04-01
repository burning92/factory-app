"use client";

import { useEffect } from "react";

export default function AutoScrollToToday({ targetDate }: { targetDate: string | null }) {
  useEffect(() => {
    if (!targetDate) return;
    const el = document.getElementById(`plan-day-${targetDate}`);
    if (!el) return;
    const t = window.setTimeout(() => {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }, 120);
    return () => window.clearTimeout(t);
  }, [targetDate]);

  return null;
}
