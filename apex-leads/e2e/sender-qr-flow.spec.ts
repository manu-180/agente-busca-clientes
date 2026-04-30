import { test, expect, type BrowserContext } from '@playwright/test'

const AUTH_COOKIE = Buffer.from(process.env.ADMIN_PASSWORD ?? 'apex').toString('base64url')

async function setAuthCookie(context: BrowserContext) {
  await context.addCookies([
    {
      name: 'apex_auth',
      value: AUTH_COOKIE,
      domain: 'localhost',
      path: '/',
    },
  ])
}

test.describe('Sender QR onboarding flow', () => {
  test.beforeEach(async ({ context, page }) => {
    await setAuthCookie(context)

    // Lista inicial vacia + capacity vacia para que cargue rapido sin tocar Supabase real.
    await page.route('**/api/senders/capacity', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total_today: 0,
          used_today: 0,
          remaining: 0,
          active_connected: 0,
          active_total: 0,
          per_sender: [],
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

    let createdSender: Record<string, unknown> | null = null
    await page.route('**/api/senders', async (route, req) => {
      const method = req.method()
      if (method === 'POST') {
        createdSender = {
          id: 'test-sender-id-1',
          alias: 'Test SIM',
          instance_name: 'wa-test-sim-abc123',
          phone_number: null,
          descripcion: null,
          color: '#84cc16',
          activo: true,
          provider: 'evolution',
          daily_limit: 15,
          msgs_today: 0,
          connected: false,
          connected_at: null,
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createdSender),
        })
        return
      }
      // GET — lista de senders. Devuelve el sender recien creado si existe.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createdSender ? [createdSender] : []),
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

    let stateCallCount = 0
    await page.route('**/api/senders/test-sender-id-1/state', async (route) => {
      stateCallCount++
      // Tras unos polls devolvemos open para simular escaneo exitoso.
      const state = stateCallCount >= 3 ? 'open' : 'connecting'
      const body = state === 'open'
        ? { state, phone_number: '+5491111111111', connected: true }
        : { state, phone_number: null, connected: false }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    })
  })

  test('Manuel agrega SIM, escanea QR, ve la SIM conectada', async ({ page }) => {
    await page.goto('/senders')
    await expect(page).not.toHaveURL(/login/)

    // 1. Click en "Agregar SIM"
    await page.getByRole('button', { name: /agregar sim/i }).click()

    // 2. Modal pantalla 1: input alias + select limite
    await page.getByPlaceholder('Ej: SIM 01').fill('Test SIM')
    await page.getByRole('button', { name: /conectar sim/i }).click()

    // 3. Pantalla 2: QR aparece
    await expect(page.locator('img[alt="QR de conexión"]')).toBeVisible({ timeout: 10_000 })

    // 4. Polling de /state se ejecuta. Tras unos polls (mock devuelve open) -> toast.
    await expect(page.getByText(/SIM conectada/i)).toBeVisible({ timeout: 15_000 })

    // 5. Card del sender aparece en la grilla.
    await expect(page.getByText('Test SIM')).toBeVisible()
  })
})
