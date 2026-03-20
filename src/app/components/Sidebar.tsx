"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const SIDEBAR_MENUS = [
  { href: "/production/outbound", label: "Stock Output" },
  { href: "/production/history", label: "Usage Calculation" },
  { href: "/production/dough-usage", label: "Dough Usage" },
  { href: "/production/admin", label: "Reference Data" },
] as const;

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[280px] shrink-0 h-screen flex flex-col border-r border-slate-700/80 bg-space-900">
      <div className="p-4 border-b border-slate-700/60">
        <Link
          href="/"
          className="flex items-center gap-3 text-slate-100 hover:text-white transition-colors"
        >
          <Image
            src="/helmet-logo.png"
            alt="AF Factory Hub"
            width={32}
            height={32}
            className="object-contain shrink-0"
          />
          <span className="font-bold text-sm leading-tight">AF Factory Hub</span>
        </Link>
        <Link
          href="/"
          className="mt-3 flex items-center justify-center py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-cyan-400 hover:bg-slate-800/60 transition-colors border border-slate-700/60"
        >
          Dashboard
        </Link>
      </div>

      <div className="flex-1 overflow-auto py-4 px-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 px-3 mb-3">
          Production Management
        </h2>
        <nav className="space-y-0.5">
          {SIDEBAR_MENUS.map(({ href, label }) => {
            const isActive = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 pl-3 pr-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 border-l-4 ${
                  isActive
                    ? "bg-cyan-500/15 text-cyan-300 border-cyan-500"
                    : "border-transparent text-slate-300 hover:text-slate-100 hover:bg-slate-800/70"
                }`}
              >
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
