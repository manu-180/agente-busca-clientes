# SESSION-D11 — A/B testing de templates (Thompson sampling)

> **Modelo recomendado:** Opus
> **Duración estimada:** 1 sesión (~2.5h)
> **Prerequisitos:** D01–D10 ✅. Reply detection ya funcionando (poll inbox → updates `replied_at`).

---

## Contexto

Lectura: `MASTER-PLAN.md` § 8, `ARCHITECTURE.md` § 4.6, § 4.7, § 9.

Hoy todos los DMs salen del template hardcoded en `apex-leads/src/lib/ig/prompts/templates.ts`. Esto es subóptimo. Esta sesión:
- Mueve templates a DB.
- Selecciona via Thompson sampling (multi-armed bandit).
- Auto-pausa templates dominados.
- Permite a Manuel crear/editar desde admin.

**Pre-requisito de datos:** los handlers de inbox (poll inbox y handler de respuestas) deben actualizar `dm_template_assignments.replied=true` y `replied_at` cuando detectan respuesta del lead. Confirmar que esto ya pasa o agregarlo en este PR.

---

## Objetivo

1. Migrar template hardcoded a `dm_templates` (3-5 variantes iniciales).
2. `lib/ig/templates/selector.ts` con `pickTemplate(supabase) -> Template`.
3. Reemplazar `pickOpeningTemplate` en run-cycle.
4. Loggear cada send en `dm_template_assignments`.
5. Hook en inbox-poll para marcar `replied=true`.
6. Cron diario `/api/cron/auto-pause-templates`.
7. UI admin para crear/editar/promover (D10 dejó la página pero sin acciones de creación).

---

## Paso 1 — Branch + seed

```bash
git checkout -b feat/discovery-d11-ab-templates
```

Insertar 5 templates iniciales vía SQL:

```sql
INSERT INTO dm_templates (name, body, variables, status, notes) VALUES
('opener_v1_directo', 'Hola {first_name}! Vi tu cuenta y me copó tu trabajo en {niche}. Estamos ayudando a boutiques argentinas a tener su web propia (mirá moda.theapexweb.com). Te interesa que te muestre algo similar para vos?', ARRAY['first_name','niche'], 'active', 'baseline directo'),
('opener_v2_pregunta', 'Hola {first_name}, ya tenés sitio web propio para vender por fuera de IG? Si tu negocio crece, IG solo limita. Acá una demo hecha para una boutique: moda.theapexweb.com', ARRAY['first_name'], 'active', 'pregunta abierta'),
('opener_v3_curioso', 'Che {first_name}, soy de The Apex Web — armamos sitios para boutiques. Vi tu IG y me dio curiosidad: vendés solo por DM o tenés tienda online?', ARRAY['first_name'], 'active', 'curioso conversacional'),
('opener_v4_valor', 'Hola {first_name}! Estamos ayudando a marcas como la tuya a recuperar 30% de ventas que se pierden en IG (DMs no respondidos, links muertos en bio). Si querés ver cómo, te paso el caso real de una boutique que armamos.', ARRAY['first_name'], 'active', 'pitch valor concreto'),
('opener_v5_corto', 'Hola {first_name}, vi {niche} y me copó. Armamos sitios para boutiques: moda.theapexweb.com. Querés que te tire una idea para tu marca?', ARRAY['first_name','niche'], 'active', 'cortísimo')
;
```

---

## Paso 2 — Selector con Thompson

`lib/ig/templates/selector.ts`:

```typescript
export interface Template { id: string; name: string; body: string; variables: string[]; status: string }

function sampleBeta(alpha: number, beta: number): number {
  // Marsaglia & Tsang aprox simple — para producción usar `simple-statistics` o `@stdlib/random-base-beta`
  // Implementación naive con gamma sampling vía sum of exponentials no funciona bien — usar lib.
  // pnpm add @stdlib/random-base-beta
  return require('@stdlib/random-base-beta')(alpha, beta)
}

export async function pickTemplate(supabase): Promise<Template> {
  const { data: stats } = await supabase.from('dm_template_stats').select('*').eq('status', 'active')
  if (!stats || stats.length === 0) throw new Error('no active templates')
  let best: any = null; let bestSample = -1
  for (const t of stats) {
    const s = sampleBeta(t.beta_alpha, t.beta_beta)
    if (s > bestSample) { bestSample = s; best = t }
  }
  // Fetch full template body
  const { data } = await supabase.from('dm_templates').select('*').eq('id', best.template_id).single()
  return data
}

export function renderTemplate(t: Template, vars: Record<string, string>): string {
  let out = t.body
  for (const v of t.variables) {
    const val = vars[v] ?? ''
    out = out.replaceAll(`{${v}}`, val)
  }
  return out
}
```

