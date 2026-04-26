import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'apex',
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      CRON_SECRET: process.env.CRON_SECRET ?? 'dev-cron-secret',
      IG_SIDECAR_URL: process.env.IG_SIDECAR_URL ?? 'http://localhost:9999',
      IG_SIDECAR_SECRET: process.env.IG_SIDECAR_SECRET ?? 'dev-secret',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'sk-ant-dev',
    },
  },
})
