import { test, expect, type BrowserContext } from '@playwright/test'

// Cookie value = Buffer.from(ADMIN_PASSWORD ?? 'apex').toString('base64url')
// With ADMIN_PASSWORD=apex → 'YXBleA'
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

test.beforeEach(async ({ context }) => {
  await setAuthCookie(context)
})

test('discovery page loads with KPI cards', async ({ page }) => {
  await page.goto('/admin/ig/discovery')
  await expect(page).not.toHaveURL(/login/)

  // KPI cards rendered (Reply Rate, DMs Today, etc.)
  await expect(page.getByText(/Reply Rate/i)).toBeVisible()
  await expect(page.getByText(/DMs Today/i)).toBeVisible()
})

test('sources page renders table', async ({ page }) => {
  await page.goto('/admin/ig/sources')
  await expect(page).not.toHaveURL(/login/)

  // Table element must exist (seeded with 13 rows in D01)
  const table = page.locator('table')
  await expect(table).toBeVisible()

  // At least one row beyond the header
  const rows = page.locator('table tbody tr')
  await expect(rows.first()).toBeVisible()
})

test('templates page shows table and New Template button', async ({ page }) => {
  await page.goto('/admin/ig/templates')
  await expect(page).not.toHaveURL(/login/)

  await expect(page.locator('table')).toBeVisible()
  await expect(page.getByRole('button', { name: /New Template/i })).toBeVisible()
})

test('leads page shows table with niche and status filters', async ({ page }) => {
  await page.goto('/admin/ig/leads')
  await expect(page).not.toHaveURL(/login/)

  await expect(page.locator('table')).toBeVisible()

  // Filter inputs/selects for niche and status
  await expect(page.locator('[name="niche"], select[id*="niche"], input[placeholder*="niche" i]').first()).toBeVisible()
  await expect(page.locator('[name="status"], select[id*="status"], input[placeholder*="status" i]').first()).toBeVisible()
})
