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
