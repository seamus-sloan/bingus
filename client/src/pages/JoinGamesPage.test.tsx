import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameSummary } from '@bingus/shared'
import { SessionProvider } from '../lib/session'
import { JoinGamesPage } from './JoinGamesPage'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  }
}

function makeGame(n: number, overrides: Partial<GameSummary> = {}): GameSummary {
  return {
    code: `BNGS-10${n}`,
    boardName: `Board ${n}`,
    size: 5,
    hostName: `host${n}`,
    status: 'lobby',
    playerNames: ['Ann', 'Ben'],
    createdAt: '2026-08-22T00:00:00.000Z',
    startedAt: null,
    ...overrides,
  }
}

// Behave like the real endpoints: /api/me resolves the session, /api/games
// serves one batch per call (the last batch repeats once exhausted, so the
// poll can observe a changed list).
function mockApi(batches: GameSummary[][]) {
  let call = 0
  const fetchMock = vi.fn().mockImplementation(
    (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/me' && method === 'GET') {
        return Promise.resolve(
          jsonResponse(200, { player: { id: 'p1', name: 'Ruth' } }),
        )
      }
      if (url === '/api/games' && method === 'GET') {
        const games = batches[Math.min(call, batches.length - 1)]
        call++
        return Promise.resolve(jsonResponse(200, { games }))
      }
      return Promise.resolve(
        jsonResponse(404, { code: 'unauthorized', error: 'nope' }),
      )
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function GameProbe() {
  const { code } = useParams()
  return <h2>Game route probe {code}</h2>
}

function renderJoin() {
  return render(
    <MemoryRouter initialEntries={['/join']}>
      <SessionProvider>
        <Routes>
          <Route path="/join" element={<JoinGamesPage />} />
          <Route path="/game/:code" element={<GameProbe />} />
          <Route path="/boards" element={<h2>Archive probe</h2>} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('live tables', () => {
  it('renders a row per game with board name, host, size badge, and count', async () => {
    mockApi([[makeGame(1), makeGame(2, { size: 3, playerNames: ['Cleo'] })]])
    renderJoin()
    expect(await screen.findByText('Board 1')).toBeDefined()
    expect(screen.getByText('5×5')).toBeDefined()
    expect(
      screen.getByText('hosted by host1 · waiting for players'),
    ).toBeDefined()
    expect(screen.getByText('2 / 8')).toBeDefined()
    expect(screen.getByText('Board 2')).toBeDefined()
    expect(screen.getByText('3×3')).toBeDefined()
    expect(screen.getByText('1 / 8')).toBeDefined()
  })

  it('shows the lobby phase for waiting games and a relative one for started games', async () => {
    mockApi([
      [
        makeGame(1),
        makeGame(2, {
          status: 'playing',
          startedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
        }),
        makeGame(3, {
          status: 'playing',
          startedAt: new Date(Date.now() - 10_000).toISOString(),
        }),
      ],
    ])
    renderJoin()
    expect(
      await screen.findByText('hosted by host1 · waiting for players'),
    ).toBeDefined()
    expect(
      screen.getByText('hosted by host2 · started 4 min ago'),
    ).toBeDefined()
    expect(
      screen.getByText('hosted by host3 · started just now'),
    ).toBeDefined()
  })

  it('flags a nearly-full table as filling fast', async () => {
    mockApi([
      [
        makeGame(1, { playerNames: ['Ann', 'Ben', 'Cleo', 'Dev'] }),
        makeGame(2),
      ],
    ])
    renderJoin()
    expect(await screen.findByText('Board 1')).toBeDefined()
    expect(screen.getAllByText(/FILLING FAST/)).toHaveLength(1)
  })

  it('stacks the first three avatars and overflows the rest into +N', async () => {
    mockApi([
      [makeGame(1, { playerNames: ['Ann', 'Ben', 'Cleo', 'Dev', 'Elle'] })],
    ])
    renderJoin()
    expect(await screen.findByTitle('Ann')).toBeDefined()
    expect(screen.getByTitle('Ben')).toBeDefined()
    expect(screen.getByTitle('Cleo')).toBeDefined()
    expect(screen.queryByTitle('Dev')).toBeNull()
    expect(screen.getByText('+2')).toBeDefined()
    expect(screen.getByText('5 / 8')).toBeDefined()
  })

  it('join navigates to the game route', async () => {
    mockApi([[makeGame(7)]])
    renderJoin()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Join Board 7' }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Game route probe BNGS-107' }),
    ).toBeDefined()
  })

  it('shows the empty state with a working archive button', async () => {
    mockApi([[]])
    renderJoin()
    expect(
      await screen.findByText(/No live tables right now/),
    ).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'To the archive →' }))
    expect(
      await screen.findByRole('heading', { name: 'Archive probe' }),
    ).toBeDefined()
  })

  it('polls every 5s and renders freshly listed games', async () => {
    vi.useFakeTimers()
    const fetchMock = mockApi([
      [makeGame(1)],
      [makeGame(1), makeGame(2)],
    ])
    renderJoin()
    const gamesCalls = () =>
      fetchMock.mock.calls.filter(([url]) => url === '/api/games').length
    // Flush the mount fetch (findBy's waitFor doesn't tick fake timers).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(gamesCalls()).toBe(1)
    expect(screen.getByText('Board 1')).toBeDefined()
    expect(screen.queryByText('Board 2')).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(gamesCalls()).toBe(2)
    expect(screen.getByText('Board 2')).toBeDefined()
    // The first row is still there — the list was replaced wholesale.
    expect(screen.getByText('Board 1')).toBeDefined()
  })
})
