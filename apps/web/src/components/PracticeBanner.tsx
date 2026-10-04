import { PRACTICE_BANNER } from "@pot/core";
export function PracticeBanner({ what = "No USDC or SOL moves. Your wallet signs a free message instead of a transaction." }: { what?: string }) {
  return (
    <div className="rounded-lg border border-amber-400/60 bg-amber-400/15 px-3 py-2 text-sm text-amber-100" role="status" data-testid="practice-banner">
      <b>🧪 {PRACTICE_BANNER}.</b> {what}
    </div>
  );
}
