# Prompts — Migración Twilio → Evolution API + Pool & QR Premium

Cada archivo es el prompt de arranque para una sesión de Claude Code.
Copiar y pegar el contenido del archivo al abrir una nueva sesión (contexto limpio).

## Sesiones del proyecto

| Sesión | Archivo | Modelo | Estado |
|---|---|---|---|
| EVO-02 | (no archivo, hecha junto con EVO-03) | sonnet | ✅ completa (2026-04-28) |
| EVO-03 | (no archivo, hecha junto con EVO-02) | sonnet | ✅ completa (2026-04-28) |
| EVO-04 | `SESSION-EVO-04.md` | sonnet | ⏳ pendiente — schema + QR onboarding premium + helpers |
| EVO-05 | `SESSION-EVO-05.md` | sonnet | ⏳ pendiente — sender pool LRU + tests |
| EVO-06 | `SESSION-EVO-06.md` | sonnet | ⏳ pendiente — refactor cron 1-msg-per-tick |
| EVO-07 | `SESSION-EVO-07.md` | sonnet | ⏳ pendiente — dashboard capacidad UI |
| EVO-08 | `SESSION-EVO-08.md` | sonnet | ⏳ pendiente — cleanup + tests E2E |

## Spec doc canónico

Toda la arquitectura en: [`docs/superpowers/specs/2026-04-29-evolution-pool-design.md`](../../../superpowers/specs/2026-04-29-evolution-pool-design.md)

Cada SESSION-EVO-XX.md asume que ya leíste el spec. El prompt es el plan táctico de la sesión.

## Cómo usar

1. Abrir nueva sesión de Claude Code (contexto limpio, modelo Sonnet).
2. Copiar el contenido completo del archivo `SESSION-EVO-XX.md` correspondiente.
3. Pegarlo como primer mensaje.
4. Claude lee el spec, ejecuta las tareas en orden, hace verificación, commitea, actualiza PROGRESS.md.
5. Al finalizar, indica el archivo de la siguiente sesión.

## Reglas operativas

- Commitear directo en `main` (Manuel trabaja sin feature branches).
- Una sesión = un commit (o pocos commits coherentes).
- PROGRESS.md se actualiza al final de cada sesión.
- Si una sesión queda a medias, dejar TODO marcados en PROGRESS.md y crear un nuevo prompt para la siguiente vuelta.

## Sesiones archivadas

`_archived/` contiene prompts viejos que fueron deprecados o reemplazados:
- `SESSION-EVO-01-DEFERIDO.md` — infra Railway, hecha manualmente por Manuel sin sesión.
- `SESSION-EVO-04-OLD-CUTOVER.md` — el viejo "big bang cutover" del scope original. Reemplazado por la nueva EVO-04 (premium UX).
