import type { Metadata } from "next";
import Header from "./components/Header";
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
        <div className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 w-full bg-space-900">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
