import { useEffect, useReducer, useRef, useState } from "react";
import type { ServerEvent, TesterView } from "../../shared/types";

export interface State {
  testers: TesterView[];
  maxTesters: number;
  connected: boolean;
}

type Action = { type: "event"; ev: ServerEvent } | { type: "connected"; value: boolean };

function reducer(state: State, action: Action): State {
  if (action.type === "connected") return { ...state, connected: action.value };
  const ev = action.ev;
  const update = (id: string, fn: (t: TesterView) => TesterView) => ({
    ...state,
    testers: state.testers.map((t) => (t.config.id === id ? fn(t) : t)),
  });
  switch (ev.type) {
    case "snapshot":
      return { ...state, testers: ev.testers, maxTesters: ev.limits.maxTesters };
    case "tester_upsert": {
      const exists = state.testers.some((t) => t.config.id === ev.tester.config.id);
      return {
        ...state,
        testers: exists
          ? state.testers.map((t) => (t.config.id === ev.tester.config.id ? ev.tester : t))
          : [...state.testers, ev.tester],
      };
    }
    case "tester_removed":
      return { ...state, testers: state.testers.filter((t) => t.config.id !== ev.id) };
    case "status":
      return update(ev.id, (t) => ({
        ...t,
        run: {
          ...t.run,
          status: ev.status,
          error: ev.error ?? t.run.error,
          summary: ev.summary ?? t.run.summary,
          finishedAt: ["finished", "stopped", "error"].includes(ev.status) ? new Date().toISOString() : t.run.finishedAt,
        },
      }));
    case "screenshot":
      return update(ev.id, (t) => ({
        ...t,
        run: {
          ...t.run,
          screenshot: ev.screenshot,
          currentUrl: ev.url ?? t.run.currentUrl,
          currentTitle: ev.title ?? t.run.currentTitle,
          lastAction: ev.lastAction ?? t.run.lastAction,
        },
      }));
    case "log":
      return update(ev.id, (t) => ({ ...t, run: { ...t.run, logs: [...t.run.logs.slice(-399), ev.entry] } }));
    case "case_result":
      return update(ev.id, (t) => {
        const idx = t.run.results.findIndex((r) => r.caseId === ev.result.caseId);
        const results = idx >= 0 ? t.run.results.map((r, i) => (i === idx ? ev.result : r)) : [...t.run.results, ev.result];
        return { ...t, run: { ...t.run, results } };
      });
    case "usage":
      return update(ev.id, (t) => ({ ...t, run: { ...t.run, usage: ev.usage, turns: ev.turns } }));
    default:
      return state;
  }
}

export function useServerState(): State {
  const [state, dispatch] = useReducer(reducer, { testers: [], maxTesters: 10, connected: false });
  const retry = useRef(1000);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        retry.current = 1000;
        dispatch({ type: "connected", value: true });
      };
      ws.onmessage = (m) => dispatch({ type: "event", ev: JSON.parse(m.data) });
      ws.onclose = () => {
        dispatch({ type: "connected", value: false });
        if (!closed) {
          setTimeout(connect, retry.current);
          retry.current = Math.min(retry.current * 2, 10000);
        }
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, []);

  return state;
}

export async function api<T = any>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  return [toast, setToast] as const;
}
