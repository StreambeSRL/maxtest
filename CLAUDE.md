# AI Testers (maxtest)

Plataforma web de testers humanos simulados con IA. Cada tester es un loop agéntico de Claude
que maneja su propio BrowserContext de Playwright y ejecuta smoke/funcional desde la pantalla.
Hasta 10 en paralelo. La interfaz y todo el texto para el usuario están en español rioplatense.

## Correr y verificar

```bash
npm install                 # postinstall baja Chromium; si npm lo bloquea: npx playwright install chromium
npm run build && npm start  # http://localhost:4321  (el server sirve dist/client)
npm run dev                 # vite en :5173 con proxy a :4321
npm run typecheck           # tsc de server y client; correrlo antes de cada commit
```

Scripts de verificación en `scripts/`, todos con `npx tsx`:
- `smoke-tools.ts`: prueba las herramientas del navegador contra saucedemo.com sin llamar a la API.
- `ui-shot.ts`: capturas de la UI en `data/ui-*.png`. Acepta `URL=` y `ACCESS_PASSWORD=`.
- `splitter-test.ts`, `logout-test.ts`: pruebas de interacción de la UI. Aceptan `URL=` y `ACCESS_PASSWORD=`.
- `make-samples.ts`: genera archivos de ejemplo en `data/samples/` para probar la importación.

Una corrida real de un tester gasta crédito de Anthropic (unos 0,20 USD por 3 casos). No lanzarla sin necesidad.

## Arquitectura

- `server/index.ts`: Express + WebSocket `/ws`. Rutas `/api/testers`, `/api/all/:action`, `/api/report.:fmt`, `/api/azdo/*`, `/api/extract`, `/api/login|logout|session`.
- `server/runner.ts`: `TesterRunner`, loop manual de tool use con `@anthropic-ai/sdk` (`client.beta.messages.create`), con start/stop/pause/resume, prompt caching y context management (`clear_tool_uses`).
- `server/tools.ts`: definiciones de herramientas (`strict: true`), validación con zod y ejecución en Playwright.
- `server/prompt.ts`: el "skill" de QA Tester Senior. Es el system prompt estable y se cachea, así que no hay que meterle nada volátil.
- `server/browser.ts`: un Chromium compartido, un BrowserContext aislado por tester.
- `server/report.ts`: reporte consolidado en JSON, Markdown, CSV, JUnit y HTML. `server/azdo.ts`: API REST 7.1 de Test Runs.
- `server/extract.ts`: texto de txt/md/csv/json/docx (mammoth)/xlsx (xlsx)/pdf (unpdf).
- `server/access.ts`: contraseña compartida `ACCESS_PASSWORD` con cookie HMAC. Protege también el WebSocket.
- `server/auth.ts`: detecta la credencial de Anthropic (API key, perfil de `ant`, o Workload Identity Federation).
- `server/store.ts`: persiste en `data/state.json`, que está en .gitignore.
- `client/src`: React + Vite. `store.ts` es el reducer de eventos del WebSocket. Componentes en `components/`.
- `shared/types.ts`: tipos compartidos, incluidos los eventos del servidor.

## Trampas conocidas

- Un `tool_result` con `is_error: true` solo acepta texto. Si se le agrega una imagen, la API devuelve 400.
- Dockerfile: `NODE_ENV=production` va **después** de `npm ci --include=dev`. Si no, vite no se instala y el build falla.
- El modelo por defecto es `claude-opus-5` (`TESTER_MODEL`). Si se cambia a Fable 5.1 u Opus 5.5, esos modelos no aceptan `tool_choice` forzado. Hoy no se usa, pero hay que tenerlo en cuenta.
- El matching con Azure DevOps usa el ID de work item dentro del caseId (`12345`, `TC-12345`) o el título. El prompt pide conservar los IDs originales.

## Deploy

- Repo: `StreambeSRL/maxtest`, rama `main`. Cada push redespliega solo en Render (https://ai-testers.onrender.com), en unos 3 min.
- Render: blueprint `render.yaml`, Docker, plan Standard, disco en `/app/data`. Las variables se cargan en el dashboard. Nunca en el repo.
- Para confirmar un deploy: buscar un string nuevo dentro del `assets/index-*.js` que sirve la URL.
- Commits con autor `Gastón Gugliotta <gaston.gugliotta@streambe.com>`.

## Secretos

`.env` está en .gitignore. Nunca commitear claves ni copiarlas a documentación. Variables: `ANTHROPIC_API_KEY`, `ACCESS_PASSWORD`,
`AZURE_DEVOPS_ORG/PROJECT/PAT`, `TESTER_MODEL`, `TESTER_EFFORT`, `TESTER_MAX_TURNS`, `HEADED`, `PORT`. Ver `.env.example`.
