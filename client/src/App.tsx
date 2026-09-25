import { useEffect, useMemo, useState } from "react";
import type { TesterConfig, TesterView } from "../../shared/types";
import { api, useServerState, useToast } from "./store";
import { Sidebar } from "./components/Sidebar";
import { MainView } from "./components/MainView";
import { TesterForm } from "./components/TesterForm";
import { GlobalReport } from "./components/GlobalReport";
import { Login } from "./components/Login";

export function App() {
  const [session, setSession] = useState<{ accessEnabled: boolean; authorized: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then(setSession)
      .catch(() => setSession({ accessEnabled: false, authorized: true }));
  }, []);
  if (session === null) return <div className="login"><p className="muted">Cargando…</p></div>;
  if (session.accessEnabled && !session.authorized) {
    return <Login onDone={() => setSession({ ...session, authorized: true })} />;
  }
  return <Workspace />;
}

function Workspace() {
  const state = useServerState();
  const [report, setReport] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<{ open: boolean; editing?: TesterConfig }>({ open: false });
  const [toast, setToast] = useToast();

  const selected = useMemo(
    () => state.testers.find((t) => t.config.id === selectedId) ?? null,
    [state.testers, selectedId],
  );

  useEffect(() => {
    if (!selectedId && state.testers.length) setSelectedId(state.testers[0].config.id);
    if (selectedId && !state.testers.some((t) => t.config.id === selectedId)) {
      setSelectedId(state.testers[0]?.config.id ?? null);
    }
  }, [state.testers, selectedId]);

  const safe = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e: any) {
      setToast(e.message ?? String(e));
    }
  };

  const onAction = (t: TesterView, action: "start" | "stop" | "pause" | "resume") =>
    safe(() => api(`/testers/${t.config.id}/${action}`, "POST"));
  const onAll = (action: "start" | "stop") => safe(() => api(`/all/${action}`, "POST"));
  const onDelete = (t: TesterView) => {
    if (!confirm(`¿Eliminar el tester "${t.config.name}"?`)) return;
    safe(() => api(`/testers/${t.config.id}`, "DELETE"));
  };
  const onDuplicate = (t: TesterView) =>
    safe(async () => {
      const v = await api<TesterView>(`/testers/${t.config.id}/duplicate`, "POST");
      setSelectedId(v.config.id);
    });
  const onSave = (data: Partial<TesterConfig>) =>
    safe(async () => {
      const v = form.editing
        ? await api<TesterView>(`/testers/${form.editing.id}`, "PUT", data)
        : await api<TesterView>(`/testers`, "POST", data);
      setForm({ open: false });
      setSelectedId(v.config.id);
    });

  return (
    <div className="app">
      <MainView
        tester={selected}
        onAction={onAction}
        onEdit={(t) => setForm({ open: true, editing: t.config })}
        onCreate={() => setForm({ open: true })}
      />
      <Sidebar
        testers={state.testers}
        maxTesters={state.maxTesters}
        connected={state.connected}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreate={() => setForm({ open: true })}
        onAction={onAction}
        onAll={onAll}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onEdit={(t) => setForm({ open: true, editing: t.config })}
        onReport={() => setReport(true)}
      />
      {report && <GlobalReport testers={state.testers} onClose={() => setReport(false)} />}
      {form.open && <TesterForm initial={form.editing} onClose={() => setForm({ open: false })} onSave={onSave} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
