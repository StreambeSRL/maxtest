import type { CaseResult, TesterView } from "../shared/types.js";

export interface ReportRow {
  testerId: string;
  testerName: string;
  baseUrl: string;
  runStatus: string;
  startedAt?: string;
  finishedAt?: string;
  caseId: string;
  title: string;
  status: CaseResult["status"];
  steps: string;
  notes: string;
  at: string;
  evidence?: string;
}

export interface ConsolidatedReport {
  generatedAt: string;
  totals: { passed: number; failed: number; blocked: number; skipped: number; total: number };
  testers: {
    id: string;
    name: string;
    baseUrl: string;
    status: string;
    startedAt?: string;
    finishedAt?: string;
    summary?: string;
    counts: { passed: number; failed: number; blocked: number; skipped: number };
    cases: CaseResult[];
  }[];
  rows: ReportRow[];
}

const STATUSES = ["passed", "failed", "blocked", "skipped"] as const;

export function buildReport(views: TesterView[], opts: { withEvidence?: boolean } = {}): ConsolidatedReport {
  const testers = views.map((v) => {
    const counts = { passed: 0, failed: 0, blocked: 0, skipped: 0 };
    for (const c of v.run.results) counts[c.status] += 1;
    return {
      id: v.config.id,
      name: v.config.name,
      baseUrl: v.config.baseUrl,
      status: v.run.status,
      startedAt: v.run.startedAt,
      finishedAt: v.run.finishedAt,
      summary: v.run.summary,
      counts,
      cases: v.run.results.map((c) => (opts.withEvidence ? c : { ...c, evidence: undefined })),
    };
  });
  const totals = { passed: 0, failed: 0, blocked: 0, skipped: 0, total: 0 };
  const rows: ReportRow[] = [];
  for (const t of testers) {
    for (const s of STATUSES) totals[s] += t.counts[s];
    for (const c of t.cases) {
      totals.total += 1;
      rows.push({
        testerId: t.id,
        testerName: t.name,
        baseUrl: t.baseUrl,
        runStatus: t.status,
        startedAt: t.startedAt,
        finishedAt: t.finishedAt,
        caseId: c.caseId,
        title: c.title,
        status: c.status,
        steps: c.steps,
        notes: c.notes,
        at: c.at,
        evidence: c.evidence,
      });
    }
  }
  return { generatedAt: new Date().toISOString(), totals, testers, rows };
}

// ---------- CSV (Excel / importación genérica) ----------

export function toCsv(r: ConsolidatedReport): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Tester", "Sistema", "Caso", "Titulo", "Resultado", "Pasos", "Notas", "Fecha"];
  const lines = [head.map(esc).join(",")];
  for (const row of r.rows) {
    lines.push(
      [row.testerName, row.baseUrl, row.caseId, row.title, row.status.toUpperCase(), row.steps, row.notes, row.at]
        .map(esc)
        .join(","),
    );
  }
  return "﻿" + lines.join("\r\n"); // BOM para que Excel abra UTF-8 bien
}

// ---------- JUnit XML (Azure DevOps: PublishTestResults / tab Tests) ----------

function xml(s: unknown) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

