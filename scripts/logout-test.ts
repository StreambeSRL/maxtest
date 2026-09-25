// Prueba el botón de logout.
import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
const p = await ctx.newPage();
const base = process.env.URL || "http://localhost:4321";
await p.goto(base, { waitUntil: "networkidle" });
await p.getByPlaceholder("Contraseña").fill(process.env.ACCESS_PASSWORD || "prueba123");
await p.getByRole("button", { name: "Entrar" }).click();
await p.waitForSelector(".sidebar");
const api = async () => (await p.request.get(`${base}/api/testers`)).status();
console.log("logueado: botón Salir visible =", await p.getByTitle("Cerrar sesión").isVisible(), "| API =", await api());
await p.screenshot({ path: "data/logout-antes.png", clip: { x: 1120, y: 0, width: 380, height: 110 } });
await p.getByTitle("Cerrar sesión").click();
await p.waitForSelector('input[placeholder="Contraseña"]');
console.log("tras Salir: pantalla de login =", await p.getByPlaceholder("Contraseña").isVisible(), "| API =", await api());
await p.reload({ waitUntil: "networkidle" });
console.log("tras recargar: sigue en login =", await p.getByPlaceholder("Contraseña").isVisible());
await b.close();
