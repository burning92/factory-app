import Link from "next/link";
import PlanningBoardClient from "./PlanningBoardClient";

export const dynamic = "force-dynamic";

export default function ProductionPlanningPage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] p-4 md:px-6 md:py-6 lg:px-10 max-w-[min(100%,95rem)] mx-auto">
      <div className="mb-4">
        <Link href="/production" className="text-sm text-cyan-400 hover:underline">
          ← 생산 허브
        </Link>
      </div>
      <PlanningBoardClient />
    </div>
  );
}
