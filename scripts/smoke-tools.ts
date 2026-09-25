// Prueba local de las herramientas de navegador sin usar la API de Claude.
// Uso: npx tsx scripts/smoke-tools.ts
import { browserPool } from "../server/browser.js";
import { executeTool, takeScreenshot, pageInfo } from "../server/tools.js";
import fs from "node:fs";

const { context, page } = await browserPool.newSession();
const log = (name: string, r: { text: string; isError?: boolean }) =>
  console.log(`${r.isError ? "✗" : "✓"} ${name}: ${r.text.split("\n").slice(0, 3).join(" | ").slice(0, 200)}`);

log("navigate", await executeTool(page, "navigate", { url: "https://www.saucedemo.com" }));
const snap = await executeTool(page, "snapshot", {});
log("snapshot", snap);
log("type user", await executeTool(page, "type", { selector: "#user-name", text: "standard_user", press_enter: false }));
log("type pass", await executeTool(page, "type", { selector: "#password", text: "secret_sauce", press_enter: true }));
console.log("  →", await pageInfo(page));
const snap2 = await executeTool(page, "snapshot", {});
const backpackRef = snap2.text.split("\n").find((l) => /add-to-cart-sauce-labs-backpack/.test(l))?.match(/^\[(\d+)\]/)?.[1];
log("click backpack ref", await executeTool(page, "click", { ref: backpackRef ? Number(backpackRef) : null, selector: backpackRef ? null : "#add-to-cart-sauce-labs-backpack" }));
log("get_text badge", await executeTool(page, "get_text", { selector: ".shopping_cart_badge" }));
log("click cart", await executeTool(page, "click", { selector: ".shopping_cart_link" }));
log("get_text cart", await executeTool(page, "get_text", { selector: ".cart_item" }));
log("invalid input", await executeTool(page, "click", { ref: "x" }));
log("bad selector", await executeTool(page, "click", { selector: "#no-existe" }));
const shot = await takeScreenshot(page);
fs.writeFileSync("data/smoke-tools.jpg", Buffer.from(shot, "base64"));
console.log(`screenshot ${Math.round(shot.length * 0.75 / 1024)} KB → data/smoke-tools.jpg`);
await context.close();
await browserPool.shutdown();
