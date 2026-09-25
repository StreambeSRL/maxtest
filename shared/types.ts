// Tipos compartidos entre servidor y cliente.

export type TesterStatus =
  | "idle"
  | "starting"
  | "running"
  | "paused"
  | "stopping"
  | "stopped"
  | "finished"
  | "error";

export type CaseStatus = "passed" | "failed" | "blocked" | "skipped";

export interface TesterConfig {
  id: string;
  name: string;
  /** URL inicial del sistema bajo prueba */
  baseUrl: string;
  /** Contexto / instrucciones específicas para este tester */
  prompt: string;
  /** Casos de prueba ya escritos (texto libre, uno por línea o numerados) */
  testCases: string;
  /** Historias de usuario (opcional) */
  userStories: string;
  /** Criterios de aceptación (opcional) */
  acceptanceCriteria: string;
  /** Credenciales u otros datos de prueba (opcional) */
  testData: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaseResult {
  caseId: string;
  title: string;
  status: CaseStatus;
  notes: string;
  steps: string;
  evidence?: string; // data URL jpeg
  at: string;
}

export interface LogEntry {
  id: number;
  at: string;
  kind: "info" | "thought" | "action" | "result" | "error" | "system";
  text: string;
}

export interface TesterRunState {
  status: TesterStatus;
  startedAt?: string;
  finishedAt?: string;
  currentUrl?: string;
  currentTitle?: string;
  lastAction?: string;
  screenshot?: string; // data URL jpeg
  results: CaseResult[];
  logs: LogEntry[];
  summary?: string;
  error?: string;
  turns: number;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export interface TesterView {
  config: TesterConfig;
  run: TesterRunState;
}

export type ServerEvent =
  | { type: "snapshot"; testers: TesterView[]; limits: { maxTesters: number } }
  | { type: "tester_upsert"; tester: TesterView }
  | { type: "tester_removed"; id: string }
  | { type: "status"; id: string; status: TesterStatus; error?: string; summary?: string }
  | { type: "screenshot"; id: string; screenshot: string; url?: string; title?: string; lastAction?: string }
  | { type: "log"; id: string; entry: LogEntry }
  | { type: "case_result"; id: string; result: CaseResult }
  | { type: "usage"; id: string; usage: TesterRunState["usage"]; turns: number };

export const MAX_TESTERS = 10;
