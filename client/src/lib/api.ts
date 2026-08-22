import {
  ApiErrorSchema,
  CreatePlayerResponseSchema,
  RenamePlayerResponseSchema,
  type ApiErrorCode,
  type CreatePlayerRequest,
  type CreatePlayerResponse,
  type RenamePlayerRequest,
  type RenamePlayerResponse,
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

export function renamePlayer(
  id: string,
  token: string,
  name: string,
): Promise<RenamePlayerResponse> {
  return request(
    `/api/players/${id}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name } satisfies RenamePlayerRequest),
    },
    (data) => RenamePlayerResponseSchema.parse(data),
  )
}
