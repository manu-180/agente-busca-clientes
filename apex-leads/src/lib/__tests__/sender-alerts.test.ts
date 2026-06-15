import type { SupabaseClient } from '@supabase/supabase-js'
import { alertSenderBanned } from '@/lib/sender-alerts'

function makeSupabase() {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
  const supabase = {
    from: jest.fn((table: string) => ({
      insert: jest.fn((payload: Record<string, unknown>) => {
        inserts.push({ table, payload })
        return Promise.resolve({ data: null, error: null })
      }),
    })),
  } as unknown as SupabaseClient
  return { supabase, inserts }
}

describe('alertSenderBanned', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV }
    ;(global.fetch as unknown) = jest.fn(() => Promise.resolve({ ok: true }))
  })

  afterEach(() => {
    process.env = OLD_ENV
    jest.restoreAllMocks()
  })

  it('persiste el baneo en alerts_log (severity critical, source sender-pool, alias+reason en el mensaje)', async () => {
    const { supabase, inserts } = makeSupabase()
    await alertSenderBanned(supabase, {
      alias: 'Manu celu actual',
      instanceName: 'wa-manu',
      reason: 'device_removed',
      promotedAlias: 'Reserva 1',
    })
    expect(inserts).toHaveLength(1)
    expect(inserts[0].table).toBe('alerts_log')
    expect(inserts[0].payload.severity).toBe('critical')
    expect(inserts[0].payload.source).toBe('sender-pool')
    expect(String(inserts[0].payload.message)).toContain('Manu celu actual')
    expect(String(inserts[0].payload.message)).toContain('device_removed')
    expect(inserts[0].payload.metadata).toMatchObject({
      instance_name: 'wa-manu',
      reason: 'device_removed',
      promoted: 'Reserva 1',
    })
  })

  it('manda email por Resend cuando RESEND_API_KEY + ALERT_EMAIL están seteados', async () => {
    process.env.RESEND_API_KEY = 'key_test'
    process.env.ALERT_EMAIL = 'manu@example.com'
    const { supabase } = makeSupabase()

    await alertSenderBanned(supabase, {
      alias: 'Manu celu',
      instanceName: 'wa-manu',
      reason: 'code_403',
      promotedAlias: null,
    })

    const fetchMock = global.fetch as jest.Mock
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    const body = JSON.parse((opts as { body: string }).body)
    expect(body.to).toEqual(['manu@example.com'])
    expect(String(body.subject).toLowerCase()).toContain('banead')
  })

  it('no manda email si faltan los envs (pero igual persiste en alerts_log)', async () => {
    delete process.env.RESEND_API_KEY
    delete process.env.ALERT_EMAIL
    const { supabase, inserts } = makeSupabase()

    await alertSenderBanned(supabase, {
      alias: 'X',
      instanceName: 'wa-x',
      reason: 'device_removed',
      promotedAlias: null,
    })

    expect(global.fetch as jest.Mock).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(1)
  })

  it('fail-silent: si Resend rechaza, no tira (no rompe el flujo de baneo)', async () => {
    process.env.RESEND_API_KEY = 'key_test'
    process.env.ALERT_EMAIL = 'manu@example.com'
    ;(global.fetch as unknown) = jest.fn(() => Promise.reject(new Error('network')))
    const { supabase } = makeSupabase()

    await expect(
      alertSenderBanned(supabase, {
        alias: 'X',
        instanceName: 'wa-x',
        reason: 'code_403',
        promotedAlias: null,
      })
    ).resolves.toBeUndefined()
  })

  it('el mensaje avisa que hay que reponer cuando NO había reserva para promover', async () => {
    const { supabase, inserts } = makeSupabase()
    await alertSenderBanned(supabase, {
      alias: 'X',
      instanceName: 'wa-x',
      reason: 'device_removed',
      promotedAlias: null,
    })
    expect(String(inserts[0].payload.message).toLowerCase()).toContain('repon')
  })
})
