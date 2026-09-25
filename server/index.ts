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
import { buildReport, toCsv, toHtml, toJUnit, toMarkdown } from "./report.js";
import { azdoConfigFromEnv, listPlans, listSuites, publishReport } from "./azdo.js";
import { extractText, SUPPORTED_EXTENSIONS } from "./extract.js";
import { accessEnabled, checkPassword, clearSessionCookie, isAuthorized, requireAccess, setSessionCookie } from "./access.js";

{
  const auth = detectAuth();
  if (auth.ok) console.log(`Autenticación con Anthropic: ${auth.source}`);
  else console.warn(`⚠️  ${auth.source}. ${auth.hint ?? ""}`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4321);

const app = express();
app.use(express.json({ limit: "25mb" }));

// ---------------- Acceso (contraseña compartida opcional) ----------------

app.get("/api/session", (req, res) => {
  res.json({ accessEnabled, authorized: isAuthorized(req.headers.cookie) });
});
app.post("/api/login", (req, res) => {
  if (!accessEnabled) return res.json({ ok: true });
  if (!checkPassword(String(req.body?.password ?? ""))) return res.status(401).json({ error: "Contraseña incorrecta" });
  setSessionCookie(res);
  res.json({ ok: true });
});
app.post("/api/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
app.use("/api", requireAccess);

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

// ---------------- Extracción de texto de archivos ----------------

app.get("/api/extract/formats", (_req, res) => res.json({ extensions: SUPPORTED_EXTENSIONS }));

app.post("/api/extract", async (req, res) => {
  const files: { name: string; data: string }[] = Array.isArray(req.body?.files) ? req.body.files : [];
  if (files.length === 0) return res.status(400).json({ error: "No se recibieron archivos" });
  const out: { name: string; text?: string; error?: string }[] = [];
  for (const f of files.slice(0, 10)) {
    try {
      const buf = Buffer.from(String(f.data).replace(/^data:[^;]*;base64,/, ""), "base64");
      out.push({ name: f.name, text: await extractText(String(f.name), buf) });
    } catch (e: any) {
      out.push({ name: f.name, error: e.message });
    }
  }
  res.json({ files: out });
});

// ---------------- Reporte consolidado ----------------

const REPORT_FORMATS: Record<string, { type: string; ext: string; render: (r: ReturnType<typeof buildReport>) => string; evidence: boolean }> = {
  json: { type: "application/json; charset=utf-8", ext: "json", render: (r) => JSON.stringify(r, null, 2), evidence: false },
  md: { type: "text/markdown; charset=utf-8", ext: "md", render: toMarkdown, evidence: false },
  csv: { type: "text/csv; charset=utf-8", ext: "csv", render: toCsv, evidence: false },
  xml: { type: "application/xml; charset=utf-8", ext: "xml", render: toJUnit, evidence: false },
  html: { type: "text/html; charset=utf-8", ext: "html", render: toHtml, evidence: true },
};

app.get("/api/report", (_req, res) => {
  res.json(buildReport(allViews()));
});
app.get("/api/report.:fmt", (req, res) => {
  const f = REPORT_FORMATS[req.params.fmt];
  if (!f) return res.status(404).json({ error: "Formato no soportado" });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const name = req.params.fmt === "xml" ? `ai-testers-junit-${stamp}.xml` : `ai-testers-reporte-${stamp}.${f.ext}`;
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.type(f.type).send(f.render(buildReport(allViews(), { withEvidence: f.evidence })));
});

// ---------------- Azure DevOps ----------------

app.get("/api/azdo/status", (_req, res) => {
  const cfg = azdoConfigFromEnv();
  res.json({ configured: !!cfg, org: cfg?.org, project: cfg?.project });
});
app.get("/api/azdo/plans", async (_req, res) => {
  const cfg = azdoConfigFromEnv();
  if (!cfg) return res.status(400).json({ error: "Azure DevOps no está configurado (AZURE_DEVOPS_ORG / PROJECT / PAT)" });
  try {
    res.json({ plans: await listPlans(cfg) });
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});
app.get("/api/azdo/plans/:planId/suites", async (req, res) => {
  const cfg = azdoConfigFromEnv();
  if (!cfg) return res.status(400).json({ error: "Azure DevOps no está configurado" });
  try {
    res.json({ suites: await listSuites(cfg, Number(req.params.planId)) });
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});
app.post("/api/azdo/publish", async (req, res) => {
  const cfg = azdoConfigFromEnv();
  if (!cfg) return res.status(400).json({ error: "Azure DevOps no está configurado (AZURE_DEVOPS_ORG / PROJECT / PAT)" });
  const ids: string[] | undefined = Array.isArray(req.body?.testerIds) ? req.body.testerIds : undefined;
  const views = allViews().filter((v) => !ids || ids.includes(v.config.id));
  try {
    const result = await publishReport(cfg, buildReport(views, { withEvidence: true }), {
      planId: req.body?.planId ? Number(req.body.planId) : undefined,
      suiteId: req.body?.suiteId ? Number(req.body.suiteId) : undefined,
      runName: req.body?.runName,
      attachEvidence: req.body?.attachEvidence !== false,
    });
    res.json(result);
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});

// ---------------- Frontend estático (build) ----------------

const clientDist = path.resolve(here, "../dist/client");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/ws).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

// ---------------- WebSocket ----------------

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  path: "/ws",
  verifyClient: (info: { req: http.IncomingMessage }) => isAuthorized(info.req.headers.cookie),
});
wss.on("connection", (ws) => {
  wsClients.add(ws);
  ws.send(JSON.stringify({ type: "snapshot", testers: allViews(), limits: { maxTesters: MAX_TESTERS } } satisfies ServerEvent));
  ws.on("close", () => wsClients.delete(ws));
  ws.on("error", () => wsClients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`AI Testers escuchando en http://localhost:${PORT}${accessEnabled ? " (con contraseña de acceso)" : ""}`);
  console.log(`Azure DevOps: ${azdoConfigFromEnv() ? "configurado" : "no configurado (opcional)"}`);
});

async function shutdown() {
  console.log("\nCerrando...");
  await Promise.all([...runners.values()].map((r) => r.stop().catch(() => {})));
  await browserPool.shutdown();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
