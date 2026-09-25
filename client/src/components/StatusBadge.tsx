import type { TesterStatus } from "../../../shared/types";

export const STATUS_LABEL: Record<TesterStatus, string> = {
  idle: "Listo",
  starting: "Iniciando",
  running: "Ejecutando",
  paused: "Pausado",
  stopping: "Deteniendo",
  stopped: "Detenido",
  finished: "Finalizado",
  error: "Error",
};

export function isActive(s: TesterStatus) {
  return s === "starting" || s === "running" || s === "paused" || s === "stopping";
}

export function StatusBadge({ status }: { status: TesterStatus }) {
  return (
    <span className={`badge b-${status}`}>
      {(status === "running" || status === "starting") && <span className="pulse" />}
      {STATUS_LABEL[status]}
    </span>
  );
}
