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
import type { Organization, OrganizationUISettings, Profile } from "@/types/auth";

interface AuthState {
  user: User | null;
  profile: Profile | null;
  organization: Organization | null;
  uiSettings: OrganizationUISettings | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  ensureProfile: (userId: string, email: string) => Promise<{ error: string | null }>;
  clearError: () => void;
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

  const loadProfileAndOrg = useCallback(async (userId: string) => {
    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select("id, organization_id, display_name, role, is_active")
      .eq("id", userId)
      .single();

    if (profileError || !profileRow) {
      return;
    }

    const profile: Profile = {
      id: profileRow.id,
      organization_id: profileRow.organization_id,
      display_name: profileRow.display_name ?? null,
      role: profileRow.role as Profile["role"],
      is_active: profileRow.is_active ?? true,
    };

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

  const ensureProfile = useCallback(
    async (userId: string, email: string): Promise<{ error: string | null }> => {
      const { data: existing } = await supabase.from("profiles").select("id").eq("id", userId).single();
      if (existing) {
        return { error: null };
      }

      const { data: defaultOrg } = await supabase
        .from("organizations")
        .select("id")
        .eq("organization_code", "armored")
        .limit(1)
        .single();

      if (!defaultOrg) {
        return { error: "기본 조직이 없습니다." };
      }

      const { error } = await supabase.from("profiles").insert({
        id: userId,
        organization_id: defaultOrg.id,
        display_name: email?.split("@")[0] ?? "user",
        role: "worker",
        is_active: true,
      });

      if (error) {
        return { error: error.message };
      }
      await loadProfileAndOrg(userId);
      return { error: null };
    },
    [loadProfileAndOrg]
  );

  useEffect(() => {
    let mounted = true;

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      if (session?.user) {
        setState((prev) => ({ ...prev, user: session.user, loading: true, error: null }));
        await loadProfileAndOrg(session.user.id);
        setState((prev) => ({ ...prev, loading: false }));
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

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        setState((prev) => ({ ...prev, user: session.user, loading: true }));
        loadProfileAndOrg(session.user.id).then(() => {
          if (mounted) setState((prev) => ({ ...prev, loading: false }));
        });
      } else {
        setState((prev) => ({ ...prev, loading: false }));
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfileAndOrg]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      setState((prev) => ({ ...prev, error: null }));
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setState((prev) => ({ ...prev, error: error.message }));
        return { error: error.message };
      }
      if (data.user) {
        const { error: ensureErr } = await ensureProfile(data.user.id, data.user.email ?? "");
        if (ensureErr) {
          setState((prev) => ({ ...prev, error: ensureErr }));
          return { error: ensureErr };
        }
      }
      return { error: null };
    },
    [ensureProfile]
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setState({
      user: null,
      profile: null,
      organization: null,
      uiSettings: null,
      loading: false,
      error: null,
    });
    router.push("/login");
  }, [router]);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signIn,
      signOut,
      ensureProfile,
      clearError,
    }),
    [state, signIn, signOut, ensureProfile, clearError]
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
