import type { TesterView } from "../../../shared/types";
import { StatusBadge, isActive } from "./StatusBadge";

interface Props {
  testers: TesterView[];
  maxTesters: number;
  connected: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onAction: (t: TesterView, a: "start" | "stop" | "pause" | "resume") => void;
  onAll: (a: "start" | "stop") => void;
  onDelete: (t: TesterView) => void;
  onDuplicate: (t: TesterView) => void;
  onEdit: (t: TesterView) => void;
}

export function Sidebar(p: Props) {
  const running = p.testers.filter((t) => isActive(t.run.status)).length;
  const canAdd = p.testers.length < p.maxTesters;
  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <div className="brand">
          <span className="brand-dot" />
          <div>
            <h1>AI Testers</h1>
            <small>
              {p.testers.length}/{p.maxTesters} testers · {running} en ejecución
              <span className={`conn ${p.connected ? "on" : "off"}`} title={p.connected ? "Conectado" : "Sin conexión"} />
            </small>
          </div>
        </div>
        <div className="global-actions">
          <button className="btn primary" onClick={() => p.onAll("start")} disabled={p.testers.length === 0}>
            ▶ Iniciar todos
          </button>
          <button className="btn danger" onClick={() => p.onAll("stop")} disabled={running === 0}>
            ■ Detener todos
          </button>
        </div>
      </header>

      <div className="tester-list">
        {p.testers.map((t, i) => (
          <TesterCard
            key={t.config.id}
            index={i + 1}
            tester={t}
            selected={t.config.id === p.selectedId}
            onSelect={() => p.onSelect(t.config.id)}
            onAction={(a) => p.onAction(t, a)}
            onDelete={() => p.onDelete(t)}
            onDuplicate={() => p.onDuplicate(t)}
            onEdit={() => p.onEdit(t)}
          />
        ))}
        {p.testers.length === 0 && (
          <div className="empty-list">
            <p>Todavía no hay testers.</p>
            <p>Agregá uno con la URL del sistema y sus casos de prueba.</p>
          </div>
        )}
      </div>

      <footer className="sidebar-foot">
        <button className="btn add" onClick={p.onCreate} disabled={!canAdd} title={canAdd ? "" : `Máximo ${p.maxTesters}`}>
          + Agregar tester
        </button>
      </footer>
    </aside>
  );
}

function TesterCard({
  index,
  tester,
  selected,
  onSelect,
  onAction,
  onDelete,
  onDuplicate,
  onEdit,
}: {
  index: number;
  tester: TesterView;
  selected: boolean;
  onSelect: () => void;
  onAction: (a: "start" | "stop" | "pause" | "resume") => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
}) {
  const { config, run } = tester;
  const active = isActive(run.status);
  const counts = {
    passed: run.results.filter((r) => r.status === "passed").length,
    failed: run.results.filter((r) => r.status === "failed").length,
    blocked: run.results.filter((r) => r.status === "blocked").length,
    skipped: run.results.filter((r) => r.status === "skipped").length,
  };
  return (
    <div className={`tester-card ${selected ? "selected" : ""} st-${run.status}`} onClick={onSelect}>
      <div className="card-top">
        <div className="avatar">{index}</div>
        <div className="card-title">
          <strong title={config.name}>{config.name}</strong>
          <span className="card-url" title={config.baseUrl}>
            {config.baseUrl.replace(/^https?:\/\//, "")}
          </span>
        </div>
        <StatusBadge status={run.status} />
      </div>

      {run.screenshot && (
        <div className="card-thumb">
          <img src={run.screenshot} alt="" />
          {active && run.lastAction && <div className="card-action">{run.lastAction}</div>}
        </div>
      )}

      {run.results.length > 0 && (
        <div className="card-counts">
          <span className="c-passed">✓ {counts.passed}</span>
          <span className="c-failed">✗ {counts.failed}</span>
          <span className="c-blocked">⊘ {counts.blocked}</span>
          {counts.skipped > 0 && <span className="c-skipped">→ {counts.skipped}</span>}
        </div>
      )}

      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        {!active && (
          <button className="btn sm primary" onClick={() => onAction("start")} title="Iniciar">
            ▶ {run.status === "idle" ? "Iniciar" : "Reiniciar"}
          </button>
        )}
        {run.status === "running" && (
          <button className="btn sm" onClick={() => onAction("pause")} title="Pausar">
            ❚❚
          </button>
        )}
        {run.status === "paused" && (
          <button className="btn sm primary" onClick={() => onAction("resume")} title="Reanudar">
            ▶
          </button>
        )}
        {active && (
          <button className="btn sm danger" onClick={() => onAction("stop")} title="Detener">
            ■ Detener
          </button>
        )}
        <span className="spacer" />
        <button className="btn sm ghost" onClick={onEdit} disabled={active} title="Editar">
          ✎
        </button>
        <button className="btn sm ghost" onClick={onDuplicate} title="Duplicar">
          ⧉
        </button>
        <button className="btn sm ghost" onClick={onDelete} title="Eliminar">
          🗑
        </button>
      </div>
    </div>
  );
}
