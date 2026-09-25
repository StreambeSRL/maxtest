/**
 * Integración con Azure DevOps Test Plans (API REST 7.1).
 *
 * Publica los resultados como un Test Run. Si se indica plan + suite, cada caso
 * se asocia al Test Point correspondiente (por ID de work item o por título) y
 * actualiza el outcome del caso en el plan; si no, crea un run suelto con los
 * resultados. Las evidencias se suben como adjuntos del resultado.
 *
 * Variables: AZURE_DEVOPS_ORG (nombre de la org o URL), AZURE_DEVOPS_PROJECT,
 * AZURE_DEVOPS_PAT (scope: Test Management read & write, Work Items read).
 */
import type { ConsolidatedReport } from "./report.js";

export interface AzdoConfig {
  org: string;
  project: string;
  pat: string;
}

export function azdoConfigFromEnv(): AzdoConfig | null {
  const org = (process.env.AZURE_DEVOPS_ORG || "").trim();
  const project = (process.env.AZURE_DEVOPS_PROJECT || "").trim();
  const pat = (process.env.AZURE_DEVOPS_PAT || "").trim();
  if (!org || !project || !pat) return null;
  return { org, project, pat };
}

function baseUrl(cfg: AzdoConfig) {
  const org = /^https?:\/\//i.test(cfg.org) ? cfg.org.replace(/\/+$/, "") : `https://dev.azure.com/${cfg.org}`;
  return `${org}/${encodeURIComponent(cfg.project)}/_apis`;
}

