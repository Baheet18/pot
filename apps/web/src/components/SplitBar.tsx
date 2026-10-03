export function SplitBar({ yesSplit, label }: { yesSplit: number | null; label?: string }) {
  if (yesSplit === null) return <div className="text-xs text-stone-400">No money split yet</div>;
  const y = Math.round(yesSplit * 100);
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-stone-800" title={`${y}% YES / ${100 - y}% NO`}>
        <div className="bg-emerald-400" style={{ width: `${y}%` }} />
        <div className="bg-rose-400" style={{ width: `${100 - y}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-stone-400">
        <span>YES {y}%</span>{label && <span>{label}</span>}<span>NO {100 - y}%</span>
      </div>
    </div>
  );
}
