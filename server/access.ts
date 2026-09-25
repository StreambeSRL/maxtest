/**
 * Protección por contraseña compartida (ACCESS_PASSWORD) para cuando la app
 * está publicada en internet. Si la variable no está definida, no se pide nada.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const PASSWORD = process.env.ACCESS_PASSWORD || "";
const COOKIE = "ait_session";

export const accessEnabled = PASSWORD.length > 0;

function token(): string {
  return createHmac("sha256", "ai-testers:" + PASSWORD).update("session").digest("hex");
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  }
  return out;
}

export function isAuthorized(cookieHeader: string | undefined): boolean {
  if (!accessEnabled) return true;
  const c = parseCookies(cookieHeader)[COOKIE] || "";
  const t = token();
  return c.length === t.length && timingSafeEqual(Buffer.from(c), Buffer.from(t));
}

export function checkPassword(pw: string): boolean {
  const a = Buffer.from(pw || "");
  const b = Buffer.from(PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function setSessionCookie(res: Response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${token()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}`);
}

export function clearSessionCookie(res: Response) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
}

export function requireAccess(req: Request, res: Response, next: NextFunction) {
  if (isAuthorized(req.headers.cookie)) return next();
  res.status(401).json({ error: "Se requiere contraseña de acceso", authRequired: true });
}
