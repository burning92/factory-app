"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import Header from "./Header";

const LOGIN_PATH = "/login";
const CHANGE_PASSWORD_PATH = "/login/change-password";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading, uiSettings } = useAuth();
  const isLoginPage = pathname === LOGIN_PATH;
  const isChangePasswordPage = pathname === CHANGE_PASSWORD_PATH;

  useEffect(() => {
    if (loading) return;
    if (!user) {
      if (!isLoginPage && !isChangePasswordPage) {
        router.replace(LOGIN_PATH);
      }
      return;
    }
    if (user && isLoginPage) {
      router.replace("/");
      return;
    }
  }, [loading, user, isLoginPage, isChangePasswordPage, router]);

  // 기본 랜딩: 조직 설정에 default_landing_path가 있으면 '/' 대신 해당 경로로
  useEffect(() => {
    if (!user || !profile || !uiSettings?.default_landing_path || pathname !== "/") return;
    const path = uiSettings.default_landing_path.trim();
    if (path && path !== "/") {
      router.replace(path);
    }
  }, [user, profile, uiSettings?.default_landing_path, pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-space-900">
        <p className="text-slate-500 text-sm">로딩 중…</p>
      </div>
    );
  }

  if (!user && !isLoginPage && !isChangePasswordPage) {
    return null;
  }

  if (isLoginPage || isChangePasswordPage) {
    return <>{children}</>;
  }

  const isManagePage = pathname === "/manage";
  if (isManagePage && profile?.role !== "admin") {
    router.replace("/");
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 w-full bg-space-900">{children}</main>
    </div>
  );
}
