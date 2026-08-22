import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Board } from '@bingus/shared'
import { SessionProvider } from '../lib/session'
import { BoardArchivePage } from './BoardArchivePage'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  }
}

function makeBoard(n: number, overrides: Partial<Board> = {}): Board {
  return {
    id: `board-${n}`,
    name: `Board ${n}`,
    size: 5,
    terms: ['free coffee'],
    createdBy: `author${n}`,
    plays: n,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

// Behave like the real /api/boards endpoint over an in-memory archive:
// filter by ?search, then slice by ?offset/?limit.
function mockApi(boards: Board[] = []) {
  const fetchMock = vi.fn().mockImplementation(
    (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/me' && method === 'GET') {
        return Promise.resolve(
          jsonResponse(200, { player: { id: 'p1', name: 'Ruth' } }),
        )
      }
      if (url === '/api/games' && method === 'POST') {
        return Promise.resolve(jsonResponse(201, { code: 'BNGS-421' }))
      }
      if (url.startsWith('/api/boards') && method === 'GET') {
        const params = new URL(url, 'http://test').searchParams
        const search = params.get('search')?.toLowerCase() ?? ''
        const limit = Number(params.get('limit') ?? 12)
        const offset = Number(params.get('offset') ?? 0)
        const hits = boards.filter((b) =>
          b.name.toLowerCase().includes(search),
        )
        return Promise.resolve(
          jsonResponse(200, {
            boards: hits.slice(offset, offset + limit),
            total: hits.length,
          }),
        )
      }
      return Promise.resolve(
        jsonResponse(404, { code: 'unauthorized', error: 'nope' }),
      )
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderArchive(initialEntry: string | { pathname: string; state?: unknown } = '/boards') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SessionProvider>
        <Routes>
          <Route path="/boards" element={<BoardArchivePage />} />
          <Route path="/boards/new" element={<h2>Print a fresh board</h2>} />
          <Route path="/game/:code" element={<h2>Game route probe</h2>} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('board archive', () => {
  it('renders a card per board with name, author, and plays', async () => {
    mockApi([
      makeBoard(1, { plays: 41 }),
      makeBoard(2, { plays: 0, size: 3 }),
    ])
    renderArchive()
    expect(await screen.findByText('Board 1')).toBeDefined()
    expect(screen.getByText('by author1')).toBeDefined()
    expect(screen.getByText('41 plays')).toBeDefined()
    expect(screen.getByText('Board 2')).toBeDefined()
    expect(screen.getByText('fresh off the press')).toBeDefined()
    expect(screen.getByText('3×3')).toBeDefined()
    expect(screen.getByText('showing 2 of 2')).toBeDefined()
  })

  it('shows the empty state when the archive has no boards', async () => {
    mockApi([])
    renderArchive()
    expect(
      await screen.findByText(/Nothing in the archive yet/),
    ).toBeDefined()
    // The create tile survives the empty state.
    expect(screen.getByText('Create a new board')).toBeDefined()
    expect(screen.queryByText(/showing/)).toBeNull()
  })

  it('search fetches with the search param after the debounce', async () => {
    const fetchMock = mockApi([
      makeBoard(1, { name: 'Zebra Party' }),
      makeBoard(2, { name: 'Board Meeting' }),
    ])
    renderArchive()
    expect(await screen.findByText('Zebra Party')).toBeDefined()
    fireEvent.change(screen.getByLabelText('Search boards'), {
      target: { value: 'zebra' },
    })
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('search=zebra'),
        ),
      ).toBe(true)
    })
    expect(await screen.findByText('showing 1 of 1')).toBeDefined()
    expect(screen.queryByText('Board Meeting')).toBeNull()
  })

  it('shows the no-match copy for an empty search result', async () => {
    mockApi([makeBoard(1)])
    renderArchive()
    expect(await screen.findByText('Board 1')).toBeDefined()
    fireEvent.change(screen.getByLabelText('Search boards'), {
      target: { value: 'zzzzz' },
    })
    expect(await screen.findByText(/No boards match/)).toBeDefined()
  })

  it('load more appends the next page and updates the count', async () => {
    mockApi(Array.from({ length: 15 }, (_, i) => makeBoard(i + 1)))
    renderArchive()
    expect(await screen.findByText('showing 12 of 15')).toBeDefined()
    expect(screen.queryByText('Board 13')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: /Load more boards/ }),
    )
    expect(await screen.findByText('Board 13')).toBeDefined()
    // First page is still there — appended, not replaced.
    expect(screen.getByText('Board 1')).toBeDefined()
    expect(screen.getByText('showing 15 of 15')).toBeDefined()
    expect(
      screen.queryByRole('button', { name: /Load more boards/ }),
    ).toBeNull()
  })

  it('marks a just-created board with the NEW ribbon', async () => {
    mockApi([
      makeBoard(1, { createdAt: new Date().toISOString() }),
      makeBoard(2),
    ])
    renderArchive()
    expect(await screen.findByText('Board 1')).toBeDefined()
    expect(screen.getAllByText('NEW')).toHaveLength(1)
  })

  it('the create tile navigates to the board creator', async () => {
    mockApi([])
    renderArchive()
    fireEvent.click(
      await screen.findByRole('button', { name: /Create a new board/ }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Print a fresh board' }),
    ).toBeDefined()
  })

  it('play opens a table and navigates to the game route', async () => {
    const fetchMock = mockApi([makeBoard(1)])
    renderArchive()
    fireEvent.click(
      await screen.findByRole('button', { name: /Play this board/ }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Game route probe' }),
    ).toBeDefined()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/games',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('shows the printed toast when arriving from board creation', async () => {
    mockApi([])
    renderArchive({ pathname: '/boards', state: { printed: 'Office Chaos' } })
    expect((await screen.findByRole('status')).textContent).toBe(
      'Board printed: Office Chaos ✓',
    )
  })
})
