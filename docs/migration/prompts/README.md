# Prompts de migración — Consolidación Monorepo

Cada archivo `SESSION-MIG-XX.md` es un prompt autocontenido para una sesión limpia de Claude Code.

## Modalidad de trabajo

1. Abrir una sesión **nueva** de Claude Code (contexto limpio, sin historial previo).
2. Setear el modelo que indica el archivo: `/model claude-opus-4-7` o `/model claude-sonnet-4-6`.
3. Copiar y pegar **todo el contenido** del `SESSION-MIG-XX.md` correspondiente como primer mensaje.
4. Claude ejecuta el scope cerrado, actualiza `docs/migration/PROGRESS.md` y confirma el cierre.
5. Al final de la sesión te indica cuál es el siguiente prompt.

## Índice

| Sesión | Modelo | Duración | Objetivo |
|---|---|---|---|
| [SESSION-MIG-01](SESSION-MIG-01.md) | Sonnet | 30–45 min | Pre-flight audit + backup + sincronización de ambos repos |
| [SESSION-MIG-02](SESSION-MIG-02.md) | Opus   | 45–90 min | Subtree merge preservando historial, gitlink roto eliminado |
| [SESSION-MIG-03](SESSION-MIG-03.md) | Sonnet | 30–60 min | Monorepo hygiene: README root, .gitignore, ARCHITECTURE, limpieza zip |
| [SESSION-MIG-04](SESSION-MIG-04.md) | Sonnet | 30–60 min | Rename GitHub + reconfigurar root directories en Railway y Vercel |
| [SESSION-MIG-05](SESSION-MIG-05.md) | Sonnet | 20–40 min | Archive apex-leads, verificación E2E, cierre de migración |

## Reglas globales

- No ejecutar acciones destructivas sin backup previo.
- No `git push --force` sobre master.
- Cada sesión commitea atómicamente y pushea antes de cerrar.
- Al cerrar, actualizar `docs/migration/PROGRESS.md`.
- Ante cualquier duda crítica: parar y consultar con Manuel.
