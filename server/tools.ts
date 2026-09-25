import type Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import { z } from "zod";

// ---------- Definiciones de herramientas (orden estable: se cachean) ----------

export const TOOL_DEFS: Anthropic.Beta.BetaTool[] = [
  {
    name: "navigate",
    description: "Navega a una URL en el navegador del tester. Usala para abrir el sistema bajo prueba o cambiar de página.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "URL absoluta (https://...)" } },
      required: ["url"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "snapshot",
    description:
      "Devuelve la lista de elementos interactivos visibles de la página (links, botones, inputs, selects) con una referencia numérica (ref) que después podés usar en click/type/select. Llamala cuando necesites saber qué hay en pantalla o dónde hacer clic.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "click",
    description:
      "Hace clic en un elemento. Indicá UNO de: ref (de snapshot), selector (Playwright: css, text=..., role=button[name=\"...\"]) o coordenadas x,y de la captura (1280x800).",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: ["integer", "null"], description: "Referencia numérica obtenida con snapshot" },
        selector: { type: ["string", "null"], description: "Selector Playwright" },
        x: { type: ["number", "null"] },
        y: { type: ["number", "null"] },
        double: { type: "boolean", description: "Doble clic" },
      },
      required: ["ref", "selector", "x", "y", "double"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "type",
    description:
      "Escribe texto en un campo (lo limpia primero). Indicá ref o selector. Con press_enter=true presiona Enter al final.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: ["integer", "null"] },
        selector: { type: ["string", "null"] },
        text: { type: "string" },
        press_enter: { type: "boolean" },
      },
      required: ["ref", "selector", "text", "press_enter"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "select",
    description: "Selecciona una opción en un <select>, por valor o por texto visible. Indicá ref o selector.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: ["integer", "null"] },
        selector: { type: ["string", "null"] },
        value: { type: "string", description: "Valor o texto visible de la opción" },
      },
      required: ["ref", "selector", "value"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "press",
    description: "Presiona una tecla o combinación (Enter, Escape, Tab, Control+a, ArrowDown...).",
    input_schema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "scroll",
    description: "Hace scroll en la página.",
    input_schema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"] },
        amount: { type: "integer", description: "Pixels (por defecto 600)" },
      },
      required: ["direction", "amount"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "wait",
    description: "Espera unos milisegundos (máx 10000) o hasta que aparezca un selector. Útil después de acciones que disparan cargas.",
    input_schema: {
      type: "object",
      properties: {
        ms: { type: ["integer", "null"] },
        selector: { type: ["string", "null"] },
      },
      required: ["ms", "selector"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_text",
    description: "Devuelve el texto visible de la página (o de un selector) para leer contenido con precisión. Máximo 6000 caracteres.",
    input_schema: {
      type: "object",
      properties: { selector: { type: ["string", "null"] } },
      required: ["selector"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "screenshot",
    description: "Toma una captura nueva de la pantalla actual sin realizar ninguna acción.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "report_case",
    description:
      "Registra el resultado de un caso de prueba ya ejecutado. Llamala una vez por caso, inmediatamente después de terminarlo. Adjunta automáticamente la captura actual como evidencia.",
    input_schema: {
      type: "object",
      properties: {
        case_id: { type: "string", description: "Identificador del caso (ej: TC-03)" },
        title: { type: "string", description: "Título corto del caso" },
        status: { type: "string", enum: ["passed", "failed", "blocked", "skipped"] },
        steps: { type: "string", description: "Pasos ejecutados, resumidos" },
        notes: {
          type: "string",
          description: "Resultado observado vs esperado, defectos encontrados, motivo de bloqueo, etc.",
        },
      },
      required: ["case_id", "title", "status", "steps", "notes"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "finish",
    description: "Finaliza la sesión de prueba. Llamala solo cuando todos los casos hayan sido reportados.",
    input_schema: {
      type: "object",
      properties: { summary: { type: "string", description: "Resumen ejecutivo en español (markdown)" } },
      required: ["summary"],
      additionalProperties: false,
    },
    strict: true,
  },
];

// ---------- Validación de inputs (el parser tolerante puede truncar) ----------

const nInt = z.number().int().nullable();
const nStr = z.string().nullable();

export const INPUT_SCHEMAS = {
  navigate: z.object({ url: z.string().min(1) }),
  snapshot: z.object({}),
  click: z.object({
    ref: nInt.optional(),
    selector: nStr.optional(),
    x: z.number().nullable().optional(),
    y: z.number().nullable().optional(),
    double: z.boolean().optional(),
  }),
  type: z.object({ ref: nInt.optional(), selector: nStr.optional(), text: z.string(), press_enter: z.boolean().optional() }),
  select: z.object({ ref: nInt.optional(), selector: nStr.optional(), value: z.string() }),
  press: z.object({ key: z.string().min(1) }),
  scroll: z.object({ direction: z.enum(["up", "down"]), amount: z.number().int().optional() }),
  wait: z.object({ ms: nInt.optional(), selector: nStr.optional() }),
  get_text: z.object({ selector: nStr.optional() }),
  screenshot: z.object({}),
  report_case: z.object({
    case_id: z.string().min(1),
    title: z.string(),
    status: z.enum(["passed", "failed", "blocked", "skipped"]),
    steps: z.string(),
    notes: z.string(),
  }),
  finish: z.object({ summary: z.string() }),
} as const;

export type ToolName = keyof typeof INPUT_SCHEMAS;

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(INPUT_SCHEMAS, name);
}

// ---------- Ejecución sobre la página del tester ----------

export interface ToolOutcome {
  text: string;
  /** true si la acción cambió/pudo cambiar la pantalla (se adjunta captura) */
  visual: boolean;
  isError?: boolean;
}

const REF_ATTR = "data-ai-ref";

function locatorFor(page: Page, ref?: number | null, selector?: string | null) {
  if (ref != null) return page.locator(`[${REF_ATTR}="${ref}"]`).first();
  if (selector) return page.locator(selector).first();
  throw new Error("Indicá ref o selector");
}

async function settle(page: Page, ms = 1500) {
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: ms }).catch(() => {});
}

async function collectSnapshot(page: Page): Promise<string> {
  const items: string[] = await page.evaluate((attr) => {
    const out: string[] = [];
    const sel =
      'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="option"], [onclick], [contenteditable="true"], summary, label';
    const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
    let n = 0;
    const seen = new Set<HTMLElement>();
    for (const el of els) {
      if (seen.has(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
      const inView = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      if (!inView) continue;
      seen.add(el);
      n += 1;
      el.setAttribute(attr, String(n));
      const tag = el.tagName.toLowerCase();
      const type = (el as HTMLInputElement).type ? ` type=${(el as HTMLInputElement).type}` : "";
      const role = el.getAttribute("role") ? ` role=${el.getAttribute("role")}` : "";
      let label =
        el.getAttribute("aria-label") ||
        (el as HTMLInputElement).placeholder ||
        el.getAttribute("title") ||
        el.getAttribute("name") ||
        "";
      const id = el.id ? ` #${el.id}` : "";
      let text = (el.innerText || (el as HTMLInputElement).value || "").trim().replace(/\s+/g, " ");
      if (tag === "input" && (el as HTMLInputElement).type === "password") text = "";
      if (text.length > 60) text = text.slice(0, 57) + "...";
      const labelEl = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
      if (!label && labelEl) label = (labelEl as HTMLElement).innerText.trim();
      const href = tag === "a" ? ` href=${(el as HTMLAnchorElement).getAttribute("href")?.slice(0, 60)}` : "";
      const disabled = (el as HTMLButtonElement).disabled ? " [disabled]" : "";
      const checked = (el as HTMLInputElement).checked ? " [checked]" : "";
      out.push(
        `[${n}] <${tag}${type}${role}${id}>${label ? ` label="${label}"` : ""}${text ? ` "${text}"` : ""}${href}${disabled}${checked} @(${Math.round(r.x + r.width / 2)},${Math.round(r.y + r.height / 2)})`,
      );
      if (out.length >= 150) break;
    }
    return out;
  }, REF_ATTR);
  if (items.length === 0) return "(no se encontraron elementos interactivos visibles)";
  return items.join("\n");
}

export async function pageInfo(page: Page): Promise<{ url: string; title: string }> {
  const url = page.url();
  const title = await page.title().catch(() => "");
  return { url, title };
}

export async function executeTool(page: Page, name: ToolName, input: unknown): Promise<ToolOutcome> {
  const schema = INPUT_SCHEMAS[name] as z.ZodTypeAny;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      text: JSON.stringify({ INVALID_JSON: JSON.stringify(input), issues: parsed.error.issues }),
      visual: false,
      isError: true,
    };
  }
  const a = parsed.data as any;
  try {
    switch (name) {
      case "navigate": {
        await page.goto(a.url, { waitUntil: "domcontentloaded" });
        await settle(page, 2500);
        return { text: `Navegado a ${page.url()}`, visual: true };
      }
      case "snapshot": {
        return { text: await collectSnapshot(page), visual: false };
      }
      case "click": {
        if (a.ref == null && !a.selector && a.x != null && a.y != null) {
          if (a.double) await page.mouse.dblclick(a.x, a.y);
          else await page.mouse.click(a.x, a.y);
        } else {
          const loc = locatorFor(page, a.ref, a.selector);
          if (a.double) await loc.dblclick();
          else await loc.click();
        }
        await settle(page);
        return { text: "Clic realizado", visual: true };
      }
      case "type": {
        const loc = locatorFor(page, a.ref, a.selector);
        await loc.click({ timeout: 4000 }).catch(() => {});
        await loc.fill(a.text).catch(async () => {
          await loc.pressSequentially(a.text);
        });
        if (a.press_enter) await loc.press("Enter");
        await settle(page);
        return { text: `Texto ingresado${a.press_enter ? " + Enter" : ""}`, visual: true };
      }
      case "select": {
        const loc = locatorFor(page, a.ref, a.selector);
        try {
          await loc.selectOption({ value: a.value });
        } catch {
          await loc.selectOption({ label: a.value });
        }
        await settle(page);
        return { text: `Opción seleccionada: ${a.value}`, visual: true };
      }
      case "press": {
        await page.keyboard.press(a.key);
        await settle(page);
        return { text: `Tecla ${a.key} presionada`, visual: true };
      }
      case "scroll": {
        const amount = a.amount ?? 600;
        await page.mouse.wheel(0, a.direction === "down" ? amount : -amount);
        await page.waitForTimeout(400);
        return { text: `Scroll ${a.direction} ${amount}px`, visual: true };
      }
      case "wait": {
        if (a.selector) {
          await page.locator(a.selector).first().waitFor({ state: "visible", timeout: Math.min(a.ms ?? 8000, 15000) });
          return { text: `Apareció ${a.selector}`, visual: true };
        }
        await page.waitForTimeout(Math.min(Math.max(a.ms ?? 1000, 100), 10000));
        return { text: "Espera completada", visual: true };
      }
      case "get_text": {
        const text = a.selector
          ? await page.locator(a.selector).first().innerText()
          : await page.locator("body").innerText();
        const clean = text.replace(/\n{3,}/g, "\n\n").trim();
        return {
          text: clean.length > 6000 ? clean.slice(0, 6000) + "\n...(truncado)" : clean || "(sin texto)",
          visual: false,
        };
      }
      case "screenshot": {
        return { text: "Captura actual adjunta", visual: true };
      }
      case "report_case":
      case "finish": {
        // Manejados por el runner (necesitan estado); nunca llegan acá.
        return { text: "ok", visual: false };
      }
    }
  } catch (err: any) {
    const msg = String(err?.message ?? err).split("\n").slice(0, 4).join(" ");
    return { text: `Error al ejecutar ${name}: ${msg}`, visual: true, isError: true };
  }
  return { text: "ok", visual: false };
}

export async function takeScreenshot(page: Page): Promise<string> {
  const buf = await page.screenshot({ type: "jpeg", quality: 60, fullPage: false, timeout: 8000 });
  return buf.toString("base64");
}
