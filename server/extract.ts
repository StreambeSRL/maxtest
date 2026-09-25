/**
 * Extrae texto plano de archivos subidos (casos de prueba, historias, criterios)
 * para volcarlo en los campos del tester.
 */
import path from "node:path";

export const SUPPORTED_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".docx", ".xlsx", ".xlsm", ".xls", ".pdf", ".feature"];
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function extractText(fileName: string, data: Buffer): Promise<string> {
  const ext = path.extname(fileName).toLowerCase();
  if (data.length > MAX_FILE_BYTES) throw new Error("El archivo supera los 15 MB");
  switch (ext) {
    case ".txt":
    case ".md":
    case ".markdown":
    case ".csv":
    case ".tsv":
    case ".feature":
      return decodeText(data);
    case ".json": {
      const txt = decodeText(data);
      try {
        return JSON.stringify(JSON.parse(txt), null, 2);
      } catch {
        return txt;
      }
    }
    case ".docx": {
      const mammoth = await import("mammoth");
      const r = await mammoth.extractRawText({ buffer: data });
      return r.value.trim();
    }
    case ".xlsx":
    case ".xlsm":
    case ".xls": {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(data, { type: "buffer" });
      const parts: string[] = [];
      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
        if (!rows.length) continue;
        parts.push(`## Hoja: ${name}`);
        for (const row of rows) {
          const cells = row.map((c) => String(c ?? "").replace(/\s+/g, " ").trim());
          if (cells.some(Boolean)) parts.push(cells.join(" | "));
        }
        parts.push("");
      }
      return parts.join("\n").trim();
    }
    case ".pdf": {
      const { extractText: pdfText } = await import("unpdf");
      const r = await pdfText(new Uint8Array(data), { mergePages: true });
      const text = Array.isArray(r.text) ? r.text.join("\n\n") : String(r.text ?? "");
      return text.trim();
    }
    default:
      throw new Error(`Formato no soportado: ${ext || "(sin extensión)"}. Usá ${SUPPORTED_EXTENSIONS.join(", ")}`);
  }
}

function decodeText(buf: Buffer): string {
  // UTF-8 con o sin BOM; si tiene muchos caracteres de reemplazo, probar latin1 (Windows)
  let s = buf.toString("utf8").replace(/^﻿/, "");
  const bad = (s.match(/�/g) || []).length;
  if (bad > 0 && bad > s.length / 200) s = buf.toString("latin1");
  return s.replace(/\r\n/g, "\n").trim();
}
