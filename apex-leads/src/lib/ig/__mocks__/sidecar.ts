import type { ProfileData, SendDMResult, InboxMessage, DiscoverResult, DiscoverCompetitorResult } from '../sidecar'

export class SidecarError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`Sidecar ${status}: ${detail}`)
    this.name = 'SidecarError'
  }

  get isCircuitOpen() {
    return this.status === 503
  }
}

export const enrichProfiles = jest.fn<
  Promise<{ profiles: ProfileData[]; errors: Record<string, string> }>,
  [string[]]
>().mockResolvedValue({ profiles: [], errors: {} })

export const sendDM = jest.fn<Promise<SendDMResult>, [string, string]>().mockResolvedValue({
  thread_id: 'mock-thread-001',
  message_id: 'mock-msg-001',
})

export const pollInbox = jest.fn<Promise<{ messages: InboxMessage[] }>, [number?]>().mockResolvedValue({
  messages: [],
})

export const discoverHashtag = jest.fn<Promise<DiscoverResult>, [string, number?]>().mockResolvedValue({
  run_id: 'mock-run-1',
  users_seen: 0,
  users_new: 0,
})

export const discoverLocation = jest.fn<Promise<DiscoverResult>, [number, number?]>().mockResolvedValue({
  run_id: 'mock-run-2',
  users_seen: 0,
  users_new: 0,
})

export const discoverCompetitorFollowers = jest
  .fn<Promise<DiscoverCompetitorResult>, [string, number?, string?]>()
  .mockResolvedValue({ run_id: 'mock-run-3', users_seen: 0, users_new: 0, next_cursor: null })

export const discoverPostEngagers = jest
  .fn<Promise<DiscoverResult>, [string, ('likers' | 'commenters')?]>()
  .mockResolvedValue({ run_id: 'mock-run-4', users_seen: 0, users_new: 0 })
