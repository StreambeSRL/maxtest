# AI Testers

Plataforma web para simular **testers humanos con IA**. Cada tester es una instancia
independiente (su propio navegador Chromium aislado + su propia conversación con Claude)
que ejecuta casos de prueba de tipo **smoke test / funcional desde la pantalla**, como lo
haría una persona: mira la captura, hace clic, escribe, verifica y reporta.

- Hasta **10 testers en paralelo**, sin interferencia entre sí (contextos de navegador aislados: cookies, storage y sesión separados).
- Barra derecha con los testers; al tocar uno, el centro muestra **en vivo** cómo navega la aplicación.
- Cada tester recibe: URL del sistema, instrucciones, casos de prueba (ya escritos), historias de usuario, criterios de aceptación y datos de prueba. Cada campo se escribe a mano o se **importa desde archivos** (txt, md, csv, json, docx, xlsx, pdf, feature), con botón o arrastrando el archivo sobre el campo.
- Resultado por caso: `passed` / `failed` / `blocked` / `skipped`, con notas, pasos y captura de evidencia.
- Iniciar / pausar / detener **todos juntos o cada uno por separado**.
- Reporte consolidado de todos los testers descargable en HTML, JUnit XML, CSV, Markdown y JSON, y publicación directa en Azure DevOps Test Plans.
- Skill de **QA Tester Senior** (prompt de sistema en `server/prompt.ts`).

## Requisitos

- Node.js 20+ (probado con 24)
- Una clave de API de Anthropic (`ANTHROPIC_API_KEY`)

## Instalación

```bash
npm install
npx playwright install chromium   # si npm bloqueó el postinstall
cp .env.example .env               # y completar ANTHROPIC_API_KEY
```

## Ejecución

```bash
npm run build   # compila el frontend en dist/client
npm start       # http://localhost:4321
```

Modo desarrollo (frontend con recarga en caliente en http://localhost:5173, API en 4321):

```bash
npm run dev
```

## Configuración (`.env`)

| Variable | Default | Descripción |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Clave de la API (obligatoria) |
| `TESTER_MODEL` | `claude-opus-5` | Modelo que usan los testers |
| `TESTER_EFFORT` | `medium` | Profundidad de razonamiento: `low` / `medium` / `high` / `xhigh` / `max` |
| `TESTER_MAX_TURNS` | `200` | Tope de turnos de API por corrida (control de costo) |
| `PORT` | `4321` | Puerto del servidor |
| `HEADED` | `false` | `true` para ver los navegadores reales en el escritorio |
| `ACCESS_PASSWORD` | — | Contraseña compartida para proteger la app publicada |
| `AZURE_DEVOPS_ORG` / `_PROJECT` / `_PAT` | — | Publicación de resultados en Test Plans |

## Arquitectura

```
client/   React + Vite. Barra de testers (derecha), visor en vivo (centro), pestañas
          Actividad / Resultados / Resumen / Especificación. Se conecta por WebSocket.
server/   Express + ws + Playwright + @anthropic-ai/sdk
  index.ts   API REST (/api/testers…), WebSocket (/ws), sirve dist/client
  runner.ts  TesterRunner: loop agéntico por tester (start/stop/pause/resume)
  tools.ts   Herramientas del navegador (navigate, snapshot, click, type, select,
             press, scroll, wait, get_text, screenshot, report_case, finish)
  prompt.ts  Skill de QA Tester Senior + armado de la asignación
  browser.ts Pool de Chromium: un proceso, un BrowserContext aislado por tester
  store.ts   Persistencia en data/state.json (configs + últimos resultados)
shared/   Tipos compartidos
scripts/  smoke-tools.ts (prueba las herramientas sin API), ui-shot.ts (captura la UI),
          make-samples.ts (genera archivos de ejemplo para probar la importación)
```

Cómo funciona una corrida: el runner abre un contexto de navegador, le manda a Claude la
asignación (casos, historias, criterios) y entra en un loop de tool use. Después de cada
acción el tester recibe una captura JPEG + URL/título; esa misma captura se transmite por
WebSocket al frontend. `report_case` registra resultados con evidencia y `finish` cierra
con un resumen ejecutivo. Se usa prompt caching (sistema + herramientas estables) y
limpieza automática de resultados de herramientas viejos (context management) para que
corridas largas no desborden el contexto.

## Pruebas rápidas sin API

```bash
npx tsx scripts/smoke-tools.ts   # navega saucedemo.com con las herramientas y valida errores
```

## Reporte consolidado y Azure DevOps

El botón **Reporte consolidado** (barra derecha) muestra todos los casos de todos los testers y permite descargar:

| Formato | Uso |
|---|---|
| `/api/report.html` | Reporte autocontenido con evidencias, para compartir |
| `/api/report.xml` | **JUnit XML**: se importa en Azure Pipelines con la tarea `PublishTestResults@2` (`testResultsFormat: JUnit`) y aparece en la pestaña Tests del pipeline |
| `/api/report.csv` | Excel / importación genérica |
| `/api/report.md` | Markdown para wiki o PR |
| `/api/report.json` | Integraciones propias |

**Publicación directa en Test Plans.** Con `AZURE_DEVOPS_ORG`, `AZURE_DEVOPS_PROJECT` y `AZURE_DEVOPS_PAT`
(scopes: *Test Management: Read & write*, *Work Items: Read*) el reporte crea un **Test Run** en el
proyecto con un resultado por caso y la captura como adjunto. Si elegís plan y suite, cada caso
actualiza el outcome de su *test point*: el matching es por ID de work item dentro del identificador
del caso (ej. `12345`, `#12345`, `TC-12345`) o, si no, por título exacto. Para que funcione, cargá
los casos en el tester con el ID de Azure DevOps como identificador.

## Publicación (deploy)

La app necesita un servidor Node con Chromium, así que no corre en hosting estático ni serverless.
Incluye `Dockerfile` (imagen oficial de Playwright), `render.yaml` (Render) y `fly.toml` (Fly.io).

- **Render:** New → Blueprint → conectar el repo → completar las variables marcadas `sync: false`.
- **Fly.io:** `fly launch --copy-config --no-deploy`, `fly secrets set ANTHROPIC_API_KEY=... ACCESS_PASSWORD=...`, `fly deploy`.
- **Cualquier VPS con Docker:** `docker build -t ai-testers . && docker run -d -p 80:4321 --env-file .env -v ai-testers-data:/app/data ai-testers`

Definí siempre `ACCESS_PASSWORD` al publicarla: protege la interfaz y la API con una contraseña
compartida (cookie de sesión de 30 días). Sin esa variable la app queda abierta.

## Notas

- Los testers no realizan acciones destructivas salvo que el caso lo indique; igual
  conviene apuntarlos a entornos de prueba.
- Los diálogos del navegador (alert/confirm) se aceptan automáticamente y quedan en el log.
- Costo: cada acción consume ~1.5k tokens de imagen más el texto; un caso típico son
  5–15 turnos. Ajustá `TESTER_EFFORT` y `TESTER_MAX_TURNS` según presupuesto.
