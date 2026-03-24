"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AdminPage from "@/app/admin/page";
import { useAuth } from "@/contexts/AuthContext";

export default function ProductionAdminPage() {
  const router = useRouter();
  const { profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (profile?.role !== "admin") {
      router.replace("/");
    }
  }, [loading, profile?.role, router]);

  if (loading || profile?.role !== "admin") {
    return null;
  }

  return <AdminPage />;
}
