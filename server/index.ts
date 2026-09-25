import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { MAX_TESTERS, type ServerEvent, type TesterConfig, type TesterView } from "../shared/types.js";
import { TesterRunner } from "./runner.js";
import { loadState, saveState } from "./store.js";
import { browserPool } from "./browser.js";
import { detectAuth } from "./auth.js";

{
  const auth = detectAuth();
  if (auth.ok) console.log(`Autenticación con Anthropic: ${auth.source}`);
  else console.warn(`⚠️  ${auth.source}. ${auth.hint ?? ""}`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4321);

const app = express();
app.use(express.json({ limit: "2mb" }));

// ---------------- Estado en memoria ----------------

const runners = new Map<string, TesterRunner>();
const wsClients = new Set<WebSocket>();

function view(r: TesterRunner): TesterView {
  return { config: r.config, run: r.run };
}
function allViews(): TesterView[] {
  return [...runners.values()].map(view);
}
function broadcast(ev: ServerEvent) {
  const data = JSON.stringify(ev);
  for (const ws of wsClients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}
function persist() {
  saveState(allViews());
}
function attach(r: TesterRunner) {
  r.on("event", (ev: ServerEvent) => {
    broadcast(ev);
    if (ev.type !== "screenshot") persist();
  });
  r.on("done", persist);
  runners.set(r.config.id, r);
}

for (const t of loadState()) attach(new TesterRunner(t.config, t.run));

// ---------------- API REST ----------------

function sanitizeConfig(body: any, existing?: TesterConfig): TesterConfig {
  const now = new Date().toISOString();
  const str = (v: unknown, max = 20000) => (typeof v === "string" ? v.slice(0, max) : "");
  let baseUrl = str(body.baseUrl, 2000).trim();
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) baseUrl = "https://" + baseUrl;
  return {
    id: existing?.id ?? randomUUID(),
    name: str(body.name, 80).trim() || `Tester ${runners.size + 1}`,
    baseUrl,
    prompt: str(body.prompt),
    testCases: str(body.testCases, 60000),
    userStories: str(body.userStories, 60000),
    acceptanceCriteria: str(body.acceptanceCriteria, 60000),
    testData: str(body.testData, 10000),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

app.get("/api/testers", (_req, res) => {
  res.json({ testers: allViews(), limits: { maxTesters: MAX_TESTERS } });
});

app.post("/api/testers", (req, res) => {
  if (runners.size >= MAX_TESTERS) return res.status(400).json({ error: `Máximo ${MAX_TESTERS} testers` });
  const cfg = sanitizeConfig(req.body);
  if (!cfg.baseUrl) return res.status(400).json({ error: "La URL del sistema es obligatoria" });
  const r = new TesterRunner(cfg);
  attach(r);
  broadcast({ type: "tester_upsert", tester: view(r) });
  persist();
  res.json(view(r));
});

app.put("/api/testers/:id", (req, res) => {
  const r = runners.get(req.params.id);
  if (!r) return res.status(404).json({ error: "No existe" });
  if (r.isActive) return res.status(409).json({ error: "Detené el tester antes de editarlo" });
  r.config = sanitizeConfig(req.body, r.config);
  broadcast({ type: "tester_upsert", tester: view(r) });
  persist();
  res.json(view(r));
});

app.post("/api/testers/:id/duplicate", (req, res) => {
  const src = runners.get(req.params.id);
  if (!src) return res.status(404).json({ error: "No existe" });
  if (runners.size >= MAX_TESTERS) return res.status(400).json({ error: `Máximo ${MAX_TESTERS} testers` });
  const cfg = sanitizeConfig({ ...src.config, name: `${src.config.name} (copia)` });
  const r = new TesterRunner(cfg);
  attach(r);
  broadcast({ type: "tester_upsert", tester: view(r) });
  persist();
  res.json(view(r));
});

app.delete("/api/testers/:id", async (req, res) => {
  const r = runners.get(req.params.id);
  if (!r) return res.status(404).json({ error: "No existe" });
  await r.dispose();
  runners.delete(r.config.id);
  broadcast({ type: "tester_removed", id: r.config.id });
  persist();
  res.json({ ok: true });
});

const actions: Record<string, (r: TesterRunner) => Promise<void> | void> = {
  start: (r) => r.start(),
  stop: (r) => r.stop(),
  pause: (r) => r.pause(),
  resume: (r) => r.resume(),
};

app.post("/api/testers/:id/:action", async (req, res) => {
  const r = runners.get(req.params.id);
  const fn = actions[req.params.action];
  if (!r || !fn) return res.status(404).json({ error: "No existe" });
  await fn(r);
  res.json(view(r));
});

app.post("/api/all/:action", async (req, res) => {
  const fn = actions[req.params.action];
  if (!fn) return res.status(404).json({ error: "Acción inválida" });
  await Promise.all([...runners.values()].map((r) => Promise.resolve(fn(r)).catch(() => {})));
  res.json({ ok: true });
});

app.get("/api/testers/:id/report.md", (req, res) => {
  const r = runners.get(req.params.id);
  if (!r) return res.status(404).send("No existe");
  res.type("text/markdown; charset=utf-8").send(reportMarkdown(r));
});

function reportMarkdown(r: TesterRunner): string {
  const { config, run } = r;
  const count = (s: string) => run.results.filter((x) => x.status === s).length;
  const lines = [
    `# Reporte de pruebas — ${config.name}`,
    ``,
    `- Sistema: ${config.baseUrl}`,
    `- Estado: ${run.status}`,
    `- Inicio: ${run.startedAt ?? "-"}  ·  Fin: ${run.finishedAt ?? "-"}`,
    `- Resultados: ✅ ${count("passed")} passed · ❌ ${count("failed")} failed · ⛔ ${count("blocked")} blocked · ⏭ ${count("skipped")} skipped`,
    ``,
    `## Casos`,
    ``,
    `| Caso | Título | Estado | Notas |`,
    `|---|---|---|---|`,
    ...run.results.map(
      (c) => `| ${c.caseId} | ${c.title.replace(/\|/g, "\\|")} | ${c.status} | ${c.notes.replace(/\|/g, "\\|").replace(/\n/g, "<br>")} |`,
    ),
    ``,
    `## Detalle`,
    ``,
    ...run.results.flatMap((c) => [`### ${c.caseId} — ${c.title} (${c.status})`, ``, `**Pasos:** ${c.steps}`, ``, `**Notas:** ${c.notes}`, ``]),
    `## Resumen del tester`,
    ``,
    run.summary ?? "(sin resumen)",
    ``,
  ];
  return lines.join("\n");
}

// ---------------- Frontend estático (build) ----------------

const clientDist = path.resolve(here, "../dist/client");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/ws).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

// ---------------- WebSocket ----------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  wsClients.add(ws);
  ws.send(JSON.stringify({ type: "snapshot", testers: allViews(), limits: { maxTesters: MAX_TESTERS } } satisfies ServerEvent));
  ws.on("close", () => wsClients.delete(ws));
  ws.on("error", () => wsClients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`AI Testers escuchando en http://localhost:${PORT}`);
});

async function shutdown() {
  console.log("\nCerrando...");
  await Promise.all([...runners.values()].map((r) => r.stop().catch(() => {})));
  await browserPool.shutdown();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
