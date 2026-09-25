import Anthropic from "@anthropic-ai/sdk";
import { EventEmitter } from "node:events";
import type { BrowserContext, Page } from "playwright";
import type { CaseResult, LogEntry, ServerEvent, TesterConfig, TesterRunState, TesterStatus } from "../shared/types.js";
import { browserPool } from "./browser.js";
import { SENIOR_TESTER_SYSTEM, buildTaskMessage } from "./prompt.js";
import { TOOL_DEFS, executeTool, isToolName, pageInfo, takeScreenshot } from "./tools.js";

const MODEL = process.env.TESTER_MODEL || "claude-opus-5";
const EFFORT = (process.env.TESTER_EFFORT || "medium") as "low" | "medium" | "high" | "xhigh" | "max";
const MAX_TURNS = Number(process.env.TESTER_MAX_TURNS || 200);
const MAX_LOGS = 400;

const client = new Anthropic();

export function emptyRun(): TesterRunState {
  return {
    status: "idle",
    results: [],
    logs: [],
    turns: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

/**
 * Un TesterRunner = un tester independiente: su propio BrowserContext,
 * su propia conversación con Claude y su propio ciclo de vida.
 */
export class TesterRunner extends EventEmitter {
  run: TesterRunState;
  private abort: AbortController | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private pauseGate: Promise<void> | null = null;
  private resumeFn: (() => void) | null = null;
  private logSeq = 0;
  private lastShot: string | undefined;

  constructor(public config: TesterConfig, run?: TesterRunState) {
    super();
    this.run = run ?? emptyRun();
    if (this.run.status === "running" || this.run.status === "starting" || this.run.status === "paused" || this.run.status === "stopping") {
      this.run.status = "stopped"; // el proceso se reinició con una corrida en curso
    }
  }

  get isActive() {
    return ["starting", "running", "paused", "stopping"].includes(this.run.status);
  }

  private emitEvent(ev: ServerEvent) {
    this.emit("event", ev);
  }

  private setStatus(status: TesterStatus, extra: { error?: string; summary?: string } = {}) {
    this.run.status = status;
    if (extra.error !== undefined) this.run.error = extra.error;
    if (extra.summary !== undefined) this.run.summary = extra.summary;
    this.emitEvent({ type: "status", id: this.config.id, status, ...extra });
  }

  log(kind: LogEntry["kind"], text: string) {
    const entry: LogEntry = { id: ++this.logSeq, at: new Date().toISOString(), kind, text };
    this.run.logs.push(entry);
    if (this.run.logs.length > MAX_LOGS) this.run.logs.splice(0, this.run.logs.length - MAX_LOGS);
    this.emitEvent({ type: "log", id: this.config.id, entry });
  }

  // ---------------- Controles ----------------

  async start() {
    if (this.isActive) return;
    this.run = emptyRun();
    this.logSeq = 0;
    this.run.startedAt = new Date().toISOString();
    this.abort = new AbortController();
    this.setStatus("starting");
    this.emitEvent({ type: "tester_upsert", tester: { config: this.config, run: this.run } });
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      const msg = "Falta ANTHROPIC_API_KEY: cargala en el archivo .env (ver .env.example) y reiniciá el servidor.";
      this.log("error", msg);
      this.setStatus("error", { error: msg });
      return;
    }
    this.loop().catch((err) => {
      this.log("error", `Fallo inesperado: ${err?.message ?? err}`);
      this.setStatus("error", { error: String(err?.message ?? err) });
    });
  }

  async stop() {
    if (!this.isActive) return;
    this.setStatus("stopping");
    this.resume(); // por si estaba pausado, para que el loop vea el abort
    this.abort?.abort();
    await this.closeBrowser();
  }

  pause() {
    if (this.run.status !== "running") return;
    if (!this.pauseGate) {
      this.pauseGate = new Promise<void>((res) => {
        this.resumeFn = res;
      });
    }
    this.setStatus("paused");
    this.log("system", "Ejecución pausada");
  }

  resume() {
    if (this.resumeFn) {
      this.resumeFn();
      this.resumeFn = null;
      this.pauseGate = null;
      if (this.run.status === "paused") {
        this.setStatus("running");
        this.log("system", "Ejecución reanudada");
      }
    }
  }

  async dispose() {
    await this.stop();
  }

  // ---------------- Internos ----------------

  private async closeBrowser() {
    const ctx = this.context;
    this.context = null;
    this.page = null;
    if (ctx) await ctx.close().catch(() => {});
  }

  private async waitIfPaused() {
    if (this.pauseGate) await this.pauseGate;
  }

  private async captureAndBroadcast(lastAction?: string): Promise<string | undefined> {
    if (!this.page) return undefined;
    try {
      const shot = await takeScreenshot(this.page);
      const info = await pageInfo(this.page);
      this.lastShot = shot;
      this.run.screenshot = `data:image/jpeg;base64,${shot}`;
      this.run.currentUrl = info.url;
      this.run.currentTitle = info.title;
      if (lastAction) this.run.lastAction = lastAction;
      this.emitEvent({
        type: "screenshot",
        id: this.config.id,
        screenshot: this.run.screenshot,
        url: info.url,
        title: info.title,
        lastAction: this.run.lastAction,
      });
      return shot;
    } catch {
      return undefined;
    }
  }

  private describeAction(name: string, input: any): string {
    switch (name) {
      case "navigate":
        return `Navegar a ${input.url}`;
      case "click":
        return `Clic en ${input.ref != null ? `[${input.ref}]` : input.selector ?? `(${input.x},${input.y})`}`;
      case "type":
        return `Escribir "${String(input.text).slice(0, 40)}" en ${input.ref != null ? `[${input.ref}]` : input.selector}`;
      case "select":
        return `Seleccionar "${input.value}" en ${input.ref != null ? `[${input.ref}]` : input.selector}`;
      case "press":
        return `Tecla ${input.key}`;
      case "scroll":
        return `Scroll ${input.direction}`;
      case "wait":
        return input.selector ? `Esperar ${input.selector}` : `Esperar ${input.ms ?? 1000}ms`;
      case "get_text":
        return "Leer texto de la página";
      case "snapshot":
        return "Inspeccionar elementos de la página";
      case "screenshot":
        return "Tomar captura";
      case "report_case":
        return `Reportar ${input.case_id}: ${input.status}`;
      case "finish":
        return "Finalizar sesión";
      default:
        return name;
    }
  }

  private async loop() {
    const signal = this.abort!.signal;
    const session = await browserPool.newSession();
    this.context = session.context;
    this.page = session.page;
    if (signal.aborted) {
      await this.closeBrowser();
      this.setStatus("stopped");
      return;
    }

    this.page.on("dialog", (d) => {
      this.log("system", `Diálogo del navegador (${d.type()}): "${d.message()}" — aceptado automáticamente`);
      d.accept().catch(() => {});
    });
    this.page.on("pageerror", (e) => this.log("system", `Error JS en la página: ${e.message.slice(0, 200)}`));
    this.context.on("page", async (p) => {
      // Si la app abre una pestaña nueva, seguimos trabajando sobre ella.
      this.log("system", "La aplicación abrió una pestaña nueva; el tester la toma como activa");
      this.page = p;
    });

    this.setStatus("running");
    this.log("info", `Tester iniciado con modelo ${MODEL} (esfuerzo ${EFFORT})`);

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      { role: "user", content: buildTaskMessage(this.config) },
    ];

    let finished = false;
    let maxTokens = 16000;

    try {
      while (!signal.aborted && !finished) {
        await this.waitIfPaused();
        if (signal.aborted) break;
        if (this.run.turns >= MAX_TURNS) {
          this.log("system", `Se alcanzó el máximo de ${MAX_TURNS} turnos; se finaliza la sesión`);
          break;
        }

        let response: Anthropic.Beta.BetaMessage;
        try {
          response = await client.beta.messages.create(
            {
              model: MODEL,
              max_tokens: maxTokens,
              system: [{ type: "text", text: SENIOR_TESTER_SYSTEM }],
              tools: TOOL_DEFS,
              messages,
              output_config: { effort: EFFORT },
              cache_control: { type: "ephemeral" },
              betas: ["context-management-2025-06-27"],
              context_management: {
                edits: [
                  {
                    type: "clear_tool_uses_20250919",
                    trigger: { type: "input_tokens", value: 120000 },
                    keep: { type: "tool_uses", value: 10 },
                    exclude_tools: ["report_case"],
                  },
                ],
              },
            },
            { signal },
          );
        } catch (err: any) {
          if (signal.aborted) break;
          if (err instanceof Anthropic.RateLimitError) {
            this.log("system", "Límite de tasa de la API; reintentando en 20s");
            await new Promise((r) => setTimeout(r, 20000));
            continue;
          }
          if (err instanceof Anthropic.APIError) {
            throw new Error(`API ${err.status}: ${err.message}`);
          }
          throw err;
        }

        this.run.turns += 1;
        const u = response.usage;
        this.run.usage.input += u.input_tokens;
        this.run.usage.output += u.output_tokens;
        this.run.usage.cacheRead += u.cache_read_input_tokens ?? 0;
        this.run.usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
        this.emitEvent({ type: "usage", id: this.config.id, usage: this.run.usage, turns: this.run.turns });

        if (response.stop_reason === "refusal") {
          this.log("error", `El modelo rechazó continuar (${response.stop_details?.category ?? "sin categoría"})`);
          throw new Error("El modelo rechazó continuar la sesión");
        }
        if (response.stop_reason === "max_tokens") {
          if (maxTokens < 64000) {
            maxTokens = 64000;
            this.log("system", "Respuesta truncada; se reintenta con más espacio");
            continue;
          }
          throw new Error("Respuesta truncada por max_tokens");
        }

        messages.push({ role: "assistant", content: response.content });

        for (const block of response.content) {
          if (block.type === "text" && block.text.trim()) this.log("thought", block.text.trim());
        }

        const toolUses = response.content.filter(
          (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
        );
        if (toolUses.length === 0) {
          // end_turn sin finish: damos por terminada la sesión.
          this.log("system", "El tester terminó su turno sin llamar a finish; se cierra la sesión");
          break;
        }

        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          if (signal.aborted) break;
          await this.waitIfPaused();
          const input: any = tu.input ?? {};
          const action = this.describeAction(tu.name, input);
          this.log("action", action);

          if (!isToolName(tu.name)) {
            results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Herramienta desconocida: ${tu.name}` });
            continue;
          }

          if (tu.name === "report_case") {
            const r = this.recordCase(input);
            results.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: r ? `Caso ${r.caseId} registrado como ${r.status}` : JSON.stringify({ INVALID_JSON: JSON.stringify(input) }),
              is_error: !r,
            });
            continue;
          }
          if (tu.name === "finish") {
            this.run.summary = String(input.summary ?? "");
            this.log("result", "Sesión finalizada por el tester");
            results.push({ type: "tool_result", tool_use_id: tu.id, content: "Sesión cerrada. Gracias." });
            finished = true;
            break;
          }

          const outcome = await executeTool(this.page!, tu.name, input);
          if (outcome.isError) this.log("error", outcome.text);
          const content: Anthropic.Beta.BetaToolResultBlockParam["content"] = [];
          let text = outcome.text;
          if (outcome.visual) {
            const shot = await this.captureAndBroadcast(action);
            const info = this.page ? await pageInfo(this.page) : { url: "", title: "" };
            text += `\n\nURL: ${info.url}\nTítulo: ${info.title}`;
            content.push({ type: "text", text });
            if (shot) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: shot } });
          } else {
            content.push({ type: "text", text });
          }
          results.push({ type: "tool_result", tool_use_id: tu.id, content, is_error: outcome.isError });
        }

        if (finished || signal.aborted) break;
        messages.push({ role: "user", content: results });
      }

      if (signal.aborted) {
        this.log("system", "Ejecución detenida por el usuario");
        this.run.finishedAt = new Date().toISOString();
        this.setStatus("stopped");
      } else {
        await this.captureAndBroadcast();
        this.run.finishedAt = new Date().toISOString();
        this.setStatus("finished", { summary: this.run.summary ?? "" });
      }
    } catch (err: any) {
      if (signal.aborted) {
        this.run.finishedAt = new Date().toISOString();
        this.setStatus("stopped");
      } else {
        const msg = String(err?.message ?? err);
        this.log("error", msg);
        this.run.finishedAt = new Date().toISOString();
        this.setStatus("error", { error: msg });
      }
    } finally {
      await this.closeBrowser();
      this.emit("done");
    }
  }

  private recordCase(input: any): CaseResult | null {
    if (!input || typeof input.case_id !== "string" || !["passed", "failed", "blocked", "skipped"].includes(input.status)) {
      return null;
    }
    const result: CaseResult = {
      caseId: input.case_id,
      title: String(input.title ?? ""),
      status: input.status,
      steps: String(input.steps ?? ""),
      notes: String(input.notes ?? ""),
      evidence: this.lastShot ? `data:image/jpeg;base64,${this.lastShot}` : undefined,
      at: new Date().toISOString(),
    };
    const idx = this.run.results.findIndex((r) => r.caseId === result.caseId);
    if (idx >= 0) this.run.results[idx] = result;
    else this.run.results.push(result);
    this.log("result", `${result.caseId} → ${result.status.toUpperCase()}: ${result.title}`);
    this.emitEvent({ type: "case_result", id: this.config.id, result });
    return result;
  }
}
