/** 작성·수정 화면 상단: 지금 이 일지를 수정할 수 없는 이유 */
export default function DailyLogLockNotice({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-amber-900/20 border border-amber-700/50 text-amber-200" role="status">
      {reason}
    </div>
  );
}
