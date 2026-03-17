"use client";

import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * 로그아웃 전용 페이지. Link로 진입 시 마운트에서 signOut 호출.
 * 모바일에서 button onClick 대신 네비게이션으로 처리해 터치가 확실히 동작하도록 함.
 */
export default function LogoutPage() {
  const { signOut } = useAuth();

  useEffect(() => {
    signOut();
  }, [signOut]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-space-900">
      <p className="text-slate-500 text-sm">로그아웃 중…</p>
    </div>
  );
}
