// Unit tests para `lib/evolution.ts` — el cliente blindado de Evolution API.
//
// Estrategia: mock global.fetch + mock del módulo evolution-instance para que
// `getInstanceState` sea controlable. Cubrimos cada path del árbol de errores:
//   - TELEFONO_BLOQUEADO (sin tocar red)
//   - INSTANCE_NOT_CONNECTED (preflight detectó close/connecting)
//   - TIMEOUT (AbortController disparó)
//   - SERVER_ERROR + retry (5xx en intento 1, ok en intento 2)
//   - CLIENT_ERROR (4xx, NO retry)
//   - skipPreflight bypass

jest.mock('@/lib/evolution-instance', () => ({
  getInstanceState: jest.fn(),
}))

jest.mock('@/lib/phone-blocklist', () => ({
  isTelefonoHardBlocked: jest.fn(() => false),
}))

import {
  enviarMensajeEvolution,
  EVO_ERR,
  EvolutionError,
  isEvolutionError,
} from '@/lib/evolution'
import { getInstanceState } from '@/lib/evolution-instance'
import { isTelefonoHardBlocked } from '@/lib/phone-blocklist'

const mockedGetInstanceState = getInstanceState as jest.MockedFunction<typeof getInstanceState>
const mockedIsBlocked = isTelefonoHardBlocked as jest.MockedFunction<typeof isTelefonoHardBlocked>

beforeEach(() => {
  jest.clearAllMocks()
  process.env.EVOLUTION_API_URL = 'https://evo.test'
  process.env.EVOLUTION_API_KEY = 'test-key'
  mockedIsBlocked.mockReturnValue(false)
  mockedGetInstanceState.mockResolvedValue('open')
})

afterEach(() => {
  jest.restoreAllMocks()
})

