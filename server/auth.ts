import fs from "node:fs";
import path from "node:path";

/**
 * El SDK resuelve credenciales solo (en este orden): ANTHROPIC_API_KEY →
 * ANTHROPIC_AUTH_TOKEN → perfil de `ant auth login` → Workload Identity
 * Federation (variables ANTHROPIC_FEDERATION_*) → perfil por defecto.
 * Acá solo detectamos cuál está disponible para avisar con claridad.
 */
export function detectAuth(): { ok: boolean; source: string; hint?: string } {
  if (process.env.ANTHROPIC_API_KEY) return { ok: true, source: "API key (ANTHROPIC_API_KEY)" };
  if (process.env.ANTHROPIC_AUTH_TOKEN) return { ok: true, source: "token OAuth (ANTHROPIC_AUTH_TOKEN)" };

  const wif = ["ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID", "ANTHROPIC_SERVICE_ACCOUNT_ID"];
  const wifToken = process.env.ANTHROPIC_IDENTITY_TOKEN_FILE || process.env.ANTHROPIC_IDENTITY_TOKEN;
  const wifSet = wif.filter((k) => process.env[k]);
  if (wifSet.length === wif.length && wifToken) return { ok: true, source: "Workload Identity Federation" };
  if (wifSet.length > 0 || wifToken) {
    const missing = [...wif.filter((k) => !process.env[k]), ...(wifToken ? [] : ["ANTHROPIC_IDENTITY_TOKEN_FILE"])];
    return { ok: false, source: "Workload Identity Federation incompleta", hint: `Faltan: ${missing.join(", ")}` };
  }

  const configDir =
    process.env.ANTHROPIC_CONFIG_DIR ||
    (process.platform === "win32"
      ? path.join(process.env.APPDATA || "", "Anthropic")
      : path.join(process.env.HOME || "", ".config", "anthropic"));
  const credDir = path.join(configDir, "credentials");
  try {
    const profiles = fs.readdirSync(credDir).filter((f) => f.endsWith(".json"));
    if (profiles.length > 0) {
      const p = process.env.ANTHROPIC_PROFILE;
      return { ok: true, source: `perfil de "ant auth login"${p ? ` (${p})` : ""}` };
    }
  } catch {}

  return {
    ok: false,
    source: "sin credenciales",
    hint:
      "Opciones: (1) ANTHROPIC_API_KEY en .env; (2) `ant auth login` en esta máquina; (3) variables ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID, ANTHROPIC_SERVICE_ACCOUNT_ID e ANTHROPIC_IDENTITY_TOKEN_FILE para Workload Identity Federation. Reiniciá el servidor después.",
  };
}
