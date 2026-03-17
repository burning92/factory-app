import type { Metadata } from "next";
import { AuthProvider } from "@/contexts/AuthContext";
import AppShell from "./components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "생산관리 시스템",
  description: "출고 입력, 사용량 계산, 반죽사용량, 기준 정보, 관리일지",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen bg-space-900 text-slate-100 antialiased">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