export function toJUnit(r: ConsolidatedReport): string {
  const suites = r.testers.map((t) => {
    const cases = t.cases
      .map((c) => {
        const name = `${c.caseId} ${c.title}`.trim();
        const body =
          c.status === "failed"
            ? `<failure message="${xml(firstLine(c.notes))}">${xml(c.notes)}</failure>`
            : c.status === "blocked"
              ? `<error message="${xml(firstLine(c.notes))}">${xml(c.notes)}</error>`
              : c.status === "skipped"
                ? `<skipped message="${xml(firstLine(c.notes))}"/>`
                : "";
        return `    <testcase name="${xml(name)}" classname="${xml(t.name)}" time="0">\n      ${body}\n      <system-out>${xml(`Pasos: ${c.steps}\n\nNotas: ${c.notes}`)}</system-out>\n    </testcase>`;
      })
      .join("\n");
    const { passed, failed, blocked, skipped } = t.counts;
    return `  <testsuite name="${xml(t.name)}" tests="${passed + failed + blocked + skipped}" failures="${failed}" errors="${blocked}" skipped="${skipped}" timestamp="${xml(t.startedAt ?? r.generatedAt)}" hostname="${xml(t.baseUrl)}">\n${cases}\n  </testsuite>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="AI Testers" tests="${r.totals.total}" failures="${r.totals.failed}" errors="${r.totals.blocked}" skipped="${r.totals.skipped}">\n${suites.join("\n")}\n</testsuites>\n`;
}

function firstLine(s: string) {
  return (s || "").split("\n")[0].slice(0, 200);
}

// ---------- Markdown ----------

export function toMarkdown(r: ConsolidatedReport): string {
  const L: string[] = [];
  L.push(`# Reporte consolidado de pruebas — AI Testers`, ``);
  L.push(`Generado: ${r.generatedAt}`, ``);
  L.push(
    `**Totales:** ${r.totals.total} casos · ✅ ${r.totals.passed} passed · ❌ ${r.totals.failed} failed · ⛔ ${r.totals.blocked} blocked · ⏭ ${r.totals.skipped} skipped`,
    ``,
  );
  L.push(`## Resultados por caso`, ``, `| Tester | Caso | Título | Resultado | Notas |`, `|---|---|---|---|---|`);
  for (const row of r.rows) {
    L.push(`| ${md(row.testerName)} | ${md(row.caseId)} | ${md(row.title)} | ${row.status.toUpperCase()} | ${md(row.notes)} |`);
  }
  L.push(``);
  for (const t of r.testers) {
    L.push(`## ${t.name}`, ``, `- Sistema: ${t.baseUrl}`, `- Estado de la corrida: ${t.status}`, `- Inicio: ${t.startedAt ?? "-"} · Fin: ${t.finishedAt ?? "-"}`, ``);
    for (const c of t.cases) {
      L.push(`### ${c.caseId} — ${c.title} (${c.status})`, ``, `**Pasos:** ${c.steps}`, ``, `**Notas:** ${c.notes}`, ``);
    }
    if (t.summary) L.push(`### Resumen del tester`, ``, t.summary, ``);
  }
  return L.join("\n");
}

function md(s: string) {
  return (s || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

// ---------- HTML autocontenido (con evidencias) ----------

export function toHtml(r: ConsolidatedReport): string {
  const badge = (s: string) =>
    `<span class="b b-${s}">${s.toUpperCase()}</span>`;
  const testers = r.testers
    .map((t) => {
      const rows = t.cases
        .map(
          (c) => `<tr><td class="mono">${xml(c.caseId)}</td><td>${xml(c.title)}</td><td>${badge(c.status)}</td><td class="pre">${xml(c.notes)}<details><summary>Pasos</summary>${xml(c.steps)}</details></td><td>${
            c.evidence ? `<a href="${c.evidence}" target="_blank"><img src="${c.evidence}" alt="evidencia"></a>` : ""
          }</td></tr>`,
        )
        .join("");
      return `<section><h2>${xml(t.name)} <small>${xml(t.baseUrl)}</small></h2>
<p class="meta">Corrida: ${xml(t.status)} · Inicio ${xml(t.startedAt ?? "-")} · Fin ${xml(t.finishedAt ?? "-")} · ✅ ${t.counts.passed} · ❌ ${t.counts.failed} · ⛔ ${t.counts.blocked} · ⏭ ${t.counts.skipped}</p>
<table><thead><tr><th>Caso</th><th>Título</th><th>Resultado</th><th>Notas</th><th>Evidencia</th></tr></thead><tbody>${rows}</tbody></table>
${t.summary ? `<h3>Resumen del tester</h3><pre class="sum">${xml(t.summary)}</pre>` : ""}</section>`;
    })
    .join("\n");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de pruebas — AI Testers</title>
<style>
body{font-family:Segoe UI,system-ui,sans-serif;margin:32px;color:#1f2937;background:#fff}h1{margin:0 0 4px}h2 small{font-weight:400;color:#6b7280;font-size:14px}
.tot{display:flex;gap:16px;margin:16px 0 28px}.tot div{border:1px solid #e5e7eb;border-radius:10px;padding:10px 16px;min-width:110px}.tot b{display:block;font-size:22px}
table{border-collapse:collapse;width:100%;margin:8px 0 20px}th,td{border-bottom:1px solid #e5e7eb;padding:8px;vertical-align:top;text-align:left;font-size:13px}th{background:#f9fafb}
.mono{font-family:Consolas,monospace}.pre{white-space:pre-wrap;max-width:520px}details{color:#6b7280;margin-top:6px}img{width:160px;border:1px solid #e5e7eb;border-radius:4px}
.b{font-family:Consolas,monospace;font-size:11px;padding:2px 7px;border-radius:5px}.b-passed{background:#d1fae5;color:#065f46}.b-failed{background:#fee2e2;color:#991b1b}.b-blocked{background:#fef3c7;color:#92400e}.b-skipped{background:#e5e7eb;color:#374151}
.meta{color:#6b7280;font-size:13px}.sum{white-space:pre-wrap;background:#f9fafb;padding:12px;border-radius:8px;font-family:inherit}
</style></head><body>
<h1>Reporte consolidado de pruebas</h1><p class="meta">AI Testers · generado ${xml(r.generatedAt)}</p>
<div class="tot"><div>Total<b>${r.totals.total}</b></div><div>Passed<b style="color:#059669">${r.totals.passed}</b></div><div>Failed<b style="color:#dc2626">${r.totals.failed}</b></div><div>Blocked<b style="color:#d97706">${r.totals.blocked}</b></div><div>Skipped<b style="color:#6b7280">${r.totals.skipped}</b></div></div>
${testers}
</body></html>`;
}
