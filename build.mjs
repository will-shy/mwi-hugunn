import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

function buildHugunnIconDataUri() {
  const src = fs.readFileSync(path.resolve("src/core/pixel-theme.ts"), "utf8");
  const match = src.match(/export const HUGUNN_ICON_PATHS =\s*(['"`])([\s\S]*?)\1;/);
  if (!match) {
    throw new Error("Missing HUGUNN_ICON_PATHS in src/core/pixel-theme.ts");
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="32" height="32" shape-rendering="crispEdges">${match[2]}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

const iconDataUri = buildHugunnIconDataUri();

const banner = `// ==UserScript==
// @name         MWI · Hugunn
// @name:zh-CN   MWI · Hugunn
// @namespace    https://milkywayidle.com/mwi-hugunn
// @version      1.1.0
// @description  MWI · Hugunn — Lightweight high-performance userscript for Milky Way Idle: market shortcuts & quick ops, volume & magic sort, item planner, queue next, lazy Monte-Carlo labyrinth calculator & light combat stats.
// @description:zh-CN MWI · Hugunn — 高性能轻量 MWI 聚合增强插件：市场快捷导航与强化档位跳转、挂单魔法排序、交易量均价、市场快捷操作、悬浮窗估价/净资产、完成倒计时、队列设为下一步、物品规划计算器、按需蒙特卡洛迷宫胜率与轻量战斗统计。
// @author       xhy
// @license      MIT
// @homepageURL  https://github.com/xiahuaaaa/mwi-hugunn
// @downloadURL  https://raw.githubusercontent.com/xiahuaaaa/mwi-hugunn/main/dist/mwi-hugunn.user.js
// @updateURL    https://raw.githubusercontent.com/xiahuaaaa/mwi-hugunn/main/dist/mwi-hugunn.user.js
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://test.milkywayidlecn.com/*
// @icon         ${iconDataUri}
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      q7.nainai.eu.org
// @connect      milkywayidle.com
// @connect      www.milkywayidle.com
// @connect      raw.githubusercontent.com
// @connect      shykai.github.io
// ==/UserScript==
`;

fs.mkdirSync(path.resolve("dist"), { recursive: true });

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/mwi-hugunn.user.js",
  bundle: true,
  format: "iife",
  target: "es2022",
  charset: "utf8",
  legalComments: "none",
  minify: false,
  banner: { js: banner },
});

const outPath = path.resolve("dist/mwi-hugunn.user.js");
const stat = fs.statSync(outPath);
console.log(`Built ${outPath} (${(stat.size / 1024).toFixed(1)} KB)`);
