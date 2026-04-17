"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import Header from "./Header";
import MobileTabBar from "./MobileTabBar";

const LOGIN_PATH = "/login";
const CHANGE_PASSWORD_PATH = "/login/change-password";
const LOGOUT_PATH = "/logout";

/** 접속 로그 수집 대상 경로만 기록 (잡음 경로 제외) */
function shouldTrackAccessPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/executive" || pathname === "/daily" || pathname === "/production") {
    return true;
  }
  if (pathname === "/materials" || pathname === "/inventory/ecount" || pathname === "/manage") {
    return true;
  }
  if (pathname.startsWith("/executive/")) return true;
  if (pathname.startsWith("/daily/")) return true;
  if (pathname.startsWith("/production/")) return true;
  if (pathname.startsWith("/materials/")) return true;
  if (pathname.startsWith("/admin/equipment")) return true;
  if (pathname === "/harang" || pathname.startsWith("/harang/")) return true;
  return false;
}

/** 하랑(200) 보기 또는 조직 200 계정이 접근하면 안 되는 AFF 업무 경로 */
function isHarangBlockedPath(pathname: string): boolean {
  return (
    pathname.startsWith("/production") ||
    pathname.startsWith("/materials") ||
    pathname.startsWith("/daily") ||
    pathname.startsWith("/executive") ||
    pathname.startsWith("/manage") ||
    pathname.startsWith("/admin") ||
    pathname === "/history" ||
    pathname.startsWith("/history/") ||
    pathname.startsWith("/inventory") ||
    pathname.startsWith("/journal")
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading, uiSettings, viewOrganizationCode, organization } = useAuth();
  const isHarangOrgAccount = organization?.organization_code === "200";
  const isHeadquartersOpsUser =
    organization?.organization_code === "100" && (profile?.role === "manager" || profile?.role === "admin");
  const isGlobalAdmin000 = organization?.organization_code === "000" && profile?.role === "admin";
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
    // admin은 공통 진입("/") 유지. 기존 admin 전용 /manage 직행만 예외 처리.
    if (profile.role === "admin" && path === "/manage") return;
    // 조직 200(하랑): AFF 쪽 기본 랜딩으로 보내지 않음
    if (isHarangOrgAccount && path && path !== "/" && !path.startsWith("/harang") && !path.startsWith("/account")) {
      return;
    }
    if (path && path !== "/") {
      router.replace(path);
    }
  }, [user, profile, uiSettings?.default_landing_path, pathname, router, isHarangOrgAccount]);

  /** 설비 이상 등록: worker URL 직접 접근 차단 */
  useEffect(() => {
    if (loading || !profile) return;
    if (
      pathname === "/daily/manufacturing-equipment/incident/new" &&
      profile.role === "worker"
    ) {
      router.replace("/daily/manufacturing-equipment?incident=restricted");
    }
  }, [loading, profile, pathname, router]);

  /** 설비 이상 이력 수정 페이지 비활성화 — 상세로 이동 */
  useEffect(() => {
    if (loading || !profile) return;
    const m = pathname.match(/^\/daily\/manufacturing-equipment\/incidents\/([^/]+)\/edit$/);
    if (m?.[1]) {
      router.replace(`/daily/manufacturing-equipment/incidents/${m[1]}?edit=disabled`);
    }
  }, [loading, profile, pathname, router]);

  /** 접속(페이지 진입) 로그: 자동로그인 사용자 포함, 동일 경로는 짧은 구간 중복 전송 방지 */
  useEffect(() => {
    if (loading || !user || !profile) return;
    if (pathname === LOGIN_PATH || pathname === CHANGE_PASSWORD_PATH || pathname === LOGOUT_PATH) return;
    if (pathname === "/admin/logs" || pathname.startsWith("/admin/logs/")) return;
    if (!shouldTrackAccessPath(pathname)) return;
    const key = `access-log:${user.id}:${pathname}`;
    const now = Date.now();
    const prevRaw = sessionStorage.getItem(key);
    const prev = prevRaw ? Number(prevRaw) : 0;
    if (prev && Number.isFinite(prev) && now - prev < 5 * 60 * 1000) return;
    sessionStorage.setItem(key, String(now));

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      await fetch("/api/logs/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          page_path: pathname,
          event: "page_view",
        }),
      });
    })().catch(() => {});
  }, [loading, user, profile, pathname]);

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

  if ((viewOrganizationCode === "200" || isHarangOrgAccount) && isHarangBlockedPath(pathname)) {
    router.replace("/");
    return null;
  }
  if (isHarangOrgAccount && (pathname === "/account/leave" || pathname.startsWith("/account/leave/"))) {
    router.replace("/account");
    return null;
  }
  if (pathname === "/harang" || pathname.startsWith("/harang/")) {
    const allowHarang =
      viewOrganizationCode === "200" ||
      isHarangOrgAccount ||
      isHeadquartersOpsUser ||
      isGlobalAdmin000;
    if (!allowHarang) {
      router.replace("/");
      return null;
    }
    if ((pathname === "/harang/admin" || pathname.startsWith("/harang/admin/")) && profile?.role !== "admin") {
      router.replace("/harang");
      return null;
    }
  }

  const isManagePage = pathname === "/manage";
  if (isManagePage && profile?.role !== "admin") {
    router.replace("/");
    return null;
  }
  const isProductionAdminPage = pathname === "/production/admin";
  if (isProductionAdminPage && profile?.role !== "admin") {
    router.replace("/");
    return null;
  }
  const isAdminEquipmentPath = pathname === "/admin/equipment" || pathname.startsWith("/admin/equipment/");
  if (isAdminEquipmentPath && profile?.role !== "admin") {
    router.replace("/");
    return null;
  }
  const isAdminLogsPath = pathname === "/admin/logs" || pathname.startsWith("/admin/logs/");
  if (isAdminLogsPath && profile?.role !== "admin") {
    router.replace("/");
    return null;
  }

  const showTabBar = true;
  const mainClassName =
    pathname === "/harang" || pathname.startsWith("/harang/")
      ? "harang-theme relative z-0 flex-1 w-full bg-slate-50 pb-16 md:pb-0 print:pb-0"
      : "relative z-0 flex-1 w-full bg-space-900 pb-16 md:pb-0 print:pb-0";

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className={mainClassName}>
        {children}
      </main>
      {showTabBar && <MobileTabBar />}
    </div>
  );
}
