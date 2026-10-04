export const fmtUsd = (x: number | null | undefined, digits?: number) => {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const d = digits ?? (Math.abs(x) >= 100 ? 0 : 2);
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};
export const fmtPct = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(digits)}%`;
export const fmtPrice = (x: number | null | undefined) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : `${Math.round(x * 100)}¢`;
export function fmtAge(hours: number | null | undefined) {
  if (hours === null || hours === undefined) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
/** Times are shown in WAT (Africa/Lagos), the builder's zone. */
export function fmtTime(unix: number | null | undefined) {
  if (!unix) return "—";
  const d = new Date(unix * 1000);
  const year = (x: Date) => x.toLocaleString("en-GB", { timeZone: "Africa/Lagos", year: "numeric" });
  const sameYear = year(d) === year(new Date());
  return (
    d.toLocaleString("en-GB", {
      timeZone: "Africa/Lagos",
      day: "2-digit",
      month: "short",
      ...(sameYear ? {} : { year: "numeric" }),
      hour: "2-digit",
      minute: "2-digit",
    }) + " WAT"
  );
}
export const phaseLabel = (phase: string, isGraduated: boolean) =>
  phase === "primary"
    ? "Buy-only phase"
    : phase === "secondary"
      ? "Graduated (order book)"
      : phase === "resolved"
        ? "Resolved"
        : phase === "cancelled"
          ? "Cancelled"
          : isGraduated
            ? "Graduated"
            : phase;
