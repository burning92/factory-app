"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AdminPage from "@/app/admin/page";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminLikeRole } from "@/lib/roles";

export default function ProductionAdminPage() {
  const router = useRouter();
  const { profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!isAdminLikeRole(profile?.role)) {
      router.replace("/");
    }
  }, [loading, profile?.role, router]);

  if (loading || !isAdminLikeRole(profile?.role)) {
    return null;
  }

  return <AdminPage />;
}
