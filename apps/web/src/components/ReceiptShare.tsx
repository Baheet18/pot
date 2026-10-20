"use client";
import { useState } from "react";

/** Share a settled market's receipt: native share sheet when available, else copy the link; plus an X intent. */
export function ReceiptShare({ url, text, xUrl }: { url: string; text: string; xUrl: string }) {
  const [note, setNote] = useState<string | null>(null);
  async function share() {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: "Pot receipt", text, url }); return; } catch (e) { if ((e as Error).name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(`${text} ${url}`); setNote("Link copied."); } catch { setNote("Copy failed. Use the link below."); }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={share} data-testid="receipt-share" className="rounded-lg bg-amber-400 px-3 py-2 font-bold text-black">📤 Share receipt</button>
      <a href={xUrl} target="_blank" rel="noopener noreferrer" data-testid="receipt-share-x" className="rounded-lg bg-white px-3 py-2 font-bold text-black">𝕏 Share on X</a>
      {note && <span role="status" data-testid="receipt-share-note" className="text-xs text-stone-300">{note}</span>}
    </div>
  );
}