Instalar dep: `pnpm add @stdlib/random-base-beta`.

---

## Paso 3 — Integrar en run-cycle

Reemplazar:
```typescript
const dmText = pickOpeningTemplate(profile)
```
Por:
```typescript
const template = await pickTemplate(supabase)
const firstName = (profile.full_name ?? profile.ig_username).split(' ')[0]
const dmText = renderTemplate(template, {
  first_name: firstName,
  niche: niche?.niche?.replaceAll('_', ' ') ?? 'tu rubro',
})
```

Después de send exitoso:
```typescript
await supabase.from('dm_template_assignments').insert({
  lead_id: leadRow.id, template_id: template.id, sent_at: now,
})
```

Y en upsert de leads agregar `template_id: template.id`.

---

## Paso 4 — Reply detection

Verificar en `apex-leads/src/app/api/cron/ig-poll-inbox/route.ts` (o donde esté el inbox poller): cuando se detecta mensaje inbound de un lead que tiene `template_id` en `instagram_leads`, hacer:

```typescript
await supabase.from('dm_template_assignments')
  .update({ replied: true, replied_at: msg.timestamp })
  .eq('lead_id', leadId)
  .is('replied', false)   // solo el primer reply

await supabase.from('instagram_leads').update({ replied_at: msg.timestamp }).eq('id', leadId)
```

Si el inbox poller no existe todavía: crear stub básico que llama sidecar `/inbox/poll` y persiste mensajes inbound.

---

## Paso 5 — Auto-pause cron

`apex-leads/src/app/api/cron/auto-pause-templates/route.ts`:

```typescript
// Para cada template active con sends ≥ 100, comparar CI 95% Beta vs el best:
// pause si upper_bound(t) < lower_bound(best)
// Beta CI aproximado: mean ± 1.96 * sqrt(var) donde var = α*β / ((α+β)^2 * (α+β+1))

function betaCI95(alpha: number, beta: number): { lo: number; hi: number; mean: number } {
  const mean = alpha / (alpha + beta)
  const variance = (alpha * beta) / (Math.pow(alpha + beta, 2) * (alpha + beta + 1))
  const sd = Math.sqrt(variance)
  return { lo: Math.max(0, mean - 1.96 * sd), hi: Math.min(1, mean + 1.96 * sd), mean }
}

// best = max mean entre todos. Pause los que hi < best.lo.
```

Cuando pause: `dm_templates.status='paused'` + `sendAlert(supabase, 'info', 'templates', 'Template paused', { name, ctr_pct })`.

Cron: `0 6 * * *` diario.

---

## Paso 6 — UI admin

En `/admin/ig/templates`:
- Botón "New template" → modal con name, body (textarea), variables (chips). POST `/api/admin/templates`.
- Por row: Pause/Activate/Kill, Edit (modal preview), Promote draft → active.
- Mostrar Beta(α,β) y CI 95% de cada uno en tooltip.

---

## Paso 7 — Tests

- `selector.test.ts`: con 2 templates (uno con 100 sends 30 replies, otro con 5 sends 0 replies), 1000 ejecuciones de pickTemplate → el primero gana ≥ 90%.
- `betaCI95` valores conocidos.
- Auto-pause: simular 4 templates, asserts.

---

## Paso 8 — Smoke

Disparar 5 run-cycle (en DRY_RUN si todavía no estamos live) y verificar que la distribución de templates elegidos respeta Thompson (no siempre el mismo).

---

## Criterios de éxito

1. ✅ 5 templates seedeados, all active.
2. ✅ run-cycle elige template via Thompson, registra assignment.
3. ✅ Inbox poller actualiza replied=true.
4. ✅ Auto-pause funciona en simulación.
5. ✅ Admin puede crear/editar templates.

---

## Cierre

- Update PROGRESS D11 → ✅
- PR
