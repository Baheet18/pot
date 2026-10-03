export function PoweredByPanta({ className = "" }: { className?: string }) {
  return (
    <a href="https://www.panta.market/" target="_blank" rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 rounded-full border border-violet-400/40 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-200 hover:bg-violet-500/20 ${className}`}>
      <span className="inline-block h-2 w-2 rounded-full bg-violet-400" aria-hidden />
      Powered by Panta
    </a>
  );
}
