# SESSION-EVO-08 — Cleanup, Mensaje sin tarjetita, Tests E2E

**Modelo:** claude-sonnet-4-6
**Repo:** `C:\MisProyectos\bots_ia\agente_busca_clientes` — branch `main`
**App:** `apex-leads/`
**Estimado:** 30-45 min

---

## Lectura obligatoria al inicio

1. `docs/superpowers/specs/2026-04-29-evolution-pool-design.md` — todo el spec
2. `docs/migration/evolution-api/PROGRESS.md` — confirmar EVO-04..07 completas
3. `apex-leads/playwright.config.ts` y `apex-leads/e2e/` — para entender el patrón de tests E2E existentes

---

## Contexto

Última sesión del proyecto. Cleanup, eliminar deuda técnica del cron viejo, ajustar el mensaje predefinido sin la tarjetita 💳 (decisión de Manuel: no incluir precio en primer contacto), y agregar 1 test E2E que cubra el flow QR completo.

**Pre-requisito:** EVO-04..07 mergeadas.

---

## TAREA 1 — Sacar la tarjetita 💳 si está, asegurar que el template no menciona precio (5 min)

Verificar `apex-leads/src/app/api/cron/leads-pendientes/route.ts` función `construirMensajePrimerContacto`. El template debe ser exactamente:

```
Hola {nombre}
Vi que tu negocio tiene {rating}⭐ en Google Maps.
Hice este boceto para un negocio como el tuyo: {demoHost}
Trabajo con negocios de {zona} haciendo páginas web para {rubro} - conocé mi trabajo en {SITIO_PRINCIPAL_APEX}
¿Te lo armamos con tu marca?
```

Si hay líneas extra con `💳` o `cuotas` o `$`, eliminarlas. (Spec dice: Manuel decidió NO incluir precio en primer contacto.)

---

## TAREA 2 — Drop de claves obsoletas en `tabla configuracion` (15 min)

Las claves `${instance}_primer_enviados_hoy` (contador diario) y `${instance}_primer_next_slot_at` (cadencia per-sender) ya no se usan desde EVO-06. Limpieza:

### 2.1 Borrar las claves de la DB

Crear `apex-leads/supabase-migration-cleanup-evolution-old-keys.sql`:

```sql
-- Migración: cleanup post-Evolution-pool
-- Fecha: 2026-04-29
-- Sesión: SESSION-EVO-08
-- Borra contadores diarios y slots de cadencia que vivían en `configuracion`.
-- Reemplazados por columnas en `senders` (msgs_today, last_sent_at) desde EVO-04 + EVO-06.
-- IMPORTANTE: las claves `${instance}_primer_fallos` SE MANTIENEN — siguen usándose
-- como contador de fallos consecutivos del sender en el cron.

DELETE FROM configuracion
WHERE clave LIKE '%_primer_enviados_hoy'
   OR clave LIKE '%_primer_next_slot_at';
```

Aplicar via MCP Supabase `apply_migration` (o `execute_sql` si es DELETE).

### 2.2 Borrar código muerto del cron

En `apex-leads/src/app/api/cron/leads-pendientes/route.ts`, eliminar las funciones `leerDailyCount`, `incrementarDailyCount` si todavía existen (las dejamos como fallback en EVO-06, ahora ya no se necesitan).

También eliminar los `escribirConfig` que setteaban `_primer_next_slot_at`.

### 2.3 Borrar el helper viejo si existe

Revisar `apex-leads/src/lib/` por archivos huérfanos relacionados con el contador viejo. Eliminarlos.

---

## TAREA 3 — Test E2E Playwright del QR flow (15 min)

Nuevo archivo `apex-leads/e2e/sender-qr-flow.spec.ts`. Sigue el patrón de los tests E2E existentes en `e2e/` (revisar uno como referencia, probablemente usan `test.beforeEach` con login si requiere auth).

### Mock de Evolution API

Como no podemos depender de la Evolution API real en el CI, hacemos route mocking con Playwright:

