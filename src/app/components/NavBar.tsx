"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const MENU = [{ href: "/", label: "대시보드" }] as const;

export default function NavBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-700/80 bg-space-900/95 backdrop-blur-sm shadow-glow">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link
            href="/"
            className="flex items-center gap-3 text-lg font-bold text-slate-100 hover:text-slate-50 transition-colors"
          >
            <Image
              src="/helmet-logo.png"
              alt="AF Factory Hub"
              width={36}
              height={36}
              className="object-contain shrink-0"
            />
            <span className="leading-none">AF Factory Hub</span>
          </Link>
          <nav className="flex items-center gap-1">
            {MENU.map(({ href, label }) => {
              const isActive =
                href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? "bg-cyan-500/20 text-neon-blue border border-cyan-500/40 shadow-glow"
                      : "text-slate-300 hover:text-slate-100 hover:bg-slate-800 border border-transparent"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
