# Prompts de sesión — Discovery System v2

## Cómo funciona

1. Cada archivo `SESSION-DXX.md` es un **prompt completo y autocontenido** para una sesión nueva de Claude Code.
2. Manuel arranca una sesión limpia (Ctrl+L o `/clear`), copia el contenido del `.md` y lo pega.
3. El modelo recomendado está al tope del prompt — Manuel selecciona Opus o Sonnet en Claude Code antes de pegar.
4. Al final de cada sesión Claude actualiza `PROGRESS.md` y crea/ajusta el siguiente prompt si hace falta.

## Reglas que TODO prompt sigue

- Lee `MASTER-PLAN.md` y `ARCHITECTURE.md` ANTES de codear.
- Lee `PROGRESS.md` para conocer estado actual y bloqueos.
- Trabaja en una rama dedicada (`feat/discovery-dXX-<slug>`).
- Tests verdes antes de commit.
- Commit message: `feat(discovery): DXX <título corto>` o `fix(discovery): ...`
- NO toca código WhatsApp (`apex-leads/src/app/api/twilio/`, `wassenger`).
- NO inventa columnas — usa el schema definido en `ARCHITECTURE.md` § 4.
- Si descubre algo que cambia el plan: lo anota en `PROGRESS.md` § "Decisiones de scope" y avisa.

## Orden de ejecución

```
D01 → D02 → D03 → D04 → D05 → D06 → D07 → D08 → D09 → D10 → D11 → D12 → D13 → D14
       (Phase 1)          (Phase 2)          (Phase 3)    (Phase 4)    (Phase 5)
```

Algunas sesiones pueden ser paralelizables si Manuel decide trabajar en varias máquinas, pero el flujo recomendado es lineal porque cada fase depende de la anterior.

## Pre-flight check antes de cada sesión

- ✅ Sidecar Railway responde `/health` con `{"status":"ok"}`
- ✅ Vercel deploy verde
- ✅ Supabase project accesible (MCP conectado)
- ✅ `git status` limpio en `master`
- ✅ Última cron run sin alertas
