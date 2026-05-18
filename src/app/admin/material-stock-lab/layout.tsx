"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function AdminMaterialStockLabLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (profile?.role !== "admin") router.replace("/");
  }, [loading, profile?.role, router]);

  if (loading || profile?.role !== "admin") {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <p className="text-slate-500 text-sm">확인 중…</p>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] pb-20 md:pb-8">
      <div className="border-b border-slate-700/60 bg-slate-900/50 px-4 py-3 md:px-6">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold text-cyan-400">재고 장부 테스트 (Lab)</span>
          <span className="text-slate-600">|</span>
          <a href="/admin" className="text-slate-500 hover:text-slate-300">
            기준정보 관리
          </a>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 py-4 md:px-6 md:py-6">{children}</div>
    </div>
  );
}
