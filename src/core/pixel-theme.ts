import { addStyle } from "./storage";

/** Shared 16-bit SNES Starlight RPG pixel design tokens & reusable utility classes. */
export function mountPixelTheme(): void {
  addStyle(
    "core-pixel-theme",
    `
    :root {
      --mwi-px-panel-bg: linear-gradient(180deg, #121c3b 0%, #0c1228 100%);
      --mwi-px-card-bg: linear-gradient(180deg, #17244d 0%, #0e1634 100%);
      --mwi-px-head-bg: linear-gradient(180deg, #1d2c5e 0%, #141f46 100%);
      --mwi-px-btn-bg: linear-gradient(180deg, #324a8f 0%, #22356b 100%);
      --mwi-px-btn-hover: linear-gradient(180deg, #405eb3 0%, #2b4385 100%);
      --mwi-px-btn-green: linear-gradient(180deg, #1f6d43 0%, #165132 100%);
      --mwi-px-btn-green-hover: linear-gradient(180deg, #278452 0%, #1d643e 100%);
      --mwi-px-btn-gold: linear-gradient(180deg, #7c580c 0%, #523907 100%);
      --mwi-px-border: #9dbbff;
      --mwi-px-border-bright: #d5e5ff;
      --mwi-px-border-inner: #4f6fc4;
      --mwi-px-border-dark: #070b16;
      --mwi-px-text: #e2e8f0;
      --mwi-px-sub: #9dbbff;
      --mwi-px-muted: #7f95cc;
      --mwi-px-green: #4ade80;
      --mwi-px-green-soft: #86efac;
      --mwi-px-gold: #fde047;
      --mwi-px-accent: #93c5fd;
      --mwi-px-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --mwi-px-shadow-panel: 0 0 0 2px #060913, 0 14px 36px rgba(0, 0, 0, 0.72), inset 0 0 0 2px #1c2b59, inset 0 0 0 4px #4f6fc4;
      --mwi-px-shadow-card: 0 0 0 2px #070b16, inset 0 0 0 2px #293e7a, inset 0 1px 0 2px #5273c7;
      --mwi-px-shadow-btn: 0 0 0 1px #080d1a, inset 1px 1px 0 #7096ee, inset -1px -1px 0 #152147;
    }
    `
  );
}

/** 16×16 SNES Starlight Raven pixel art SVG paths (`shape-rendering="crispEdges"`). */
export const HUGUNN_ICON_PATHS =
  '<path fill="#070b16" d="M6 1h5v1H6zM5 2h1v1H5zM11 2h1v1H11zM4 3h1v1H4zM12 3h1v1H12zM4 4h1v1H4zM12 4h3v1H12zM3 5h1v1H3zM10 5h1v1H10zM15 5h1v1H15zM3 6h1v1H3zM10 6h1v1H10zM15 6h1v1H15zM2 7h1v1H2zM10 7h5v1H10zM2 8h1v1H2zM10 8h1v1H10zM1 9h1v1H1zM9 9h1v1H9zM1 10h1v1H1zM4 10h2v1H4zM8 10h1v1H8zM2 11h2v1H2zM6 11h3v1H6z"/><path fill="#121c3b" d="M9 5h1v1H9zM3 7h1v1H3zM3 8h2v1H3zM9 8h1v1H9zM2 9h3v1H2zM8 9h1v1H8zM2 10h2v1H2zM6 10h2v1H6z"/><path fill="#25418c" d="M8 3h1v1H8zM7 4h2v1H7zM10 4h1v1H10zM7 5h2v1H7zM5 6h2v1H5zM9 6h1v1H9zM5 7h3v1H5zM9 7h1v1H9zM6 8h3v1H6zM6 9h2v1H6z"/><path fill="#4f7ce8" d="M6 2h4v1H6zM5 3h1v1H5zM5 4h1v1H5zM4 5h2v1H4zM4 6h1v1H4zM7 6h2v1H7zM4 7h1v1H4zM8 7h1v1H8zM5 8h1v1H5zM5 9h1v1H5z"/><path fill="#9dbbff" d="M10 2h1v1H10zM6 3h2v1H6zM6 4h1v1H6zM6 5h1v1H6z"/><path fill="#38bdf8" d="M11 3h1v1H11zM9 4h1v1H9zM11 4h1v1H11z"/><path fill="#ffffff" d="M9 3h2v1H9z"/><path fill="#fde047" d="M2 0h1v1H2zM11 5h4v1H11zM14 11h1v1H14z"/><path fill="#f59e0b" d="M11 6h2v1H11zM5 12h1v1H5zM8 12h1v1H8zM4 13h2v1H4zM8 13h2v1H8z"/><path fill="#b45309" d="M13 6h2v1H13z"/>';

/** Render an inline crisp-edge Hugunn pixel icon SVG. */
export function getHugunnIconSvg(size = 16): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true" style="display:inline-block;flex:0 0 auto;image-rendering:pixelated">${HUGUNN_ICON_PATHS}</svg>`;
}
