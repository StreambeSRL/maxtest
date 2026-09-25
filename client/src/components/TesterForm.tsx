import { useState } from "react";
import type { TesterConfig } from "../../../shared/types";
import { TextFieldWithImport } from "./FileImport";

interface Props {
  initial?: TesterConfig;
  onClose: () => void;
  onSave: (data: Partial<TesterConfig>) => void;
}

const EXAMPLE_CASES = `TC-01 Login exitoso
  Precondición: usuario válido.
  Pasos: ir a la pantalla de login, ingresar usuario y contraseña, presionar Ingresar.
  Resultado esperado: se muestra el panel principal con el nombre del usuario.

TC-02 Login con contraseña incorrecta
  Pasos: ingresar usuario válido y contraseña incorrecta.
  Resultado esperado: mensaje de error claro; no se accede al sistema.

(También podés cargar un archivo: txt, md, csv, xlsx, docx, pdf…)`;

export function TesterForm({ initial, onClose, onSave }: Props) {
  const [f, setF] = useState<Partial<TesterConfig>>({
    name: initial?.name ?? "",
    baseUrl: initial?.baseUrl ?? "",
    prompt: initial?.prompt ?? "",
    testCases: initial?.testCases ?? "",
    userStories: initial?.userStories ?? "",
    acceptanceCriteria: initial?.acceptanceCriteria ?? "",
    testData: initial?.testData ?? "",
  });
  const set = (k: keyof TesterConfig) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const valid = (f.baseUrl ?? "").trim().length > 3;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal form"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave(f);
        }}
      >
        <header>
          <strong>{initial ? "Editar tester" : "Nuevo tester"}</strong>
          <button type="button" className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="form-grid">
          <label>
            <span>Nombre</span>
            <input value={f.name} onChange={(e) => set("name")(e.target.value)} placeholder="Ej: Tester Login" />
          </label>
          <label>
            <span>URL del sistema a probar *</span>
            <input value={f.baseUrl} onChange={(e) => set("baseUrl")(e.target.value)} placeholder="https://mi-app.com" required />
          </label>
        </div>

        <TextFieldWithImport
          label="Instrucciones / contexto para el tester"
          rows={3}
          value={f.prompt ?? ""}
          onChange={set("prompt")}
          placeholder="Ej: Es un sistema de gestión de turnos. Probá como usuario recepcionista. No crees más de 2 turnos."
        />

        <TextFieldWithImport
          label="Casos de prueba * (ya escritos)"
          rows={9}
          value={f.testCases ?? ""}
          onChange={set("testCases")}
          placeholder={EXAMPLE_CASES}
        />

        <div className="form-grid">
          <TextFieldWithImport
            label="Historias de usuario (opcional)"
            rows={5}
            value={f.userStories ?? ""}
            onChange={set("userStories")}
            placeholder="Como <rol> quiero <acción> para <beneficio>…"
          />
          <TextFieldWithImport
            label="Criterios de aceptación (opcional)"
            rows={5}
            value={f.acceptanceCriteria ?? ""}
            onChange={set("acceptanceCriteria")}
            placeholder="Dado… cuando… entonces…"
          />
        </div>

        <TextFieldWithImport
          label="Datos de prueba / credenciales (opcional)"
          rows={2}
          value={f.testData ?? ""}
          onChange={set("testData")}
          placeholder="usuario: demo / clave: demo123 — solo entornos de prueba"
        />

        <footer>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={!valid}>
            {initial ? "Guardar cambios" : "Crear tester"}
          </button>
        </footer>
      </form>
    </div>
  );
}
