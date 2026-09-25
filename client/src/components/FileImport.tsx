import { useRef, useState } from "react";
import { api } from "../store";

export const ACCEPT = ".txt,.md,.markdown,.csv,.tsv,.json,.docx,.xlsx,.xlsm,.xls,.pdf,.feature";

/** Lee los archivos en el navegador y pide al servidor el texto extraído. */
export async function extractFiles(list: FileList | File[]): Promise<{ texts: { name: string; text: string }[]; errors: string[] }> {
  const files = await Promise.all(
    Array.from(list).map(
      (f) =>
        new Promise<{ name: string; data: string }>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve({ name: f.name, data: String(r.result) });
          r.onerror = () => reject(new Error(`No se pudo leer ${f.name}`));
          r.readAsDataURL(f);
        }),
    ),
  );
  const res = await api<{ files: { name: string; text?: string; error?: string }[] }>("/extract", "POST", { files });
  const texts: { name: string; text: string }[] = [];
  const errors: string[] = [];
  for (const f of res.files) {
    if (f.text) texts.push({ name: f.name, text: f.text });
    else errors.push(`${f.name}: ${f.error ?? "sin texto"}`);
  }
  return { texts, errors };
}

/**
 * Campo de texto con botón "Cargar archivo" y soporte de arrastrar y soltar.
 * El texto extraído se agrega al contenido actual (separado por una línea).
 */
export function TextFieldWithImport({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [over, setOver] = useState(false);

  const load = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const { texts, errors } = await extractFiles(list);
      if (texts.length) {
        const chunks = texts.map((t) => (texts.length > 1 ? `# Archivo: ${t.name}\n${t.text}` : t.text));
        onChange([value.trim(), ...chunks].filter(Boolean).join("\n\n"));
        setMsg({ ok: true, text: `Importado: ${texts.map((t) => t.name).join(", ")}` });
      }
      if (errors.length) setMsg({ ok: false, text: errors.join(" · ") });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <label className={`field ${over ? "drop-over" : ""}`}>
      <span className="field-head">
        <span>{label}</span>
        <span className="field-tools">
          {msg && <em className={msg.ok ? "ok" : "err"}>{msg.text}</em>}
          <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => load(e.target.files)} />
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => input.current?.click()}
            disabled={busy}
            title="txt, md, csv, json, docx, xlsx, pdf, feature — o arrastrá los archivos sobre el campo"
          >
            {busy ? "Leyendo…" : "📎 Cargar archivo"}
          </button>
        </span>
      </span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          load(e.dataTransfer.files);
        }}
      />
    </label>
  );
}
