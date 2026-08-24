import {
  ApiErrorSchema,
  CreateBoardResponseSchema,
  CreateGameResponseSchema,
  DeleteBoardResponseSchema,
  GetBoardResponseSchema,
  ListBoardsResponseSchema,
  ListGamesResponseSchema,
  ListPlayersResponseSchema,
  LogoutResponseSchema,
  MeResponseSchema,
  ProvisionPlayerResponseSchema,
  ReissueCodeResponseSchema,
  type ApiErrorCode,
  type CreateBoardRequest,
  type CreateBoardResponse,
  type CreateGameRequest,
  type CreateGameResponse,
  type DeleteBoardResponse,
  type GetBoardResponse,
  type ListBoardsQuery,
  type ListBoardsResponse,
  type ListGamesResponse,
  type ListPlayersResponse,
  type LoginRequest,
  type LogoutResponse,
  type MeResponse,
  type ProvisionPlayerRequest,
  type ProvisionPlayerResponse,
  type ReissueCodeResponse,
  type RenamePlayerRequest,
  type SetPasswordRequest,
  type UpdateBoardRequest,
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

export function listBoards(
  query: Partial<ListBoardsQuery> = {},
): Promise<ListBoardsResponse> {
  const params = new URLSearchParams()
  if (query.search) params.set('search', query.search)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  const qs = params.size ? `?${params}` : ''
  return request(`/api/boards${qs}`, {}, (data) =>
    ListBoardsResponseSchema.parse(data),
  )
}

export function createBoard(
  board: CreateBoardRequest,
): Promise<CreateBoardResponse> {
  return request(
    '/api/boards',
    { method: 'POST', body: JSON.stringify(board) },
    (data) => CreateBoardResponseSchema.parse(data),
  )
}

export function getBoard(id: string): Promise<GetBoardResponse> {
  return request(`/api/boards/${id}`, {}, (data) =>
    GetBoardResponseSchema.parse(data),
  )
}

export function updateBoard(
  id: string,
  board: UpdateBoardRequest,
): Promise<GetBoardResponse> {
  return request(
    `/api/boards/${id}`,
    { method: 'PATCH', body: JSON.stringify(board) },
    (data) => GetBoardResponseSchema.parse(data),
  )
}

export function listGames(): Promise<ListGamesResponse> {
  return request('/api/games', {}, (data) => ListGamesResponseSchema.parse(data))
}

export function deleteBoard(id: string): Promise<DeleteBoardResponse> {
  return request(`/api/boards/${id}`, { method: 'DELETE' }, (data) =>
    DeleteBoardResponseSchema.parse(data),
  )
}

// Open a live table for a board; the caller navigates to /game/:code.
export function createGame(boardId: string): Promise<CreateGameResponse> {
  return request(
    '/api/games',
    {
      method: 'POST',
      body: JSON.stringify({ boardId } satisfies CreateGameRequest),
    },
    (data) => CreateGameResponseSchema.parse(data),
  )
}

// Log in with a password or one-time code. The server sets the httpOnly
// session cookie — the token never reaches client code.
export function logIn(name: string, password: string): Promise<MeResponse> {
  return request(
    '/api/login',
    {
      method: 'POST',
      body: JSON.stringify({ name, password } satisfies LoginRequest),
    },
    (data) => MeResponseSchema.parse(data),
  )
}

export function logOut(): Promise<LogoutResponse> {
  return request('/api/logout', { method: 'POST' }, (data) =>
    LogoutResponseSchema.parse(data),
  )
}

// Set a new password; clears the needs-reset gate server-side.
export function setPassword(password: string): Promise<MeResponse> {
  return request(
    '/api/me/password',
    {
      method: 'POST',
      body: JSON.stringify({ password } satisfies SetPasswordRequest),
    },
    (data) => MeResponseSchema.parse(data),
  )
}

// Admin only: create an account. The one-time code in the response is shown
// exactly once — the server keeps only its hash.
export function provisionPlayer(
  name: string,
): Promise<ProvisionPlayerResponse> {
  return request(
    '/api/players',
    {
      method: 'POST',
      body: JSON.stringify({ name } satisfies ProvisionPlayerRequest),
    },
    (data) => ProvisionPlayerResponseSchema.parse(data),
  )
}

export function listPlayers(): Promise<ListPlayersResponse> {
  return request('/api/players', {}, (data) =>
    ListPlayersResponseSchema.parse(data),
  )
}

// Admin only: re-issue a one-time code (invalidates the player's password
// and any live session).
export function reissueCode(playerId: string): Promise<ReissueCodeResponse> {
  return request(`/api/players/${playerId}/code`, { method: 'POST' }, (data) =>
    ReissueCodeResponseSchema.parse(data),
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
