import Link from "next/link";

export function DashboardBackLink() {
  return (
    <Link
      href="/executive"
      className="inline-flex text-sm text-cyan-400 hover:text-cyan-300 mb-4"
    >
      ← 대시보드로
    </Link>
  );
}
