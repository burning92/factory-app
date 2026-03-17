"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { toAuthEmailLocal } from "@/lib/authEmail";

const AUTH_EMAIL_SUFFIX = ".local";

export default function AccountChangePasswordPage() {
  const { user, profile, organization } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const confirmMismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 6) {
      setError("새 비밀번호는 6자 이상이어야 합니다.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("새 비밀번호가 일치하지 않습니다.");
      return;
    }
    if (!user || !profile || !organization) {
      setError("로그인 정보를 불러올 수 없습니다.");
      return;
    }

    setLoading(true);

    if (currentPassword.trim()) {
      const localPart = toAuthEmailLocal(profile.login_id);
      const email = `${localPart}@${organization.organization_code}${AUTH_EMAIL_SUFFIX}`;
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (signInError) {
        setLoading(false);
        setError("현재 비밀번호가 올바르지 않습니다.");
        return;
      }
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setSuccess(true);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  if (!user) {
    return (
      <div className="p-6 max-w-sm mx-auto">
        <p className="text-slate-500 text-sm">로그인이 필요합니다.</p>
        <Link href="/login" className="text-cyan-400 text-sm mt-2 inline-block">
          로그인
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="p-6 max-w-sm mx-auto space-y-4">
        <h1 className="text-xl font-semibold text-slate-100">비밀번호 변경</h1>
        <p className="text-slate-300 text-sm">
          비밀번호가 변경되었습니다. 다음 로그인부터 새 비밀번호를 사용하세요.
        </p>
        <Link
          href="/"
          className="inline-block py-2 px-4 rounded-lg bg-cyan-500 text-space-900 font-medium text-sm hover:bg-cyan-400"
        >
          홈으로
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-sm mx-auto">
      <h1 className="text-xl font-semibold text-slate-100 mb-1">비밀번호 변경</h1>
      <p className="text-slate-400 text-sm mb-6">
        본인 계정의 비밀번호를 변경합니다.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="currentPassword" className="block text-xs text-slate-400 mb-1">
            현재 비밀번호 (선택)
          </label>
          <div className="relative flex items-center">
            <input
              id="currentPassword"
              type={showCurrent ? "text" : "password"}
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 pr-10 text-sm bg-space-800 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              placeholder="본인 확인 시 입력"
            />
            <button
              type="button"
              onClick={() => setShowCurrent((v) => !v)}
              className="absolute right-2 p-1.5 text-slate-400 hover:text-slate-200 rounded"
              aria-label={showCurrent ? "숨기기" : "보기"}
            >
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="newPassword" className="block text-xs text-slate-400 mb-1">
            새 비밀번호 <span className="text-red-400">*</span>
          </label>
          <div className="relative flex items-center">
            <input
              id="newPassword"
              type={showNew ? "text" : "password"}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2 pr-10 text-sm bg-space-800 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              placeholder="6자 이상"
            />
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              className="absolute right-2 p-1.5 text-slate-400 hover:text-slate-200 rounded"
              aria-label={showNew ? "숨기기" : "보기"}
            >
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="confirmPassword" className="block text-xs text-slate-400 mb-1">
            새 비밀번호 확인 <span className="text-red-400">*</span>
          </label>
          <div className="relative flex items-center">
            <input
              id="confirmPassword"
              type={showConfirm ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              className={`w-full px-3 py-2 pr-10 text-sm bg-space-800 border rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 ${
                confirmMismatch ? "border-red-500" : "border-slate-600"
              }`}
              placeholder="다시 입력"
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-2 p-1.5 text-slate-400 hover:text-slate-200 rounded"
              aria-label={showConfirm ? "숨기기" : "보기"}
            >
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {confirmMismatch && (
            <p className="text-red-400 text-xs mt-1" role="alert">
              새 비밀번호와 일치하지 않습니다.
            </p>
          )}
        </div>
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading || confirmMismatch}
          className="w-full py-2.5 rounded-lg bg-cyan-500 text-space-900 font-medium text-sm hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "변경 중…" : "비밀번호 변경"}
        </button>
      </form>
    </div>
  );
}