async function call<T = any>(cfg: AzdoConfig, method: string, path: string, body?: unknown, apiVersion = "7.1"): Promise<T> {
  const url = `${baseUrl(cfg)}/${path}${path.includes("?") ? "&" : "?"}api-version=${apiVersion}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`:${cfg.pat}`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      msg = JSON.parse(text).message ?? msg;
    } catch {}
    if (res.status === 401 || res.status === 203) msg = "Credenciales inválidas (PAT vencido o sin permisos de Test Management)";
    throw new Error(`Azure DevOps ${res.status}: ${msg}`);
  }
  return text ? JSON.parse(text) : (undefined as T);
}

export interface TestPlanInfo {
  id: number;
  name: string;
}
export interface TestSuiteInfo {
  id: number;
  name: string;
  parentId?: number;
}

export async function listPlans(cfg: AzdoConfig): Promise<TestPlanInfo[]> {
  const r = await call<{ value: any[] }>(cfg, "GET", "testplan/plans?filterActivePlans=true");
  return (r.value ?? []).map((p) => ({ id: p.id, name: p.name }));
}

export async function listSuites(cfg: AzdoConfig, planId: number): Promise<TestSuiteInfo[]> {
  const r = await call<{ value: any[] }>(cfg, "GET", `testplan/Plans/${planId}/suites`);
  return (r.value ?? []).map((s) => ({ id: s.id, name: s.name, parentId: s.parentSuite?.id }));
}

interface TestPoint {
  id: number;
  testCaseReference: { id: number; name: string };
}

async function listPoints(cfg: AzdoConfig, planId: number, suiteId: number): Promise<TestPoint[]> {
  const r = await call<{ value: any[] }>(cfg, "GET", `testplan/Plans/${planId}/Suites/${suiteId}/TestPoint`);
  return (r.value ?? []).map((p) => ({ id: p.id, testCaseReference: { id: p.testCaseReference?.id, name: p.testCaseReference?.name } }));
}

const OUTCOME: Record<string, string> = {
  passed: "Passed",
  failed: "Failed",
  blocked: "Blocked",
  skipped: "NotExecuted",
};

function norm(s: string) {
  return (s || "").toLowerCase().replace(/[^a-z0-9áéíóúñü]+/g, " ").trim();
}

/** Extrae un posible ID de work item del identificador del caso ("12345", "#12345", "TC-12345", "AB#12345"). */
function workItemIdFrom(caseId: string): number | null {
  const m = caseId.match(/(\d{2,})/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface PublishOptions {
  planId?: number;
  suiteId?: number;
  runName?: string;
  attachEvidence?: boolean;
}

export interface PublishResult {
  runId: number;
  runUrl: string;
  published: number;
  matched: number;
  unmatched: string[];
}

export async function publishReport(cfg: AzdoConfig, report: ConsolidatedReport, opts: PublishOptions): Promise<PublishResult> {
  const runName = opts.runName?.trim() || `AI Testers — ${new Date().toLocaleString("es-AR")}`;
  const rows = report.rows;
  if (rows.length === 0) throw new Error("No hay resultados para publicar");

  // 1) Matching con test points del plan/suite (opcional)
  let points: TestPoint[] = [];
  if (opts.planId && opts.suiteId) points = await listPoints(cfg, opts.planId, opts.suiteId);
  const byId = new Map<number, TestPoint>();
  const byTitle = new Map<string, TestPoint>();
  for (const p of points) {
    if (p.testCaseReference?.id) byId.set(p.testCaseReference.id, p);
    if (p.testCaseReference?.name) byTitle.set(norm(p.testCaseReference.name), p);
  }
  const unmatched: string[] = [];
  const matchedRows = rows.map((row) => {
    let point: TestPoint | undefined;
    const wi = workItemIdFrom(row.caseId);
    if (wi && byId.has(wi)) point = byId.get(wi);
    if (!point) point = byTitle.get(norm(row.title)) ?? byTitle.get(norm(`${row.caseId} ${row.title}`));
    if (!point && points.length) unmatched.push(`${row.caseId} ${row.title}`);
    return { row, point };
  });
  const pointIds = matchedRows.map((m) => m.point?.id).filter((x): x is number => !!x);

  // 2) Crear el run
  const runBody: any = { name: runName, automated: false, state: "InProgress", comment: `Publicado desde AI Testers (${report.totals.total} casos)` };
  if (opts.planId) runBody.plan = { id: String(opts.planId) };
  if (pointIds.length) runBody.pointIds = pointIds;
  const run = await call<{ id: number; url: string; webAccessUrl?: string }>(cfg, "POST", "test/runs", runBody);

  // 3) Resultados
  const results = matchedRows.map(({ row, point }) => {
    const r: any = {
      testCaseTitle: `${row.caseId} ${row.title}`.trim(),
      automatedTestName: `${row.testerName}.${row.caseId}`,
      automatedTestStorage: "AI Testers",
      outcome: OUTCOME[row.status] ?? "None",
      state: "Completed",
      comment: `Tester: ${row.testerName} · Sistema: ${row.baseUrl}\n\nPasos: ${row.steps}\n\nNotas: ${row.notes}`.slice(0, 4000),
      startedDate: row.startedAt,
      completedDate: row.at,
      durationInMs: 0,
    };
    if (row.status === "failed" || row.status === "blocked") r.errorMessage = row.notes.slice(0, 1000);
    if (point) {
      r.testPoint = { id: String(point.id) };
      r.testCase = { id: String(point.testCaseReference.id) };
    } else {
      const wi = workItemIdFrom(row.caseId);
      if (wi && !opts.planId) r.testCase = { id: String(wi) };
    }
    return r;
  });
  const created = await call<{ value: { id: number }[] }>(cfg, "POST", `test/Runs/${run.id}/results`, results);

  // 4) Evidencias como adjuntos
  if (opts.attachEvidence !== false) {
    const ids = created.value ?? [];
    for (let i = 0; i < ids.length; i++) {
      const ev = matchedRows[i]?.row.evidence;
      if (!ev) continue;
      const data = ev.replace(/^data:image\/jpeg;base64,/, "");
      await call(
        cfg,
        "POST",
        `test/Runs/${run.id}/Results/${ids[i].id}/attachments`,
        { stream: data, fileName: `${matchedRows[i].row.caseId.replace(/[^\w.-]+/g, "_")}.jpg`, comment: "Evidencia AI Testers", attachmentType: "GeneralAttachment" },
        "7.1-preview.1",
      ).catch(() => {});
    }
  }

  // 5) Cerrar el run
  await call(cfg, "PATCH", `test/runs/${run.id}`, { state: "Completed" });

  const org = /^https?:\/\//i.test(cfg.org) ? cfg.org.replace(/\/+$/, "") : `https://dev.azure.com/${cfg.org}`;
  const runUrl = run.webAccessUrl || `${org}/${encodeURIComponent(cfg.project)}/_testManagement/runs?runId=${run.id}&_a=runCharts`;
  return { runId: run.id, runUrl, published: results.length, matched: pointIds.length, unmatched };
}
