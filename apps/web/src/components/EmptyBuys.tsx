export function EmptyBuys({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "text-sm text-stone-400" : "card p-6 text-center"}>
      <p className={compact ? "" : "text-lg font-semibold text-stone-200"}>No buys yet. Share a market in your group to get started.</p>
      {!compact && (
        <>
          <p className="mt-2 text-sm text-stone-400">Add Pot to your Telegram group, type <code className="rounded bg-white/10 px-1">/new</code> with a question, and share the card. Every buy shows up here.</p>
          <a href="https://t.me/pantapotbot?startgroup=true" className="mt-4 inline-block rounded-lg bg-amber-400 px-4 py-2 font-bold text-black">Add Pot to a group</a>
        </>
      )}
    </div>
  );
}
