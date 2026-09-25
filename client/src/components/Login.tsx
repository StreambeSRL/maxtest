import { useState } from "react";

export function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Error");
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form onSubmit={submit}>
        <div className="brand">
          <span className="brand-dot" />
          <h1>AI Testers</h1>
        </div>
        <p className="muted">Ingresá la contraseña de acceso para usar la plataforma.</p>
        <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Contraseña" />
        {err && <div className="error-box">{err}</div>}
        <button className="btn primary" disabled={busy || !pw}>
          Entrar
        </button>
      </form>
    </div>
  );
}
