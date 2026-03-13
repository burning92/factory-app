import { redirect } from "next/navigation";

/**
 * 예전 경로 /journal/print 접근 시 홈으로 리다이렉트합니다.
 */
export default function JournalPrintRedirect() {
  redirect("/");
}
