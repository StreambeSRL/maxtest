import { useEffect, useRef, useState } from "react";
import type { CaseResult, LogEntry, TesterView } from "../../../shared/types";
import { StatusBadge, isActive } from "./StatusBadge";

interface Props {
  tester: TesterView | null;
  onAction: (t: TesterView, a: "start" | "stop" | "pause" | "resume") => void;
  onEdit: (t: TesterView) => void;
  onCreate: () => void;
}

type Tab = "activity" | "results" | "summary" | "spec";

export function MainView({ tester, onAction, onEdit, onCreate }: Props) {
  const [tab, setTab] = useState<Tab>("activity");
  const [evidence, setEvidence] = useState<CaseResult | null>(null);
  const split = usePanelSplit();

  if (!tester) {
    return (
      <main className="main">
        <div className="hero">
          <h2>Simulá testers humanos con IA</h2>
          <p>
            Cada tester es una instancia independiente: su propio navegador, su propia sesión y su propio razonamiento.
            Le das la URL del sistema, los casos de prueba (más historias de usuario y criterios de aceptación si los tenés)
            y ejecuta un smoke test funcional desde la pantalla, como lo haría una persona.
          </p>
          <button className="btn primary lg" onClick={onCreate}>
            + Crear el primer tester
          </button>
          <ul className="hero-list">
            <li>Hasta 10 testers en paralelo, sin interferencia entre sí.</li>
            <li>Ves en vivo cómo navega la aplicación cada uno.</li>
            <li>Resultado por caso: passed, failed, blocked o skipped, con evidencia.</li>
            <li>Podés iniciar y detener todos juntos o cada uno por separado.</li>
          </ul>
        </div>
      </main>
    );
  }

  const { config, run } = tester;
  const active = isActive(run.status);
  const total = run.results.length;
  const passed = run.results.filter((r) => r.status === "passed").length;

  return (
    <main className="main" ref={split.mainRef}>
      <header className="main-head">
        <div className="main-title">
          <h2>{config.name}</h2>
          <StatusBadge status={run.status} />
        </div>
        <div className="main-controls">
          {!active && (
            <button className="btn primary" onClick={() => onAction(tester, "start")}>
              ▶ {run.status === "idle" ? "Iniciar" : "Reiniciar"}
            </button>
          )}
          {run.status === "running" && (
            <button className="btn" onClick={() => onAction(tester, "pause")}>
              ❚❚ Pausar
            </button>
          )}
          {run.status === "paused" && (
            <button className="btn primary" onClick={() => onAction(tester, "resume")}>
              ▶ Reanudar
            </button>
          )}
          {active && (
            <button className="btn danger" onClick={() => onAction(tester, "stop")}>
              ■ Detener
            </button>
          )}
          <button className="btn ghost" onClick={() => onEdit(tester)} disabled={active}>
            ✎ Editar
          </button>
          <a className="btn ghost" href={`/api/testers/${config.id}/report.md`} target="_blank" rel="noreferrer">
            ⇩ Reporte
          </a>
        </div>
      </header>

      <section className="viewer">
        <div className="urlbar">
          <span className={`led ${active ? "on" : ""}`} />
          <span className="url" title={run.currentUrl ?? config.baseUrl}>
            {run.currentUrl ?? config.baseUrl}
          </span>
          {run.currentTitle && <span className="ptitle">— {run.currentTitle}</span>}
          <span className="spacer" />
          <span className="meta">
            {run.turns} turnos · {fmtTokens(run.usage.input + run.usage.cacheRead)} in / {fmtTokens(run.usage.output)} out
          </span>
        </div>
        <div className="screen">
          {run.screenshot ? (
            <img src={run.screenshot} alt="Pantalla del tester" />
          ) : (
            <div className="screen-empty">
              {active ? "Abriendo el navegador…" : "Iniciá el tester para ver cómo navega la aplicación."}
            </div>
          )}
          {run.lastAction && active && <div className="screen-action">{run.lastAction}</div>}
        </div>
      </section>

      <div
        className={`splitter ${split.dragging ? "dragging" : ""}`}
        onPointerDown={split.startDrag}
        onDoubleClick={split.toggleHidden}
        role="separator"
        aria-orientation="horizontal"
        title="Arrastrá para cambiar el tamaño · doble clic para ocultar/mostrar"
      >
        <span className="grip" />
        <div className="splitter-actions" onPointerDown={(e) => e.stopPropagation()}>
          {split.mode === "hidden" ? (
            <button className="btn sm ghost" onClick={split.restore} title="Mostrar panel">
              ▲ Mostrar panel
            </button>
          ) : (
            <>
              <button
                className="btn sm ghost"
                onClick={split.mode === "max" ? split.restore : split.maximize}
                title={split.mode === "max" ? "Restaurar" : "Maximizar panel"}
              >
                {split.mode === "max" ? "▭" : "▲"}
              </button>
              <button className="btn sm ghost" onClick={split.hide} title="Ocultar panel">
                ▼
              </button>
            </>
          )}
        </div>
      </div>

      <section
        className={`panel ${split.mode === "hidden" ? "hidden" : ""}`}
        style={split.mode === "custom" ? { flex: `0 0 ${split.height}px` } : undefined}
        data-mode={split.mode}
      >
        <nav className="tabs">
          <button className={tab === "activity" ? "on" : ""} onClick={() => setTab("activity")}>
            Actividad
          </button>
          <button className={tab === "results" ? "on" : ""} onClick={() => setTab("results")}>
            Resultados {total > 0 && <span className="pill">{passed}/{total}</span>}
          </button>
          <button className={tab === "summary" ? "on" : ""} onClick={() => setTab("summary")}>
            Resumen
          </button>
          <button className={tab === "spec" ? "on" : ""} onClick={() => setTab("spec")}>
            Especificación
          </button>
        </nav>
        {tab === "activity" && <ActivityLog logs={run.logs} />}
        {tab === "results" && <Results results={run.results} onEvidence={setEvidence} />}
        {tab === "summary" && (
          <div className="summary">
            {run.error && <div className="error-box">{run.error}</div>}
            {run.summary ? <pre className="md">{run.summary}</pre> : <p className="muted">El resumen aparece cuando el tester termina.</p>}
          </div>
        )}
        {tab === "spec" && (
          <div className="spec">
            <SpecBlock title="Instrucciones" text={config.prompt} />
            <SpecBlock title="Casos de prueba" text={config.testCases} />
            <SpecBlock title="Historias de usuario" text={config.userStories} />
            <SpecBlock title="Criterios de aceptación" text={config.acceptanceCriteria} />
            <SpecBlock title="Datos de prueba" text={config.testData} />
          </div>
        )}
      </section>

      {evidence && (
        <div className="modal-backdrop" onClick={() => setEvidence(null)}>
          <div className="modal evidence" onClick={(e) => e.stopPropagation()}>
            <header>
              <strong>
                {evidence.caseId} — {evidence.title}
              </strong>
              <button className="btn ghost" onClick={() => setEvidence(null)}>
                ✕
              </button>
            </header>
            {evidence.evidence ? <img src={evidence.evidence} alt="Evidencia" /> : <p className="muted">Sin captura.</p>}
            <p>{evidence.notes}</p>
          </div>
        </div>
      )}
    </main>
  );
}