```typescript
import { test, expect } from '@playwright/test'

test.describe('Sender QR onboarding flow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Evolution API responses (proxied via /api/senders/...)
    await page.route('**/api/senders', async (route, req) => {
      if (req.method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'test-sender-id-1',
            alias: 'Test SIM',
            instance_name: 'wa-test-sim-abc123',
            connected: false,
            daily_limit: 15,
            msgs_today: 0,
            color: '#84cc16',
            activo: true,
            provider: 'evolution',
          }),
        })
        return
      }
      await route.continue()
    })

    let stateCallCount = 0
    await page.route('**/api/senders/test-sender-id-1/state', async (route) => {
      stateCallCount++
      // Primeros 3 polls: connecting. Cuarto poll: open.
      const state = stateCallCount >= 4 ? 'open' : 'connecting'
      const body = state === 'open'
        ? { state, phone_number: '+5491111111111' }
        : { state, phone_number: null }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    })

    await page.route('**/api/senders/test-sender-id-1/qr', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==',
          code: 'mock-pairing-code',
        }),
      })
    })

    await page.route('**/api/senders/orphans', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ orphans: [] }),
      })
    })
  })

  test('Manuel agrega SIM, escanea QR, ve la SIM conectada', async ({ page }) => {
    await page.goto('/senders')

    // 1. Click en "Agregar SIM"
    await page.getByRole('button', { name: /agregar/i }).click()

    // 2. Pantalla 1 del modal: input alias + daily_limit
    await page.getByLabel(/alias/i).fill('Test SIM')
    await page.getByLabel(/límite/i).selectOption('15')
    await page.getByRole('button', { name: /conectar/i }).click()

    // 3. Pantalla 2: QR aparece
    await expect(page.locator('img[alt="QR"]')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/esperando conexión/i)).toBeVisible()

    // 4. Polling se ejecuta. Tras ~6-8s (cuarto poll), state=open → toast.
    await expect(page.getByText(/conectada/i)).toBeVisible({ timeout: 15000 })

    // 5. Modal se cierra solo, card aparece en grilla.
    await expect(page.locator('text=Test SIM')).toBeVisible()
  })
})
```

Run: `npx playwright test sender-qr-flow.spec.ts` desde `apex-leads/`.

**Si Playwright no está configurado** o falta dependency, anotar el bloqueo en PROGRESS.md y marcar este test como TODO. NO bloquear el cierre de la sesión por esto.

---

## TAREA 4 — Documentación final (5 min)

Update `docs/migration/evolution-api/PROGRESS.md` con resumen final del proyecto:

```markdown
## Estado actual

**Última sesión completada:** SESSION-EVO-08 (2026-XX-XX) — cleanup, sin tarjetita, tests E2E
**Próxima sesión:** ninguna — proyecto Pool & QR completo. Migración Twilio→Evolution finalizada con UX premium.

---

## Progreso final

- [x] SESSION-EVO-01 — DEFERIDA / archivada (infra Railway hecha manualmente por Manuel)
- [x] SESSION-EVO-02 — Core lib + webhook + supabase migration (2026-04-28)
- [x] SESSION-EVO-03 — Callers + cleanup Twilio (2026-04-28)
- [x] SESSION-EVO-04 — Schema pool + QR onboarding premium + helpers (2026-XX-XX)
- [x] SESSION-EVO-05 — Sender pool LRU + tests (2026-XX-XX)
- [x] SESSION-EVO-06 — Refactor cron 1-msg-per-tick (2026-XX-XX)
- [x] SESSION-EVO-07 — Dashboard capacidad UI (2026-XX-XX)
- [x] SESSION-EVO-08 — Cleanup + tests E2E (2026-XX-XX)

---

## Cómo agregar una SIM nueva (post-proyecto)

1. Ir a `https://leads.theapexweb.com/senders`.
2. Click "Agregar SIM".
3. Escribir alias, elegir daily_limit, click "Conectar SIM".
4. Escanear QR con WhatsApp del celular.
5. Listo — la SIM entra en el pool automáticamente.

## Cómo cambiar el mensaje predefinido

Editar `apex-leads/src/app/api/cron/leads-pendientes/route.ts` función `construirMensajePrimerContacto`. Commit + Vercel deploy. ~5 min.

## Cómo cambiar el daily_limit de una SIM

Click "Editar" en la card del sender en `/senders` → cambiar `daily_limit` → guardar. Toma efecto en el próximo tick del cron.
```

---

## Verificación final

- [ ] Mensaje primer contacto verificado sin 💳/precio.
- [ ] Migración cleanup aplicada. `SELECT * FROM configuracion WHERE clave LIKE '%enviados_hoy';` devuelve 0 filas.
- [ ] Código muerto de contador viejo eliminado.
- [ ] Test E2E pasa (o anotado en PROGRESS si Playwright no está disponible).
- [ ] PROGRESS.md con estado final.
- [ ] `tsc --noEmit` sin errores nuevos.
- [ ] Commit: `chore(evolution): SESSION-EVO-08 — cleanup, sin tarjetita, tests E2E`

---

## Al cerrar la sesión

1. PROGRESS.md final.
2. Commit final.
3. Mostrar a Manuel:
   - El proyecto Evolution Pool & QR está completo.
   - URLs: `/senders` (gestión), `/leads/nuevo` (operación + dashboard).
   - Próximo paso operativo: agregar más SIMs cuando consiga más números.
   - Si en algún momento querés cambiar el mensaje, abrime una sesión chiquita con el cambio puntual.
