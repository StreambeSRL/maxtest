# AI Testers

Plataforma web para simular **testers humanos con IA**. Cada tester es una instancia
independiente (su propio navegador Chromium aislado + su propia conversación con Claude)
que ejecuta casos de prueba de tipo **smoke test / funcional desde la pantalla**, como lo
haría una persona: mira la captura, hace clic, escribe, verifica y reporta.

- Hasta **10 testers en paralelo**, sin interferencia entre sí (contextos de navegador aislados: cookies, storage y sesión separados).
- Barra derecha con los testers; al tocar uno, el centro muestra **en vivo** cómo navega la aplicación.
- Cada tester recibe: URL del sistema, instrucciones, casos de prueba (ya escritos), historias de usuario, criterios de aceptación y datos de prueba.
- Resultado por caso: `passed` / `failed` / `blocked` / `skipped`, con notas, pasos y captura de evidencia.
- Iniciar / pausar / detener **todos juntos o cada uno por separado**.
- Reporte descargable en Markdown por tester.
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
scripts/  smoke-tools.ts (prueba las herramientas sin API), ui-shot.ts (captura la UI)
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

## Notas

- Los testers no realizan acciones destructivas salvo que el caso lo indique; igual
  conviene apuntarlos a entornos de prueba.
- Los diálogos del navegador (alert/confirm) se aceptan automáticamente y quedan en el log.
- Costo: cada acción consume ~1.5k tokens de imagen más el texto; un caso típico son
  5–15 turnos. Ajustá `TESTER_EFFORT` y `TESTER_MAX_TURNS` según presupuesto.