function mockFetchOnce(response: { status?: number; body?: unknown; throwError?: unknown }) {
  const status = response.status ?? 200
  const body = response.body ?? { key: { id: 'msg-123' } }
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>(async () => {
    if (response.throwError) throw response.throwError
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function mockFetchSequence(responses: Array<{ status?: number; body?: unknown; throwError?: unknown }>) {
  let i = 0
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>(async () => {
    const r = responses[Math.min(i++, responses.length - 1)]
    if (r.throwError) throw r.throwError
    const status = r.status ?? 200
    const body = r.body ?? { key: { id: 'msg-123' } }
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('enviarMensajeEvolution', () => {
  describe('TELEFONO_BLOQUEADO', () => {
    it('lanza EvolutionError con code=TELEFONO_BLOQUEADO sin tocar Evolution', async () => {
      mockedIsBlocked.mockReturnValue(true)
      const fetchMock = mockFetchOnce({})
      try {
        await enviarMensajeEvolution('+5491111', 'hola', 'wa-1')
        fail('debió lanzar')
      } catch (err) {
        expect(isEvolutionError(err)).toBe(true)
        expect((err as EvolutionError).code).toBe(EVO_ERR.TELEFONO_BLOQUEADO)
        expect((err as EvolutionError).retryable).toBe(false)
      }
      expect(fetchMock).not.toHaveBeenCalled()
      expect(mockedGetInstanceState).not.toHaveBeenCalled()
    })

    it('skipBlockCheck=true bypassa la lista', async () => {
      mockedIsBlocked.mockReturnValue(true)
      const fetchMock = mockFetchOnce({})
      const r = await enviarMensajeEvolution('+5491111', 'hola', 'wa-1', { skipBlockCheck: true })
      expect(r.messageId).toBe('msg-123')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('preflight INSTANCE_NOT_CONNECTED', () => {
    it.each(['close', 'connecting', 'unknown'] as const)(
      'state=%s → lanza INSTANCE_NOT_CONNECTED, NO llama fetch',
      async (state) => {
        mockedGetInstanceState.mockResolvedValue(state)
        const fetchMock = mockFetchOnce({})
        try {
          await enviarMensajeEvolution('+5491111', 'hola', 'wa-1')
          fail('debió lanzar')
        } catch (err) {
          expect((err as EvolutionError).code).toBe(EVO_ERR.INSTANCE_NOT_CONNECTED)
          expect((err as EvolutionError).retryable).toBe(false)
          expect((err as EvolutionError).message).toMatch(state)
        }
        expect(fetchMock).not.toHaveBeenCalled()
      }
    )

    it('skipPreflight=true bypassa el chequeo y manda', async () => {
      mockedGetInstanceState.mockResolvedValue('close')
      const fetchMock = mockFetchOnce({})
      const r = await enviarMensajeEvolution('+5491111', 'hola', 'wa-1', { skipPreflight: true })
      expect(r.messageId).toBe('msg-123')
      expect(mockedGetInstanceState).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('si getInstanceState falla, lanza SERVER_ERROR retryable (no manda)', async () => {
      mockedGetInstanceState.mockRejectedValue(new Error('Railway 502'))
      const fetchMock = mockFetchOnce({})
      try {
        // Solo 1 intento para no medir retry acá
        await enviarMensajeEvolution('+5491111', 'hola', 'wa-1', { maxAttempts: 1 })
        fail('debió lanzar')
      } catch (err) {
        expect((err as EvolutionError).code).toBe(EVO_ERR.SERVER_ERROR)
        expect((err as EvolutionError).retryable).toBe(true)
      }
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('happy path', () => {
    it('preflight open + 200 → retorna messageId', async () => {
      const fetchMock = mockFetchOnce({ status: 200, body: { key: { id: 'msg-abc' } } })
      const r = await enviarMensajeEvolution('+5491111', 'hola', 'wa-1')
      expect(r.messageId).toBe('msg-abc')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://evo.test/message/sendText/wa-1')
      expect((init as RequestInit).method).toBe('POST')
      const body = JSON.parse((init as RequestInit).body as string)
      expect(body).toEqual({ number: '+5491111', text: 'hola' })
    })

    it('messageId null si Evolution responde sin key.id', async () => {
      mockFetchOnce({ status: 200, body: {} })
      const r = await enviarMensajeEvolution('+5491111', 'hola', 'wa-1')
      expect(r.messageId).toBeNull()
    })
  })

  describe('CLIENT_ERROR (4xx)', () => {
    it('400 → CLIENT_ERROR no-retryable, NO reintenta', async () => {
      const fetchMock = mockFetchOnce({ status: 400, body: { error: 'invalid number' } })
      try {
        await enviarMensajeEvolution('+5491111', 'hola', 'wa-1')
        fail('debió lanzar')
      } catch (err) {
        expect((err as EvolutionError).code).toBe(EVO_ERR.CLIENT_ERROR)
        expect((err as EvolutionError).status).toBe(400)
        expect((err as EvolutionError).retryable).toBe(false)
      }
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('SERVER_ERROR (5xx) + retry', () => {
    it('500 en intento 1, 200 en intento 2 → success', async () => {
      const fetchMock = mockFetchSequence([
        { status: 500, body: { error: 'down' } },
        { status: 200, body: { key: { id: 'recovered' } } },
      ])
      const r = await enviarMensajeEvolution('+5491111', 'hola', 'wa-1', { maxAttempts: 2 })
      expect(r.messageId).toBe('recovered')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('500 en ambos intentos → lanza SERVER_ERROR', async () => {
      const fetchMock = mockFetchSequence([
        { status: 500 },
        { status: 502 },
      ])
      try {
        await enviarMensajeEvolution('+5491111', 'hola', 'wa-1', { maxAttempts: 2 })
        fail('debió lanzar')
      } catch (err) {
        expect((err as EvolutionError).code).toBe(EVO_ERR.SERVER_ERROR)
      }
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('maxAttempts=1 → NO reintenta', async () => {
      const fetchMock = mockFetchSequence([{ status: 500 }])
      await expect(
        enviarMensajeEvolution('+5491111', 'hola', 'wa-1', { maxAttempts: 1 })
      ).rejects.toThrow()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('TIMEOUT', () => {
    it('AbortError → TIMEOUT retryable', async () => {
      const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
      mockFetchSequence([{ throwError: abortErr }, { throwError: abortErr }])
      try {
        await enviarMensajeEvolution('+5491111', 'hola', 'wa-1', { maxAttempts: 1, timeoutMs: 50 })
        fail('debió lanzar')
      } catch (err) {
        expect((err as EvolutionError).code).toBe(EVO_ERR.TIMEOUT)
        expect((err as EvolutionError).retryable).toBe(true)
      }
    })

    it('network error genérico → SERVER_ERROR retryable', async () => {
      mockFetchSequence([{ throwError: new Error('ECONNREFUSED') }])
      try {
        await enviarMensajeEvolution('+5491111', 'hola', 'wa-1', { maxAttempts: 1 })
        fail('debió lanzar')
      } catch (err) {
        expect((err as EvolutionError).code).toBe(EVO_ERR.SERVER_ERROR)
        expect((err as EvolutionError).retryable).toBe(true)
      }
    })
  })

  describe('isEvolutionError', () => {
    it('true para EvolutionError', () => {
      expect(isEvolutionError(new EvolutionError(EVO_ERR.TIMEOUT, 'x'))).toBe(true)
    })
    it('false para Error normal', () => {
      expect(isEvolutionError(new Error('x'))).toBe(false)
    })
    it('false para no-error', () => {
      expect(isEvolutionError('string')).toBe(false)
      expect(isEvolutionError(null)).toBe(false)
    })
  })
})
