// Captura la interfaz servida en localhost para verificación visual.
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
const base = process.env.URL || "http://localhost:4321";
await p.goto(base, { waitUntil: "networkidle" });
await p.waitForTimeout(600);
await p.screenshot({ path: "data/ui-login.png" });
const pw = p.getByPlaceholder("Contraseña");
if (await pw.count()) {
  await pw.fill(process.env.ACCESS_PASSWORD || "prueba123");
  await p.getByRole("button", { name: "Entrar" }).click();
  await p.waitForTimeout(1200);
}
await p.screenshot({ path: "data/ui-home.png" });
await p.getByText("+ Agregar tester").click();
await p.waitForTimeout(400);
await p.screenshot({ path: "data/ui-form.png" });
await p.keyboard.press("Escape");
await p.getByRole("button", { name: "✕" }).first().click().catch(() => {});
await p.waitForTimeout(300);
const rep = p.getByRole("button", { name: /Reporte consolidado/ });
if (await rep.count()) {
  await rep.click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: "data/ui-report.png" });
}
await b.close();
console.log("ok");