// ---------- Divisor redimensionable entre la pantalla y el panel ----------

type SplitMode = "default" | "custom" | "max" | "hidden";
const SPLIT_KEY = "ait.panelSplit";
const MIN_PANEL = 110;
const MIN_SCREEN = 140;

function loadSplit(): { mode: SplitMode; height: number } {
  try {
    const v = JSON.parse(localStorage.getItem(SPLIT_KEY) || "null");
    if (v && ["default", "custom", "max", "hidden"].includes(v.mode) && typeof v.height === "number") return v;
  } catch {}
  return { mode: "default", height: 320 };
}

function usePanelSplit() {
  const mainRef = useRef<HTMLElement>(null);
  const [state, setState] = useState(loadSplit);
  const [dragging, setDragging] = useState(false);
  // Último tamaño "normal" (por defecto o elegido arrastrando), para restaurar
  // después de ocultar o maximizar.
  const lastNormal = useRef<{ mode: SplitMode; height: number }>(
    state.mode === "default" || state.mode === "custom" ? state : { mode: "default", height: state.height },
  );

  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_KEY, JSON.stringify(state));
    } catch {}
    if (state.mode === "default" || state.mode === "custom") lastNormal.current = state;
  }, [state]);

  const startDrag = (e: React.PointerEvent) => {
    const main = mainRef.current;
    if (!main || e.button !== 0) return;
    e.preventDefault();
    setDragging(true);
    const rect = main.getBoundingClientRect();
    const header = main.querySelector(".main-head")?.getBoundingClientRect().height ?? 60;
    const maxPanel = rect.height - header - MIN_SCREEN;
    const onMove = (ev: PointerEvent) => {
      // 18px = margen inferior del panel
      const h = Math.round(rect.bottom - ev.clientY - 18);
      if (h < MIN_PANEL / 2) setState((s) => ({ ...s, mode: "hidden" }));
      else setState({ mode: "custom", height: Math.max(MIN_PANEL, Math.min(maxPanel, h)) });
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const hide = () => setState((s) => ({ ...s, mode: "hidden" }));
  const maximize = () => setState((s) => ({ ...s, mode: "max" }));
  const restore = () => setState(lastNormal.current);
  const toggleHidden = () => (state.mode === "hidden" ? restore() : hide());

  return { mainRef, mode: state.mode, height: state.height, dragging, startDrag, hide, maximize, restore, toggleHidden };
}

function fmtTokens(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function SpecBlock({ title, text }: { title: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="spec-block">
      <h4>{title}</h4>
      <pre>{text}</pre>
    </div>
  );
}

function ActivityLog({ logs }: { logs: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs, follow]);
  return (
    <div
      className="log"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
      }}
    >
      {logs.length === 0 && <p className="muted">Sin actividad todavía.</p>}
      {logs.map((l) => (
        <div key={l.id} className={`log-line k-${l.kind}`}>
          <span className="t">{new Date(l.at).toLocaleTimeString("es-AR")}</span>
          <span className="k">{KIND_ICON[l.kind]}</span>
          <span className="msg">{l.text}</span>
        </div>
      ))}
    </div>
  );
}

