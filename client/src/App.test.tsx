import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('sign-in flow', () => {
  it('shows the sign-in screen when no session exists', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Bingus' })).toBeDefined()
    expect(screen.getByLabelText('YOUR NAME')).toBeDefined()
  })

  it('signs in and lands on home with the profile chip', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(201, {
          player: { id: 'p1', name: 'Ruth' },
          token: 'tok',
        }),
      ),
    )
    render(<App />)
    fireEvent.change(screen.getByLabelText('YOUR NAME'), {
      target: { value: 'Ruth' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Let's play/ }))
    expect(await screen.findByRole('button', { name: /Ruth/ })).toBeDefined()
    expect(
      JSON.parse(localStorage.getItem('bingus.session') ?? 'null'),
    ).toEqual({ player: { id: 'p1', name: 'Ruth' }, token: 'tok' })
  })

  it('surfaces a name-taken error from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          code: 'name_taken',
          error: '"Ruth" is taken. Choose more wisely.',
        }),
      ),
    )
    render(<App />)
    fireEvent.change(screen.getByLabelText('YOUR NAME'), {
      target: { value: 'Ruth' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Let's play/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('taken')
  })
})

describe('home screen', () => {
  function signInAndMockStats(liveGames: number) {
    localStorage.setItem(
      'bingus.session',
      JSON.stringify({ player: { id: 'p1', name: 'Ruth' }, token: 'tok' }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url === '/api/stats'
            ? jsonResponse(200, { players: 5, boards: 0, liveGames })
            : jsonResponse(404, { code: 'not_found', error: 'nope' }),
        ),
      ),
    )
  }

  it('shows both game cards and the stats strip', async () => {
    signInAndMockStats(0)
    render(<App />)
    expect(
      screen.getByRole('heading', { name: /Start a\s*new game/ }),
    ).toBeDefined()
    expect(screen.getByRole('heading', { name: /Join a\s*game/ })).toBeDefined()
    expect(await screen.findByText(/5 players signed up/)).toBeDefined()
    expect(screen.getByText(/No live tables right now/)).toBeDefined()
    expect(screen.queryByText(/LIVE/)).toBeNull()
  })

  it('shows the live badge when tables are live', async () => {
    signInAndMockStats(3)
    render(<App />)
    expect(await screen.findByText('3 LIVE')).toBeDefined()
    expect(screen.getByText(/3 tables are playing right now/)).toBeDefined()
  })

  it('raises a coming-soon toast from the CTAs', async () => {
    signInAndMockStats(0)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Let's go/ }))
    expect((await screen.findByRole('status')).textContent).toContain(
      'still at the printers',
    )
  })
})

describe('profile rename', () => {
  it('renames via the header profile chip', async () => {
    localStorage.setItem(
      'bingus.session',
      JSON.stringify({ player: { id: 'p1', name: 'Ruth' }, token: 'tok' }),
    )
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { player: { id: 'p1', name: 'TileSlayer' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Ruth/ }))
    fireEvent.change(screen.getByLabelText('CHANGE YOUR NAME'), {
      target: { value: 'TileSlayer' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByRole('button', { name: /TileSlayer/ }),
    ).toBeDefined()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/players/p1',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    )
  })
})
