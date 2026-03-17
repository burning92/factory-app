"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { toAuthEmailLocal } from "@/lib/authEmail";
import type { Organization, OrganizationUISettings, Profile } from "@/types/auth";

const AUTH_EMAIL_SUFFIX = ".local";

interface AuthState {
  user: User | null;
  profile: Profile | null;
  organization: Organization | null;
  uiSettings: OrganizationUISettings | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  signIn: (
    organizationCode: string,
    loginId: string,
    password: string,
    rememberMe: boolean
  ) => Promise<{ error: string | null }>;
  signOut: () => void;
  clearError: () => void;
  setMustChangePasswordDone: () => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    organization: null,
    uiSettings: null,
    loading: true,
    error: null,
  });

  const loadProfileAndOrg = useCallback(async (userId: string, retried = false) => {
    const { data: { session } } = await supabase.auth.getSession();
    const effectiveUserId = session?.user?.id ?? userId;
    if (!session?.user) {
      await supabase.auth.signOut();
      setState((prev) => ({
        ...prev,
        user: null,
        profile: null,
        organization: null,
        uiSettings: null,
        loading: false,
        error: "세션이 없습니다.",
      }));
      return;
    }

    // 1단계: public.profiles에서 id = auth.uid() 인 본인 행만 조회 (join 없음)
    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select("id, organization_id, login_id, display_name, role, is_active, must_change_password")
      .eq("id", effectiveUserId)
      .single();

    if (profileError || !profileRow) {
      if (!retried) {
        await new Promise((r) => setTimeout(r, 300));
        return loadProfileAndOrg(userId, true);
      }
      await supabase.auth.signOut();
      setState((prev) => ({
        ...prev,
        user: null,
        profile: null,
        organization: null,
        uiSettings: null,
        loading: false,
        error: profileError?.message ?? "프로필을 불러올 수 없습니다.",
      }));
      return;
    }

    const profile: Profile = {
      id: profileRow.id,
      organization_id: profileRow.organization_id,
      login_id: profileRow.login_id ?? "",
      display_name: profileRow.display_name ?? null,
      role: profileRow.role as Profile["role"],
      is_active: profileRow.is_active ?? true,
      must_change_password: profileRow.must_change_password ?? true,
    };

    // 2단계: profile.organization_id로 organizations 1건 조회 후, 필요 시 organization_ui_settings 조회 (join 없음)
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("id, organization_code, name, is_active")
      .eq("id", profile.organization_id)
      .single();

    const organization: Organization | null = orgRow
      ? {
          id: orgRow.id,
          organization_code: orgRow.organization_code,
          name: orgRow.name,
          is_active: orgRow.is_active ?? true,
        }
      : null;

    let uiSettings: OrganizationUISettings | null = null;
    if (organization) {
      const { data: uiRow } = await supabase
        .from("organization_ui_settings")
        .select("organization_id, logo_url, brand_name, primary_color, menu_config, home_cards_config, default_landing_path")
        .eq("organization_id", organization.id)
        .single();

      if (uiRow) {
        uiSettings = {
          organization_id: uiRow.organization_id,
          logo_url: uiRow.logo_url ?? null,
          brand_name: uiRow.brand_name ?? "생산관리",
          primary_color: uiRow.primary_color ?? null,
          menu_config: Array.isArray(uiRow.menu_config) ? uiRow.menu_config as OrganizationUISettings["menu_config"] : null,
          home_cards_config: uiRow.home_cards_config ?? null,
          default_landing_path: uiRow.default_landing_path ?? null,
        };
      }
    }

    setState((prev) => ({
      ...prev,
      profile,
      organization,
      uiSettings,
    }));
  }, []);

  const SESSION_CHECK_MS = 6000;
  const PROFILE_LOAD_MS = 12000;
  const LOADING_SAFETY_MS = 15000;

  useEffect(() => {
    let mounted = true;
    const safety = setTimeout(() => {
      if (!mounted) return;
      setState((prev) => {
        if (!prev.loading) return prev;
        if (prev.user && !prev.profile) {
          supabase.auth.signOut();
          return {
            user: null,
            profile: null,
            organization: null,
            uiSettings: null,
            loading: false,
            error: prev.error || "로딩 시간 초과. 다시 로그인해 주세요.",
          };
        }
        return { ...prev, loading: false };
      });
    }, LOADING_SAFETY_MS);
    return () => {
      mounted = false;
      clearTimeout(safety);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session?.user) {
        setState((prev) => ({ ...prev, user: session.user }));
      } else {
        setState({
          user: null,
          profile: null,
          organization: null,
          uiSettings: null,
          loading: false,
          error: null,
        });
      }
    });

    const timeoutPromise = new Promise<{ data: { session: null } }>((resolve) =>
      setTimeout(() => resolve({ data: { session: null } }), SESSION_CHECK_MS)
    );
    Promise.race([supabase.auth.getSession(), timeoutPromise])
      .then(({ data: { session } }) => {
        if (!mounted) return;
        if (session?.user) {
          setState((prev) => ({ ...prev, user: session.user, loading: true }));
          Promise.race([
            loadProfileAndOrg(session.user.id),
            new Promise<void>((_, reject) => setTimeout(() => reject(new Error("profile_load_timeout")), PROFILE_LOAD_MS)),
          ])
            .then(() => {
              if (mounted) setState((prev) => ({ ...prev, loading: false }));
            })
            .catch(async () => {
              if (mounted) {
                await supabase.auth.signOut();
                setState((prev) => ({
                  ...prev,
                  user: null,
                  profile: null,
                  organization: null,
                  uiSettings: null,
                  loading: false,
                  error: prev.error || "프로필 로드 시간 초과. 다시 로그인해 주세요.",
                }));
              }
            });
        } else {
          setState((prev) => ({ ...prev, loading: false }));
        }
      })
      .catch(() => {
        if (mounted) setState((prev) => ({ ...prev, loading: false }));
      });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfileAndOrg]);

  const signIn = useCallback(
    async (
      organizationCode: string,
      loginId: string,
      password: string,
      rememberMe: boolean
    ): Promise<{ error: string | null }> => {
      setState((prev) => ({ ...prev, error: null }));
      if (typeof window !== "undefined") {
        localStorage.setItem("rememberMe", rememberMe ? "true" : "false");
      }
      const code = organizationCode.trim();
      const id = loginId.trim();
      if (!code || !id) {
        const msg = "회사코드와 아이디를 입력하세요.";
        setState((prev) => ({ ...prev, error: msg }));
        return { error: msg };
      }
      const localPart = toAuthEmailLocal(id);
      if (!localPart) {
        setState((prev) => ({ ...prev, error: "아이디를 입력하세요." }));
        return { error: "아이디를 입력하세요." };
      }
      const email = `${localPart}@${code}${AUTH_EMAIL_SUFFIX}`;
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setState((prev) => ({ ...prev, error: error.message }));
        return { error: error.message };
      }
      if (data.user) {
        setState((prev) => ({ ...prev, user: data.user, loading: true, error: null }));
        try {
          await Promise.race([
            loadProfileAndOrg(data.user.id),
            new Promise((_, reject) => setTimeout(() => reject(new Error("profile_load_timeout")), 12000)),
          ]);
        } finally {
          setState((prev) => ({ ...prev, loading: false }));
        }
      }
      return { error: null };
    },
    [loadProfileAndOrg]
  );

  const signOut = useCallback(() => {
    setState({
      user: null,
      profile: null,
      organization: null,
      uiSettings: null,
      loading: false,
      error: null,
    });
    router.replace("/login");
    supabase.auth.signOut();
  }, [router]);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const setMustChangePasswordDone = useCallback(async (): Promise<{ error: string | null }> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "로그인이 필요합니다." };
    const { error } = await supabase
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", user.id);
    if (error) return { error: error.message };
    setState((prev) =>
      prev.profile ? { ...prev, profile: { ...prev.profile, must_change_password: false } } : prev
    );
    return { error: null };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signIn,
      signOut,
      clearError,
      setMustChangePasswordDone,
    }),
    [state, signIn, signOut, clearError, setMustChangePasswordDone]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
