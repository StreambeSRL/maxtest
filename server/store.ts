import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TesterConfig, TesterRunState } from "../shared/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(here, "../data");
const FILE = path.join(DATA_DIR, "state.json");

export interface PersistedTester {
  config: TesterConfig;
  run: TesterRunState;
}

export function loadState(): PersistedTester[] {
  try {
    if (!fs.existsSync(FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(raw.testers) ? raw.testers : [];
  } catch {
    return [];
  }
}

let timer: NodeJS.Timeout | null = null;
let pending: PersistedTester[] | null = null;

/** Guardado con debounce para no escribir en cada evento. */
export function saveState(testers: PersistedTester[]) {
  pending = testers;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const data = pending;
    pending = null;
    if (!data) return;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      // No persistimos la captura "en vivo" (pesada y volátil); sí las evidencias.
      const slim = data.map((t) => ({ config: t.config, run: { ...t.run, screenshot: undefined } }));
      fs.writeFileSync(FILE, JSON.stringify({ testers: slim }, null, 0), "utf8");
    } catch (err) {
      console.error("No se pudo guardar el estado:", err);
    }
  }, 800);
}
