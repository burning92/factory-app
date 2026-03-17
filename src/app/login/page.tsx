"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function LoginPage() {
  const router = useRouter();
  const { signIn, error, clearError } = useAuth();
  const [organizationCode, setOrganizationCode] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    setLoading(true);
    const { error: err } = await signIn(
      organizationCode.trim(),
      loginId.trim(),
      password,
      rememberMe
    );
    setLoading(false);
    if (!err) {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-space-900">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-xl font-semibold text-slate-100 text-center">로그인</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="organizationCode" className="block text-xs text-slate-400 mb-1">
              회사코드
            </label>
            <input
              id="organizationCode"
              type="text"
              inputMode="numeric"
              autoComplete="organization-code"
              value={organizationCode}
              onChange={(e) => setOrganizationCode(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm bg-space-800 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              placeholder="예: 100 (관리자: 000)"
            />
          </div>
          <div>
            <label htmlFor="loginId" className="block text-xs text-slate-400 mb-1">
              아이디
            </label>
            <input
              id="loginId"
              type="text"
              autoComplete="username"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm bg-space-800 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              placeholder="예: 홍길동01 또는 하랑01"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs text-slate-400 mb-1">
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm bg-space-800 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="rememberMe"
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-space-800 text-cyan-500 focus:ring-cyan-500"
            />
            <label htmlFor="rememberMe" className="text-sm text-slate-400">
              로그인 유지 (체크 해제 시 브라우저를 닫으면 로그아웃됩니다)
            </label>
          </div>
          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-cyan-500 text-space-900 font-medium text-sm hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "로그인 중…" : "로그인"}
          </button>
        </form>
        <p className="text-center text-slate-500 text-xs">
          계정이 없으면 관리자에게 문의하세요.
        </p>
      </div>
    </div>
  );
}