const KIND_ICON: Record<LogEntry["kind"], string> = {
  info: "ℹ",
  thought: "💭",
  action: "▸",
  result: "✔",
  error: "⚠",
  system: "⚙",
};

const CASE_LABEL: Record<CaseResult["status"], string> = {
  passed: "PASSED",
  failed: "FAILED",
  blocked: "BLOCKED",
  skipped: "SKIPPED",
};

function Results({ results, onEvidence }: { results: CaseResult[]; onEvidence: (r: CaseResult) => void }) {
  if (results.length === 0) return <p className="muted pad">Todavía no hay casos reportados.</p>;
  return (
    <table className="results">
      <thead>
        <tr>
          <th>Caso</th>
          <th>Título</th>
          <th>Estado</th>
          <th>Notas</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {results.map((r) => (
          <tr key={r.caseId} className={`r-${r.status}`}>
            <td className="mono">{r.caseId}</td>
            <td>{r.title}</td>
            <td>
              <span className={`case-badge cb-${r.status}`}>{CASE_LABEL[r.status]}</span>
            </td>
            <td className="notes">
              {r.notes}
              {r.steps && <details><summary>Pasos</summary>{r.steps}</details>}
            </td>
            <td>
              {r.evidence && (
                <button className="btn sm ghost" onClick={() => onEvidence(r)}>
                  📷
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
