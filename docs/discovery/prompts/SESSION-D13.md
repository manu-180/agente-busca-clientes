# SESSION-D13 — E2E tests + chaos drills

> **Modelo recomendado:** Sonnet
> **Duración estimada:** 1 sesión (~2.5h)
> **Prerequisitos:** D01–D12 ✅

---

## Contexto

Lectura: `MASTER-PLAN.md`, `ARCHITECTURE.md` § 6 (failure modes), `PROGRESS.md`.

Antes de pasar a live (D14) necesitamos confianza en que el sistema:
1. Funciona end-to-end con datos sintéticos.
2. Recupera bien de fallas (sidecar caído, IG challenge, Supabase down).
3. Tiene CI verde en cada push.

---

## Objetivo

1. Playwright para tests admin UI.
2. Test E2E: orchestrator → sidecar mock → run-cycle → DM dry-run → verificar DB state.
3. Sidecar mock FastAPI test client (en `sidecar/tests/test_e2e.py`).
4. Chaos drill manual: kill sidecar (en Railway), verificar circuit + alert Discord.
5. GitHub Actions workflow `.github/workflows/discovery-ci.yml`.

---

## Paso 1 — Branch + setup

```bash
git checkout -b feat/discovery-d13-tests-chaos
pnpm add -D @playwright/test
pnpm exec playwright install --with-deps chromium
```

---

## Paso 2 — Playwright tests

`apex-leads/tests/e2e/admin.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'

test.describe('Admin dashboard', () => {
  test('redirects to login when not authed', async ({ page }) => {
    await page.goto('/admin/ig')
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('renders KPIs after login', async ({ page, context }) => {
    // Set auth cookie via API or use Supabase test user
    // ...
    await page.goto('/admin/ig')
    await expect(page.getByText('Reply Rate')).toBeVisible()
    await expect(page.getByText('Pipeline Health')).toBeVisible()
  })

  test('can pause and resume a source', async ({ page }) => {
    // Login + navigate
    await page.goto('/admin/ig/sources')
    const row = page.getByRole('row').filter({ hasText: 'modaargentina' }).first()
    await row.getByRole('button', { name: 'Pause' }).click()
    await expect(row.getByRole('button', { name: 'Resume' })).toBeVisible()
  })
})
```

`playwright.config.ts` con `webServer: { command: 'pnpm dev', port: 3000 }`.

---

## Paso 3 — E2E sidecar tests

`sidecar/tests/test_e2e.py`:

```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_discovery_full_flow(monkeypatch, mock_supabase, mock_instagrapi):
    # 1. Mock IG returns 5 users for hashtag
    mock_instagrapi.discover_by_hashtag.return_value = {"users": [...], "media_seen": 5}
    # 2. Sign request
    body = {"tag": "test", "limit": 5}
    sig = make_hmac(body)
    # 3. POST /discover/hashtag
    r = client.post("/discover/hashtag", json=body, headers={"X-Signature": sig})
    assert r.status_code == 200
    assert r.json()["users_seen"] == 5
    # 4. Assert supabase called with upsert raw + run insert
    mock_supabase.table().upsert.assert_called()
```

Cubrir además:
- `test_circuit_open_propagates`
- `test_rate_limit_competitor`
- `test_signature_invalid_401`

---

## Paso 4 — Test del orchestrator integrado

`apex-leads/src/lib/ig/discover/__tests__/orchestrator.e2e.test.ts`:

Mock sidecar HTTP con `msw` (mock service worker) o `nock`. Mock Supabase con un cliente in-memory (o usar Supabase branch real para CI). Ejecutar `runOrchestratorCycle` y asertar:
- Llamadas correctas al sidecar
- Escrituras en discovery_runs
- Anti-ban competitor allowance respetado

---

## Paso 5 — Chaos drill manual

Documento `docs/discovery/CHAOS-DRILLS.md` con escenarios paso-a-paso:

### Drill 1: Sidecar caído
1. Railway → sidecar service → Stop
2. Trigger `/api/cron/discover-orchestrator` con CRON_SECRET
3. Verificar:
   - Endpoint responde con error o array vacío (no crash)
   - Discord recibe alerta `critical` desde sidecar.ts (timeout/ECONNREFUSED)
   - `discovery_runs` rows status='error'
4. Restart sidecar, próxima cron tick → vuelve a normal

### Drill 2: IG challenge simulado
1. SSH a Railway sidecar → corromper `session.json` (renombrar)
2. Restart sidecar → `/health` debería devolver `degraded`
3. Trigger discover-orchestrator → 503 ig_session_invalid
4. Restaurar session, verificar recovery

### Drill 3: Supabase circuit
1. Apuntar `SUPABASE_URL` a host inexistente en Vercel preview
2. Trigger discover-orchestrator
3. Verificar log claro y no panic

Manuel ejecuta los drills, marca ✅ en el doc.

---

## Paso 6 — GitHub Actions

`.github/workflows/discovery-ci.yml`:

```yaml
name: Discovery CI
on:
  pull_request:
    paths: ['apex-leads/**', 'sidecar/**', 'docs/discovery/**']
  push:
    branches: [master]

jobs:
  next-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm, cache-dependency-path: apex-leads/pnpm-lock.yaml }
      - run: pnpm install
        working-directory: apex-leads
      - run: pnpm typecheck
        working-directory: apex-leads
      - run: pnpm test --run
        working-directory: apex-leads
      - run: pnpm exec playwright install --with-deps chromium
        working-directory: apex-leads
      - run: pnpm test:e2e
        working-directory: apex-leads
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_TEST_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_TEST_KEY }}

  sidecar-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -r requirements.txt
        working-directory: sidecar
      - run: pip install pytest pytest-mock
        working-directory: sidecar
      - run: pytest -v
        working-directory: sidecar
```

Setear secrets en GitHub:
- `SUPABASE_TEST_URL` (rama de Supabase para tests)
- `SUPABASE_TEST_KEY`

---

## Paso 7 — Tests pasan

```bash
cd apex-leads && pnpm test && pnpm test:e2e
cd sidecar && pytest -v
```

Verificar CI verde en GitHub PR.

---

## Criterios de éxito

1. ✅ Playwright tests verdes (3 tests mínimo).
2. ✅ Sidecar pytest verde (cobertura > 60%).
3. ✅ E2E orchestrator test verde.
4. ✅ CI workflow corre y pasa.
5. ✅ 3 chaos drills documentados y ejecutados al menos 1× por Manuel.

---

## Cierre

- Update PROGRESS D13 → ✅
- PR
