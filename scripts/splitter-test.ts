// Prueba el divisor redimensionable del panel inferior.
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
await p.goto(process.env.URL || "http://localhost:4321", { waitUntil: "networkidle" });
const pw = p.getByPlaceholder("Contraseña");
if (await pw.count()) {
  await pw.fill(process.env.ACCESS_PASSWORD || "prueba123");
  await p.getByRole("button", { name: "Entrar" }).click();
}
await p.waitForSelector(".tester-card");
await p.locator(".tester-card").first().click();
await p.waitForSelector(".splitter");
await p.evaluate(() => localStorage.removeItem("ait.panelSplit"));
await p.reload({ waitUntil: "networkidle" });
await p.locator(".tester-card").first().click();

const h = async () => {
  const panel = await p.locator(".panel").boundingBox();
  const screen = await p.locator(".screen").boundingBox().catch(() => null);
  return `panel=${panel ? Math.round(panel.height) : "oculto"} pantalla=${screen ? Math.round(screen.height) : "oculta"}`;
};
console.log("inicial        ", await h());

const s = (await p.locator(".splitter").boundingBox())!;
await p.mouse.move(s.x + 200, s.y + s.height / 2);
await p.mouse.down();
await p.mouse.move(s.x + 200, s.y - 250, { steps: 10 });
await p.mouse.up();
console.log("arrastre arriba", await h());
await p.screenshot({ path: "data/split-grande.png" });

const s2 = (await p.locator(".splitter").boundingBox())!;
await p.mouse.move(s2.x + 200, s2.y + s2.height / 2);
await p.mouse.down();
await p.mouse.move(s2.x + 200, s2.y + 380, { steps: 10 });
await p.mouse.up();
console.log("arrastre abajo ", await h());

await p.getByTitle("Ocultar panel").click();
console.log("ocultar        ", await p.locator(".panel").isVisible() ? "VISIBLE (mal)" : "oculto ok", await h());
await p.screenshot({ path: "data/split-oculto.png" });

await p.getByTitle("Mostrar panel").click();
console.log("mostrar        ", await h());

await p.getByTitle("Maximizar panel").click();
console.log("maximizar      ", await h());
await p.screenshot({ path: "data/split-max.png" });

await p.getByTitle("Restaurar").click();
console.log("restaurar      ", await h());

await p.reload({ waitUntil: "networkidle" });
await p.locator(".tester-card").first().click();
console.log("tras recargar  ", await h());

await p.locator(".splitter").dblclick({ position: { x: 100, y: 7 } });
console.log("doble clic     ", await p.locator(".panel").isVisible() ? "visible" : "oculto");
await p.locator(".splitter").dblclick({ position: { x: 100, y: 7 } });
console.log("doble clic     ", await p.locator(".panel").isVisible() ? "visible" : "oculto");
await b.close();
