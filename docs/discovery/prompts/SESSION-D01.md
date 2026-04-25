# SESSION-D01 — Schema cleanup + nuevas tablas

> **Modelo recomendado:** Sonnet
> **Duración estimada:** 1 sesión (~1h)
> **Prerequisitos:** Manuel aprobó `MASTER-PLAN.md`. Sidecar Railway operativo.

---

## Contexto

Estamos arrancando Phase 1 del Discovery System v2. El plan completo vive en `docs/discovery/MASTER-PLAN.md` (inmutable) y la arquitectura técnica en `docs/discovery/ARCHITECTURE.md`. Estado vivo en `docs/discovery/PROGRESS.md`.

**Antes de hacer NADA:** leé los 3 archivos de arriba en ese orden. No hace falta resumirlos en la respuesta — solo cargalos en contexto.

El proyecto reemplaza Apify por discovery nativo con instagrapi. Esta sesión crea el cimiento de datos: 10 tablas nuevas + alters a `instagram_leads`. Sin esto nada del resto puede ejecutar.

Project Supabase: `hpbxscfbnhspeckdmkvu` (compartido con sistema WhatsApp — NO TOCAR sus tablas: `users`, `messages_*`, `bookings_*`, etc.).

---

## Objetivo

1. Crear migración SQL con todas las tablas nuevas (`ARCHITECTURE.md` § 4).
2. ALTER `instagram_leads` con columnas adicionales.
3. Aplicar la migración vía MCP Supabase.
4. Regenerar tipos TypeScript en `apex-leads`.
5. Seedear `discovery_sources` con los valores iniciales (6 hashtags + 4 locations + 3 competitors placeholders).
6. Verificar que las migraciones quedan en `list_migrations`.

---

## Paso 1 — Preparación

```bash
git checkout master && git pull
git checkout -b feat/discovery-d01-schema
```

Confirmá que `apex-leads/supabase/migrations/` existe (o el directorio que use el repo). Si no, crealo. Verificá la convención de nombres de migraciones existentes (timestamp + slug).

---

## Paso 2 — Crear migración

Crear archivo `apex-leads/supabase/migrations/<timestamp>_discovery_v2_schema.sql` con TODAS las tablas listadas en `ARCHITECTURE.md` § 4, en este orden:

1. `discovery_sources`
2. `discovery_runs`
3. `niche_classifications`
4. `scoring_weights`
5. `lead_score_history`
6. `dm_templates`
7. `dm_template_assignments`
8. `lead_blacklist`
9. `alerts_log`
10. ALTER `instagram_leads` con columnas: `niche`, `niche_confidence`, `engagement_rate`, `scoring_version`, `template_id`, `replied_at`
11. La materialized view `discovery_metrics_daily` queda para D08 — **no la incluyas acá**.

Importante:
- Usar `IF NOT EXISTS` en todo (idempotencia).
- Foreign keys con `ON DELETE` explícito (ver schema en ARCHITECTURE.md).
- Índices después de la creación.
- Comentarios en SQL (`COMMENT ON TABLE`) para cada tabla nueva, 1 línea descriptiva.

---

## Paso 3 — Aplicar migración

Usar el MCP Supabase del proyecto:
```
mcp__70d9e470-...__apply_migration con nombre "discovery_v2_schema" y query=<SQL completo>
```

Verificar:
```
mcp__70d9e470-...__list_migrations  → debería listar la nueva
mcp__70d9e470-...__list_tables      → debería mostrar las 9 tablas nuevas
```

Si algo falla: NO usar `execute_sql` para parchear — corregir el archivo de migración y reaplicar limpio.

---

## Paso 4 — Seed inicial de `discovery_sources`

Insertar via `execute_sql` (no es migración, es data):

**6 Hashtags:**
- `modaargentina`, `boutiquebuenosaires`, `boutiquecaba`, `indumentariafemenina`, `modafemeninaargentina`, `ropadeargentina`
- params: `{"limit": 50}`, schedule_cron: `0 */6 * * *`, priority: 60

**4 Locations** (location_pk de IG):
- `213385402` Buenos Aires, `1023462` Palermo, `212707064` Recoleta, `213046626` Belgrano
- params: `{"limit": 50}`, schedule_cron: `0 12 * * *`, priority: 50
- (Si no estás 100% seguro de los pks, pone los que conozcas con confianza y deja `notes` indicando "verificar pk")

**3 Competitors placeholders:** dejá rows con kind=`competitor_followers` y `ref` vacío + `active=false` + nota "Manuel debe poblar usernames de competidores antes de activar".

---

## Paso 5 — Generar tipos TS

```bash
cd apex-leads
pnpm dlx supabase gen types typescript --project-id hpbxscfbnhspeckdmkvu > src/types/supabase.ts
```

(o el comando que use el repo — chequear `package.json` scripts). Commit del archivo generado.

---

## Paso 6 — Tests rápidos

- Query `SELECT count(*) FROM discovery_sources` → 13 (6+4+3)
- Query `\d instagram_leads` → debería mostrar las nuevas columnas
- Type-check: `pnpm typecheck` (los tipos nuevos deberían aparecer pero ningún archivo los usa todavía → 0 errors)

---

## Paso 7 — Cerrar sesión

1. Actualizar `docs/discovery/PROGRESS.md`:
   - D01 → ✅ done con fecha
   - Anotar count de tablas creadas y rows seedeadas
2. Commit:
   ```
   git add -A
   git commit -m "feat(discovery): D01 add schema for v2 discovery (10 tables, leads alters, sources seed)"
   git push -u origin feat/discovery-d01-schema
   ```
3. Crear PR a master con descripción referenciando MASTER-PLAN.

---

## Criterios de éxito

1. ✅ Migración aplicada sin error.
2. ✅ `list_tables` muestra 9 tablas nuevas + columnas en `instagram_leads`.
3. ✅ `discovery_sources` tiene 13 rows (10 active, 3 placeholders inactive).
4. ✅ Tipos TS regenerados, `pnpm typecheck` verde.
5. ✅ PROGRESS.md actualizado.

---

## Bloqueos posibles

- **MCP Supabase pide cost confirmation:** confirmar (es schema change, no data destructiva).
- **`gen_random_uuid()` no disponible:** habilitar extension `pgcrypto` con `CREATE EXTENSION IF NOT EXISTS pgcrypto;` al inicio de la migración.
- **Conflicto con tabla existente:** `IF NOT EXISTS` lo evita; si una tabla quedó a medias de un intento previo, hacer `DROP TABLE IF EXISTS <nombre> CASCADE;` antes (solo para tablas de discovery, NUNCA para tablas IG v1 o WhatsApp).
