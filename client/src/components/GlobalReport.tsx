import { useEffect, useState } from "react";
import type { TesterView } from "../../../shared/types";
import { api } from "../store";

interface Props {
  testers: TesterView[];
  onClose: () => void;
}

interface AzdoStatus {
  configured: boolean;
  org?: string;
  project?: string;
}

export function GlobalReport({ testers, onClose }: Props) {
  const rows = testers.flatMap((t) => t.run.results.map((c) => ({ t, c })));
  const totals = { passed: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const { c } of rows) totals[c.status] += 1;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal report" onClick={(e) => e.stopPropagation()}>
        <header>
          <strong>Reporte consolidado · {rows.length} casos</strong>
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="report-body">
          <div className="tiles">
            <Tile label="Passed" n={totals.passed} cls="passed" />
            <Tile label="Failed" n={totals.failed} cls="failed" />
            <Tile label="Blocked" n={totals.blocked} cls="blocked" />
            <Tile label="Skipped" n={totals.skipped} cls="skipped" />
          </div>

          <div className="downloads">
            <span className="muted">Descargar:</span>
            <a className="btn sm" href="/api/report.html" target="_blank" rel="noreferrer">
              HTML (con evidencias)
            </a>
            <a className="btn sm" href="/api/report.xml">
              JUnit XML (Azure Pipelines)
            </a>
            <a className="btn sm" href="/api/report.csv">
              CSV (Excel)
            </a>
            <a className="btn sm" href="/api/report.md">
              Markdown
            </a>
            <a className="btn sm" href="/api/report.json">
              JSON
            </a>
          </div>

          {rows.length === 0 ? (
            <p className="muted">Todavía no hay resultados. Ejecutá al menos un tester.</p>
          ) : (
            <table className="results">
              <thead>
                <tr>
                  <th>Tester</th>
                  <th>Caso</th>
                  <th>Título</th>
                  <th>Estado</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ t, c }) => (
                  <tr key={t.config.id + c.caseId}>
                    <td>{t.config.name}</td>
                    <td className="mono">{c.caseId}</td>
                    <td>{c.title}</td>
                    <td>
                      <span className={`case-badge cb-${c.status}`}>{c.status.toUpperCase()}</span>
                    </td>
                    <td className="notes">{c.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <AzdoPanel testers={testers} disabled={rows.length === 0} />
        </div>
      </div>
    </div>
  );
}

function Tile({ label, n, cls }: { label: string; n: number; cls: string }) {
  return (
    <div className={`tile t-${cls}`}>
      <span>{label}</span>
      <b>{n}</b>
    </div>
  );
}

function AzdoPanel({ testers, disabled }: { testers: TesterView[]; disabled: boolean }) {
  const [status, setStatus] = useState<AzdoStatus | null>(null);
  const [plans, setPlans] = useState<{ id: number; name: string }[]>([]);
  const [suites, setSuites] = useState<{ id: number; name: string; parentId?: number }[]>([]);
  const [planId, setPlanId] = useState("");
  const [suiteId, setSuiteId] = useState("");
  const [runName, setRunName] = useState("");
  const [selected, setSelected] = useState<string[]>(testers.map((t) => t.config.id));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null);

  useEffect(() => {
    api<AzdoStatus>("/azdo/status").then(setStatus).catch(() => setStatus({ configured: false }));
  }, []);

  const loadPlans = async () => {
    setMsg(null);
    try {
      const r = await api<{ plans: { id: number; name: string }[] }>("/azdo/plans");
      setPlans(r.plans);
      if (r.plans.length === 0) setMsg({ ok: false, text: "No se encontraron planes de prueba activos en el proyecto." });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  };

  useEffect(() => {
    if (!planId) return setSuites([]);
    api<{ suites: typeof suites }>(`/azdo/plans/${planId}/suites`)
      .then((r) => setSuites(r.suites))
      .catch((e) => setMsg({ ok: false, text: e.message }));
  }, [planId]);

  const publish = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ runId: number; runUrl: string; published: number; matched: number; unmatched: string[] }>(
        "/azdo/publish",
        "POST",
        { planId: planId || undefined, suiteId: suiteId || undefined, runName, testerIds: selected },
      );
      const extra =
        planId && suiteId
          ? ` · ${r.matched} asociados a test points${r.unmatched.length ? `; sin asociar: ${r.unmatched.join(", ")}` : ""}`
          : "";
      setMsg({ ok: true, text: `Run #${r.runId} creado con ${r.published} resultados${extra}.`, url: r.runUrl });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="azdo">
      <h4>Publicar en Azure DevOps (Test Plans)</h4>
      {status === null ? (
        <p className="muted">Verificando configuración…</p>
      ) : !status.configured ? (
        <p className="muted">
          No configurado. Definí <code>AZURE_DEVOPS_ORG</code>, <code>AZURE_DEVOPS_PROJECT</code> y <code>AZURE_DEVOPS_PAT</code> en el
          .env del servidor y reinicialo. Mientras tanto podés descargar el JUnit XML y publicarlo con la tarea
          PublishTestResults de un pipeline.
        </p>
      ) : (
        <>
          <p className="muted">
            Organización <b>{status.org}</b> · Proyecto <b>{status.project}</b>. Se crea un Test Run con un resultado por caso y la
            evidencia adjunta. Si elegís plan y suite, cada caso actualiza el outcome de su test point (por ID de work item en el
            identificador del caso, o por título).
          </p>
          <div className="azdo-grid">
            <label>
              <span>Plan de pruebas (opcional)</span>
              <div className="row">
                <select value={planId} onChange={(e) => { setPlanId(e.target.value); setSuiteId(""); }}>
                  <option value="">— Sin plan (run suelto) —</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} · {p.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn sm" onClick={loadPlans}>
                  Cargar planes
                </button>
              </div>
            </label>
            <label>
              <span>Suite</span>
              <select value={suiteId} onChange={(e) => setSuiteId(e.target.value)} disabled={!planId}>
                <option value="">— Elegir suite —</option>
                {suites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id} · {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Nombre del run</span>
              <input value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="AI Testers — smoke sprint 12" />
            </label>
            <label>
              <span>Testers a incluir</span>
              <div className="chips">
                {testers.map((t) => (
                  <label key={t.config.id} className="chip">
                    <input
                      type="checkbox"
                      checked={selected.includes(t.config.id)}
                      onChange={(e) =>
                        setSelected(e.target.checked ? [...selected, t.config.id] : selected.filter((x) => x !== t.config.id))
                      }
                    />
                    {t.config.name} ({t.run.results.length})
                  </label>
                ))}
              </div>
            </label>
          </div>
          <div className="row">
            <button className="btn primary" onClick={publish} disabled={busy || disabled || selected.length === 0 || (!!planId && !suiteId)}>
              {busy ? "Publicando…" : "⇪ Publicar resultados"}
            </button>
          </div>
        </>
      )}
      {msg && (
        <div className={msg.ok ? "ok-box" : "error-box"}>
          {msg.text}{" "}
          {msg.url && (
            <a href={msg.url} target="_blank" rel="noreferrer">
              Abrir run en Azure DevOps ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
