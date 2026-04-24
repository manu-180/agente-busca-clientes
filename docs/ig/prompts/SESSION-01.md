# SESSION-01 — Auditoría + Hardening + Docs

**Modelo recomendado:** `claude-sonnet-4-6`
**Permisos recomendados:** edit, write, bash (para leer archivos y hacer commits)
**Duración estimada:** 45–60 min

---

## Rol y contexto

Sos un ingeniero backend senior con experiencia en Next.js 14, TypeScript estricto, Supabase y arquitectura limpia. Vas a trabajar en el proyecto "Agente Instagram APEX" de Manuel.

**Trabajo previo:** En una sesión anterior se diseñó el plan maestro completo del proyecto. Está guardado en `docs/ig/MASTER-PLAN.md` y el estado vivo en `docs/ig/PROGRESS.md`. Empezás SESSION-01 (TANDA 0).

## Paso 0 — Orientación (OBLIGATORIO)

Antes de escribir NADA de código, ejecutá en orden:

1. Leé `docs/ig/MASTER-PLAN.md` completo (plan inmutable)
2. Leé `docs/ig/PROGRESS.md` completo (estado vivo)
3. Leé este prompt (SESSION-01.md) entero
4. Confirmá con el usuario en 1–2 oraciones que entendés el scope de esta sesión antes de arrancar

## Scope de SESSION-01

### Objetivo único
Dejar el código Next.js existente del módulo IG auditado, con validación estricta de env vars, y documentar el contrato HTTP del sidecar para que la próxima sesión pueda construirlo sin ambigüedades.

### Tareas concretas

#### 1. Auditoría del código IG existente
Scan de los siguientes paths en `apex-leads/`:
- `src/lib/ig/**/*.ts`
- `src/app/api/ig/**/*.ts`
- `src/app/api/cron/ig-*/**/*.ts`
- `src/app/api/webhooks/apify/**/*.ts`
- `src/app/admin/ig/**/*.tsx`

Buscar: `TODO`, `FIXME`, `XXX`, `HACK`, env vars usadas sin validación, tipos `any`, imports rotos, bugs obvios.

Entregar una tabla en markdown en el comentario del commit con:
| archivo:línea | severidad | issue | acción |

**NO corregir todo** — solo correcciones obvias y seguras (tipos `any` triviales, imports rotos). Bugs complejos se documentan para sesiones futuras.

#### 2. Crear `apex-leads/src/lib/ig/config.ts`

Módulo que centraliza y valida con Zod todas las env vars IG. Debe:
- Fallar fast en boot si falta alguna crítica en producción
- Permitir modo "build" (tolerante) para que Vercel pueda compilar
- Exportar tipado estricto (no `process.env.X!` inline en el resto del código)

Env vars a validar:
- `IG_SIDECAR_URL` (url) — required en runtime
- `IG_SIDECAR_SECRET` (min 32 chars) — required en runtime
- `IG_SENDER_USERNAME` (string) — required en runtime
- `APIFY_TOKEN` (string) — required en runtime
- `APIFY_WEBHOOK_SECRET` (min 32 chars) — required en runtime
- `CRON_SECRET` (min 32 chars) — required en runtime
- `DRY_RUN` (coerced boolean, default false)
- `ANTHROPIC_API_KEY` (string, starts with `sk-ant-`)

Después, refactorizar los usos existentes de esas env vars en el código IG para usar este módulo. NO tocar env vars de WhatsApp (Twilio, Wassenger) — están en otro módulo.

#### 3. Limpiar `demos_rubro` en Supabase

El row del slug de moda tiene `strong_keywords` contaminados con palabras rotas (`"de"`, `"mujer,"`, etc.). Usar MCP de Supabase (proyecto `hpbxscfbnhspeckdmkvu`) para:
- UPDATE el row con slug que empieza con `tienda-de-ropa-femenina-...`
- Setear `strong_keywords` limpio: `["boutique", "moda mujer", "ropa mujer", "indumentaria femenina", "tienda ropa", "moda femenina"]`
- `weak_keywords`: `["tienda", "ropa", "femenina", "moda"]`
- `negative_keywords`: `["mayorista", "distribuidora", "deportiva", "mascota", "niños"]`

