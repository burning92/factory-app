"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import Header from "./Header";

const LOGIN_PATH = "/login";
const CHANGE_PASSWORD_PATH = "/login/change-password";
const LOGOUT_PATH = "/logout";

/** 하랑(200)이 접근하면 안 되는 100용 업무 경로 (실제 app 라우트 기준) */
function isHarangBlockedPath(pathname: string): boolean {
  return (
    pathname.startsWith("/production") ||
    pathname === "/history" ||
    pathname.startsWith("/history/") ||
    pathname.startsWith("/inventory") ||
    pathname.startsWith("/materials") ||
    pathname.startsWith("/journal")
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading, uiSettings, organization } = useAuth();
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

  if (pathname === LOGOUT_PATH) {
    return <>{children}</>;
  }

  if (!user && !isLoginPage && !isChangePasswordPage) {
    return null;
  }

  if (isLoginPage || isChangePasswordPage) {
    return <>{children}</>;
  }

  if (organization?.organization_code === "200" && isHarangBlockedPath(pathname)) {
    router.replace("/");
    return null;
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
