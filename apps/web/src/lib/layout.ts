/**
 * Two-column page grids (main + side panel on desktop, stacked on phones).
 * Tracks use minmax(0,1fr), not a bare/implicit auto track, so a long title or link can't stretch the column past
 * the screen: with an auto track the market page was 635px wide on a 390px phone and scrolled sideways.
 */
export const MARKET_GRID = "grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_380px]";
export const CREATE_GRID = "mx-auto grid max-w-4xl grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_340px]";
