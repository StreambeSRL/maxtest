// Captura la interfaz servida en localhost para verificación visual.
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
await p.goto(process.env.URL || "http://localhost:4321", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
await p.screenshot({ path: "data/ui-home.png" });
// abrir el formulario de alta
await p.getByText("+ Agregar tester").click();
await p.waitForTimeout(400);
await p.screenshot({ path: "data/ui-form.png" });
await b.close();
console.log("ok");
