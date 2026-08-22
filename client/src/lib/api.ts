import {
  ApiErrorSchema,
  CreatePlayerResponseSchema,
  MeResponseSchema,
  type ApiErrorCode,
  type CreatePlayerRequest,
  type CreatePlayerResponse,
  type MeResponse,
  type RenamePlayerRequest,
  StatsResponseSchema,
  type StatsResponse,
} from '@bingus/shared'

export class ApiError extends Error {
  code: ApiErrorCode

  constructor(code: ApiErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  parse: (data: unknown) => T,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = ApiErrorSchema.safeParse(data)
    if (err.success) throw new ApiError(err.data.code, err.data.error)
    throw new Error(`Request failed (${res.status})`)
  }
  return parse(data)
}

export function getStats(): Promise<StatsResponse> {
  return request('/api/stats', {}, (data) => StatsResponseSchema.parse(data))
}

// Sign in. The server responds with the player and sets the httpOnly session
// cookie — the token never reaches client code.
export function createPlayer(name: string): Promise<CreatePlayerResponse> {
  return request(
    '/api/players',
    {
      method: 'POST',
      body: JSON.stringify({ name } satisfies CreatePlayerRequest),
    },
    (data) => CreatePlayerResponseSchema.parse(data),
  )
}

// Resolve the session cookie to a player; null means no valid session
// (no cookie, or a ghost session whose player no longer exists).
export async function getMe(): Promise<MeResponse | null> {
  try {
    return await request('/api/me', {}, (data) => MeResponseSchema.parse(data))
  } catch (err) {
    if (err instanceof ApiError && err.code === 'unauthorized') return null
    throw err
  }
}

export function renameMe(name: string): Promise<MeResponse> {
  return request(
    '/api/me',
    {
      method: 'PATCH',
      body: JSON.stringify({ name } satisfies RenamePlayerRequest),
    },
    (data) => MeResponseSchema.parse(data),
  )
}
