import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Player } from '@bingus/shared'
import App from './App'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  }
}

const unauthorized = { code: 'unauthorized', error: 'No seat at the table.' }

// Route the fetch mock the way the server would respond. `me` is the player
// the session cookie resolves to (null = signed out / ghost session).
function mockApi({
  me = null,
  stats = { players: 5, boards: 0, liveGames: 0 },
  createStatus = 201,
  createBody = null,
  renamed = null,
}: {
  me?: Player | null
  stats?: { players: number; boards: number; liveGames: number }
  createStatus?: number
  createBody?: unknown
  renamed?: Player | null
} = {}) {
  const fetchMock = vi.fn().mockImplementation(
    (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/me' && method === 'GET') {
        return Promise.resolve(
          me ? jsonResponse(200, { player: me }) : jsonResponse(401, unauthorized),
        )
      }
      if (url === '/api/me' && method === 'PATCH') {
        return Promise.resolve(jsonResponse(200, { player: renamed }))
      }
      if (url === '/api/players' && method === 'POST') {
        return Promise.resolve(jsonResponse(createStatus, createBody))
      }
      if (url === '/api/stats') {
        return Promise.resolve(jsonResponse(200, stats))
      }
      if (url.startsWith('/api/boards') && method === 'GET') {
        return Promise.resolve(jsonResponse(200, { boards: [], total: 0 }))
      }
      return Promise.resolve(jsonResponse(404, { code: 'unauthorized', error: 'nope' }))
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  // BrowserRouter reads jsdom's shared location — reset it between tests.
  window.history.replaceState({}, '', '/')
})

describe('session gate', () => {
  it('shows the sign-in screen when /api/me says there is no session', async () => {
    mockApi({ me: null })
    render(<App />)
    expect(await screen.findByLabelText('YOUR NAME')).toBeDefined()
  })

  it('restores a valid session straight to home', async () => {
    mockApi({ me: { id: 'p1', name: 'Ruth' } })
    render(<App />)
    expect(await screen.findByRole('button', { name: /Ruth/ })).toBeDefined()
    expect(screen.queryByLabelText('YOUR NAME')).toBeNull()
  })

  it('kicks a ghost session back to sign-in', async () => {
    // The cookie may exist in the browser, but the server no longer knows the
    // player — /api/me 401s and the only screen offered is sign-in.
    mockApi({ me: null })
    render(<App />)
    expect(await screen.findByLabelText('YOUR NAME')).toBeDefined()
    expect(screen.queryByRole('button', { name: /Let's go/ })).toBeNull()
  })
})

describe('sign-in flow', () => {
  it('signs in and lands on home with the profile chip', async () => {
    mockApi({
      me: null,
      createBody: { player: { id: 'p1', name: 'Ruth' } },
    })
    render(<App />)
    fireEvent.change(await screen.findByLabelText('YOUR NAME'), {
      target: { value: 'Ruth' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Let's play/ }))
    expect(await screen.findByRole('button', { name: /Ruth/ })).toBeDefined()
  })

  it('surfaces a name-taken error from the server', async () => {
    mockApi({
      me: null,
      createStatus: 409,
      createBody: {
        code: 'name_taken',
        error: '"Ruth" is taken. Choose more wisely.',
      },
    })
    render(<App />)
    fireEvent.change(await screen.findByLabelText('YOUR NAME'), {
      target: { value: 'Ruth' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Let's play/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('taken')
  })
})

describe('home screen', () => {
  it('shows both game cards and the stats strip', async () => {
    mockApi({
      me: { id: 'p1', name: 'Ruth' },
      stats: { players: 5, boards: 0, liveGames: 0 },
    })
    render(<App />)
    expect(
      await screen.findByRole('heading', { name: /Start a\s*new game/ }),
    ).toBeDefined()
    expect(screen.getByRole('heading', { name: /Join a\s*game/ })).toBeDefined()
    expect(await screen.findByText(/5 players signed up/)).toBeDefined()
    expect(screen.getByText(/No live tables right now/)).toBeDefined()
    expect(screen.queryByText(/LIVE/)).toBeNull()
  })

  it('shows the live badge when tables are live', async () => {
    mockApi({
      me: { id: 'p1', name: 'Ruth' },
      stats: { players: 5, boards: 0, liveGames: 3 },
    })
    render(<App />)
    expect(await screen.findByText('3 LIVE')).toBeDefined()
    expect(screen.getByText(/3 tables are playing right now/)).toBeDefined()
  })

  it('navigates to the board archive from the new-game CTA', async () => {
    mockApi({ me: { id: 'p1', name: 'Ruth' } })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Let's go/ }))
    expect(
      await screen.findByRole('heading', { name: /Pick your battlefield/ }),
    ).toBeDefined()
  })

  it('navigates to the live tables screen from the join CTA', async () => {
    mockApi({ me: { id: 'p1', name: 'Ruth' } })
    render(<App />)
    fireEvent.click(
      await screen.findByRole('button', { name: /See live tables/ }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Live tables' }),
    ).toBeDefined()
  })
})

describe('profile rename', () => {
  it('renames via the header profile chip', async () => {
    const fetchMock = mockApi({
      me: { id: 'p1', name: 'Ruth' },
      renamed: { id: 'p1', name: 'TileSlayer' },
    })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Ruth/ }))
    fireEvent.change(screen.getByLabelText('CHANGE YOUR NAME'), {
      target: { value: 'TileSlayer' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByRole('button', { name: /TileSlayer/ }),
    ).toBeDefined()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ method: 'PATCH' }),
    )
  })
})
