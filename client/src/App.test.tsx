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
// the session cookie resolves to (null = signed out / ghost session); the
// flags ride the same /api/me body the way the server sends them.
function mockApi({
  me = null,
  needsPasswordReset = false,
  isAdmin = false,
  stats = { players: 5, boards: 0, liveGames: 0 },
  loginStatus = 200,
  loginBody = null,
  setPasswordBody = null,
  renamed = null,
  roster = [],
}: {
  me?: Player | null
  needsPasswordReset?: boolean
  isAdmin?: boolean
  stats?: { players: number; boards: number; liveGames: number }
  loginStatus?: number
  loginBody?: unknown
  setPasswordBody?: unknown
  renamed?: Player | null
  roster?: unknown[]
} = {}) {
  const fetchMock = vi.fn().mockImplementation(
    (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/me' && method === 'GET') {
        return Promise.resolve(
          me
            ? jsonResponse(200, { player: me, needsPasswordReset, isAdmin })
            : jsonResponse(401, unauthorized),
        )
      }
      if (url === '/api/me' && method === 'PATCH') {
        return Promise.resolve(jsonResponse(200, { player: renamed }))
      }
      if (url === '/api/login' && method === 'POST') {
        return Promise.resolve(jsonResponse(loginStatus, loginBody))
      }
      if (url === '/api/logout' && method === 'POST') {
        return Promise.resolve(jsonResponse(200, { ok: true }))
      }
      if (url === '/api/me/password' && method === 'POST') {
        return Promise.resolve(jsonResponse(200, setPasswordBody))
      }
      if (url === '/api/players' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, { players: roster }))
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

async function fillLogin(name: string, password: string) {
  fireEvent.change(await screen.findByLabelText('YOUR NAME'), {
    target: { value: name },
  })
  fireEvent.change(screen.getByLabelText('CODE OR PASSWORD'), {
    target: { value: password },
  })
  fireEvent.click(screen.getByRole('button', { name: /Let's play/ }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  // BrowserRouter reads jsdom's shared location — reset it between tests.
  window.history.replaceState({}, '', '/')
})

describe('session gate', () => {
  it('shows the login screen when /api/me says there is no session', async () => {
    mockApi({ me: null })
    render(<App />)
    expect(await screen.findByLabelText('YOUR NAME')).toBeDefined()
    expect(screen.getByLabelText('CODE OR PASSWORD')).toBeDefined()
  })

  it('restores a valid session straight to home', async () => {
    mockApi({ me: { id: 'p1', name: 'Ruth' } })
    render(<App />)
    expect(await screen.findByRole('button', { name: /Ruth/ })).toBeDefined()
    expect(screen.queryByLabelText('YOUR NAME')).toBeNull()
  })

  it('kicks a ghost session back to the login screen', async () => {
    // The cookie may exist in the browser, but the server no longer knows the
    // player — /api/me 401s and the only screen offered is login.
    mockApi({ me: null })
    render(<App />)
    expect(await screen.findByLabelText('YOUR NAME')).toBeDefined()
    expect(screen.queryByRole('button', { name: /Let's go/ })).toBeNull()
  })
})

describe('login flow', () => {
  it('logs in and lands on home with the profile chip', async () => {
    mockApi({
      me: null,
      loginBody: {
        player: { id: 'p1', name: 'Ruth' },
        needsPasswordReset: false,
        isAdmin: false,
      },
    })
    render(<App />)
    await fillLogin('Ruth', 'hunter22well')
    expect(await screen.findByRole('button', { name: /Ruth/ })).toBeDefined()
  })

  it('surfaces bad credentials from the server', async () => {
    mockApi({
      me: null,
      loginStatus: 401,
      loginBody: {
        code: 'invalid_credentials',
        error: "Name and code/password don't match.",
      },
    })
    render(<App />)
    await fillLogin('Ruth', 'wrong-guess')
    expect((await screen.findByRole('alert')).textContent).toContain(
      "don't match",
    )
  })

  it('logging in with a one-time code lands on the set-password screen', async () => {
    mockApi({
      me: null,
      loginBody: {
        player: { id: 'p1', name: 'Ruth' },
        needsPasswordReset: true,
        isAdmin: false,
      },
    })
    render(<App />)
    await fillLogin('Ruth', 'ABCD-EFGH')
    expect(await screen.findByLabelText('NEW PASSWORD')).toBeDefined()
  })
})

describe('forced password reset', () => {
  it('traps a needs-reset session on the set-password screen at any URL', async () => {
    mockApi({ me: { id: 'p1', name: 'Ruth' }, needsPasswordReset: true })
    window.history.replaceState({}, '', '/boards')
    render(<App />)
    expect(await screen.findByLabelText('NEW PASSWORD')).toBeDefined()
    expect(screen.queryByRole('button', { name: /Ruth/ })).toBeNull()
  })

  it('validates length and match before calling the server', async () => {
    const fetchMock = mockApi({
      me: { id: 'p1', name: 'Ruth' },
      needsPasswordReset: true,
    })
    render(<App />)
    fireEvent.change(await screen.findByLabelText('NEW PASSWORD'), {
      target: { value: 'short' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Lock it in/ }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'At least 8',
    )
    fireEvent.change(screen.getByLabelText('NEW PASSWORD'), {
      target: { value: 'hunter22well' },
    })
    fireEvent.change(screen.getByLabelText('SAY IT AGAIN'), {
      target: { value: 'hunter22welp' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Lock it in/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('match')
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/me/password',
      expect.anything(),
    )
  })

  it('unlocks the app once the new password lands', async () => {
    mockApi({
      me: { id: 'p1', name: 'Ruth' },
      needsPasswordReset: true,
      setPasswordBody: {
        player: { id: 'p1', name: 'Ruth' },
        needsPasswordReset: false,
        isAdmin: false,
      },
    })
    render(<App />)
    fireEvent.change(await screen.findByLabelText('NEW PASSWORD'), {
      target: { value: 'hunter22well' },
    })
    fireEvent.change(screen.getByLabelText('SAY IT AGAIN'), {
      target: { value: 'hunter22well' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Lock it in/ }))
    expect(await screen.findByRole('button', { name: /Ruth/ })).toBeDefined()
  })
})

describe('logout', () => {
  it('logs out from the profile popover back to the login screen', async () => {
    const fetchMock = mockApi({ me: { id: 'p1', name: 'Ruth' } })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Ruth/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(await screen.findByLabelText('YOUR NAME')).toBeDefined()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/logout',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('admin access', () => {
  it('shows the Admin link and route to admins', async () => {
    mockApi({ me: { id: 'p1', name: 'Ruth' }, isAdmin: true })
    render(<App />)
    fireEvent.click(await screen.findByRole('link', { name: 'Admin' }))
    expect(
      await screen.findByRole('heading', { name: 'Player accounts' }),
    ).toBeDefined()
  })

  it('hides the Admin link and bounces the route for everyone else', async () => {
    mockApi({ me: { id: 'p1', name: 'Ruth' } })
    window.history.replaceState({}, '', '/admin/users')
    render(<App />)
    // Bounced home by the catch-all.
    expect(
      await screen.findByRole('heading', { name: /Start a\s*new game/ }),
    ).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
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
