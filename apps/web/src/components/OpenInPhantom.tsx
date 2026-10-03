"use client";
import { useEffect, useState } from "react";
/** On phones without an injected wallet, offer to reopen this page inside Phantom's browser. */
export function OpenInPhantom() {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    const w = window as unknown as { phantom?: unknown; solana?: unknown };
    const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    if (mobile && !w.phantom && !w.solana) {
      setHref(`https://phantom.app/ul/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`);
    }
  }, []);
  if (!href) return null;
  return <a href={href} className="block rounded-lg bg-violet-600 px-4 py-3 text-center font-semibold text-white">Open in Phantom to sign</a>;
}
