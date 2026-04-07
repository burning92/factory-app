"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { canManageEquipmentRegistry } from "@/features/equipment/equipmentHistoryPermissions";

export default function AdminEquipmentLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!canManageEquipmentRegistry(profile?.role)) {
      router.replace("/");
    }
  }, [loading, profile?.role, router]);

  if (loading || !canManageEquipmentRegistry(profile?.role)) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <p className="text-slate-500 text-sm">확인 중…</p>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] pb-20 md:pb-8">
      <div className="border-b border-slate-700/60 bg-slate-900/50 px-4 py-3 md:px-6">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-3">
          <Link href="/admin/equipment" className="text-sm font-semibold text-cyan-400 hover:text-cyan-300">
            제조설비등록
          </Link>
          <span className="text-slate-600">/</span>
          <Link href="/manage" className="text-xs text-slate-500 hover:text-slate-300">
            관리(사용자)로
          </Link>
          <Link href="/production/admin" className="text-xs text-slate-500 hover:text-slate-300">
            기준정보 관리로
          </Link>
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 py-4 md:px-6 md:py-6">{children}</div>
    </div>
  );
}
