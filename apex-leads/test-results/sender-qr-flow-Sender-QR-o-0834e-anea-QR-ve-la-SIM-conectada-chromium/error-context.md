# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sender-qr-flow.spec.ts >> Sender QR onboarding flow >> Manuel agrega SIM, escanea QR, ve la SIM conectada
- Location: e2e\sender-qr-flow.spec.ts:104:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: /agregar sim/i })

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - heading "404" [level=1] [ref=e4]
    - heading "This page could not be found." [level=2] [ref=e6]
  - region "Notifications alt+T"
  - status [ref=e7]:
    - generic [ref=e8]:
      - img [ref=e10]
      - generic [ref=e12]:
        - text: Static route
        - button "Hide static indicator" [ref=e13] [cursor=pointer]:
          - img [ref=e14]
  - alert [ref=e17]
```

# Test source

```ts
  9   |       value: AUTH_COOKIE,
  10  |       domain: 'localhost',
  11  |       path: '/',
  12  |     },
  13  |   ])
  14  | }
  15  | 
  16  | test.describe('Sender QR onboarding flow', () => {
  17  |   test.beforeEach(async ({ context, page }) => {
  18  |     await setAuthCookie(context)
  19  | 
  20  |     // Lista inicial vacia + capacity vacia para que cargue rapido sin tocar Supabase real.
  21  |     await page.route('**/api/senders/capacity', async (route) => {
  22  |       await route.fulfill({
  23  |         status: 200,
  24  |         contentType: 'application/json',
  25  |         body: JSON.stringify({
  26  |           total_today: 0,
  27  |           used_today: 0,
  28  |           remaining: 0,
  29  |           active_connected: 0,
  30  |           active_total: 0,
  31  |           per_sender: [],
  32  |         }),
  33  |       })
  34  |     })
  35  | 
  36  |     await page.route('**/api/senders/orphans', async (route) => {
  37  |       await route.fulfill({
  38  |         status: 200,
  39  |         contentType: 'application/json',
  40  |         body: JSON.stringify({ orphans: [] }),
  41  |       })
  42  |     })
  43  | 
  44  |     let createdSender: Record<string, unknown> | null = null
  45  |     await page.route('**/api/senders', async (route, req) => {
  46  |       const method = req.method()
  47  |       if (method === 'POST') {
  48  |         createdSender = {
  49  |           id: 'test-sender-id-1',
  50  |           alias: 'Test SIM',
  51  |           instance_name: 'wa-test-sim-abc123',
  52  |           phone_number: null,
  53  |           descripcion: null,
  54  |           color: '#84cc16',
  55  |           activo: true,
  56  |           provider: 'evolution',
  57  |           daily_limit: 15,
  58  |           msgs_today: 0,
  59  |           connected: false,
  60  |           connected_at: null,
  61  |         }
  62  |         await route.fulfill({
  63  |           status: 200,
  64  |           contentType: 'application/json',
  65  |           body: JSON.stringify(createdSender),
  66  |         })
  67  |         return
  68  |       }
  69  |       // GET — lista de senders. Devuelve el sender recien creado si existe.
  70  |       await route.fulfill({
  71  |         status: 200,
  72  |         contentType: 'application/json',
  73  |         body: JSON.stringify(createdSender ? [createdSender] : []),
  74  |       })
  75  |     })
  76  | 
  77  |     await page.route('**/api/senders/test-sender-id-1/qr', async (route) => {
  78  |       await route.fulfill({
  79  |         status: 200,
  80  |         contentType: 'application/json',
  81  |         body: JSON.stringify({
  82  |           base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==',
  83  |           code: 'mock-pairing-code',
  84  |         }),
  85  |       })
  86  |     })
  87  | 
  88  |     let stateCallCount = 0
  89  |     await page.route('**/api/senders/test-sender-id-1/state', async (route) => {
  90  |       stateCallCount++
  91  |       // Tras unos polls devolvemos open para simular escaneo exitoso.
  92  |       const state = stateCallCount >= 3 ? 'open' : 'connecting'
  93  |       const body = state === 'open'
  94  |         ? { state, phone_number: '+5491111111111', connected: true }
  95  |         : { state, phone_number: null, connected: false }
  96  |       await route.fulfill({
  97  |         status: 200,
  98  |         contentType: 'application/json',
  99  |         body: JSON.stringify(body),
  100 |       })
  101 |     })
  102 |   })
  103 | 
  104 |   test('Manuel agrega SIM, escanea QR, ve la SIM conectada', async ({ page }) => {
  105 |     await page.goto('/senders')
  106 |     await expect(page).not.toHaveURL(/login/)
  107 | 
  108 |     // 1. Click en "Agregar SIM"
> 109 |     await page.getByRole('button', { name: /agregar sim/i }).click()
      |                                                              ^ Error: locator.click: Test timeout of 30000ms exceeded.
  110 | 
  111 |     // 2. Modal pantalla 1: input alias + select limite
  112 |     await page.getByPlaceholder('Ej: SIM 01').fill('Test SIM')
  113 |     await page.getByRole('button', { name: /conectar sim/i }).click()
  114 | 
  115 |     // 3. Pantalla 2: QR aparece
  116 |     await expect(page.locator('img[alt="QR de conexión"]')).toBeVisible({ timeout: 10_000 })
  117 | 
  118 |     // 4. Polling de /state se ejecuta. Tras unos polls (mock devuelve open) -> toast.
  119 |     await expect(page.getByText(/SIM conectada/i)).toBeVisible({ timeout: 15_000 })
  120 | 
  121 |     // 5. Card del sender aparece en la grilla.
  122 |     await expect(page.getByText('Test SIM')).toBeVisible()
  123 |   })
  124 | })
  125 | 
```