// Captura la interfaz servida en localhost para verificación visual.
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
await p.goto(process.env.URL || "http://localhost:4321", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
await p.screenshot({ path: "data/ui-home.png" });
const tab = p.getByRole("button", { name: /Resultados/ });
if (await tab.count()) { await tab.click(); await p.waitForTimeout(300); await p.screenshot({ path: "data/ui-results.png" }); }
await b.close();
console.log("ok");