#### 4. Crear `docs/ig/SIDECAR-CONTRACT.md`

Documentación del contrato HTTP del sidecar Python que SESSION-02/03 va a construir. Incluir:
- Auth HMAC (algoritmo, header, cómo generar/verificar)
- Cada endpoint con: método, path, req schema JSON, resp schema JSON, error codes
- Ejemplos curl con firma válida
- Tabla de errores de instagrapi que el sidecar debe mapear a qué respuesta HTTP

Basate en `apex-leads/src/lib/ig/sidecar.ts` — ese archivo define los tipos desde Next.js, el doc debe matchear exactamente.

### Fuera de scope (NO hacer ahora)
- NO empezar a construir el sidecar Python
- NO deployar nada
- NO tocar crons o templates de mensajes
- NO refactor masivo — solo fixes seguros

## Definición de "terminado"

- [ ] Tabla de auditoría escrita (en commit msg o en `docs/ig/AUDIT-2026-04-23.md`)
- [ ] `apex-leads/src/lib/ig/config.ts` creado, Zod funcionando, `npm run build` pasa
- [ ] Usos de env vars IG refactorizados a usar `config.ts`
- [ ] `demos_rubro` row de moda limpio en Supabase
- [ ] `docs/ig/SIDECAR-CONTRACT.md` escrito
- [ ] `PROGRESS.md` actualizado: marcar SESSION-01 done, agregar decisiones/notas
- [ ] `docs/ig/prompts/SESSION-02.md` creado con el prompt detallado para la próxima sesión
- [ ] Commit: `chore(ig): session-01 audit, config hardening, sidecar contract docs`

## Al terminar la sesión

Escribí `docs/ig/prompts/SESSION-02.md` siguiendo exactamente el formato de este archivo. El contenido de SESSION-02 debe ser:

**SESSION-02 — Sidecar Python: scaffolding + HMAC + stubs**
- Modelo: `claude-opus-4-7`
- Scope: crear carpeta `sidecar/` en raíz del repo con FastAPI + Dockerfile + railway.toml, middleware HMAC funcionando, 4 endpoints (`/dm/send`, `/inbox/poll`, `/profile/enrich`, `/health`) devolviendo datos stub pero con schema correcto, pytest para middleware HMAC, test local con curl.
- Referencias obligatorias: `docs/ig/MASTER-PLAN.md` secciones 3 y 4, `docs/ig/SIDECAR-CONTRACT.md` (creado en SESSION-01)
- Fuera de scope: instagrapi real (va en SESSION-03), deploy Railway (va en SESSION-04)

Luego, como mensaje final al usuario:
1. Resumir en 3-5 bullets qué se hizo
2. Listar bloqueos o inputs humanos necesarios antes de SESSION-02
3. Mostrar el comando exacto para arrancar SESSION-02:
   ```
   Nueva sesión de Claude Code → /model claude-opus-4-7 → copiar contenido de docs/ig/prompts/SESSION-02.md
   ```

## Reglas generales para TODA sesión de este proyecto

1. **Siempre leer MASTER-PLAN.md y PROGRESS.md primero**. No asumir nada.
2. **Actualizar PROGRESS.md al final**. Es la memoria.
3. **Escribir el SESSION-(XX+1).md al final**. Es el handoff.
4. **Commits atómicos** con prefijo `feat(ig):`, `fix(ig):`, `chore(ig):`, `docs(ig):` según corresponda.
5. **Nunca editar MASTER-PLAN.md** salvo erratas o clarificaciones. Cambios de alcance se discuten con Manuel y se documentan en PROGRESS.md como decisión.
6. **Stack fijo**: Next.js 14 + TypeScript strict + Supabase + Python 3.11 (sidecar/scheduler) + instagrapi. NO proponer alternativas salvo que Manuel lo pida.
7. **No emojis** en código ni docs (sí en conversación con Manuel si ayuda a la claridad).
8. **Arquitectura limpia**: separación de concerns, funciones chicas, tests donde aporte, sin abstracciones prematuras.
