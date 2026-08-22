import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  }
}

// Minimal slice of the App.test.tsx fetch mock: a signed-in player plus the
// endpoints the home and archive screens hit on mount.
function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (url === '/api/me') {
        return Promise.resolve(
          jsonResponse(200, { player: { id: 'p1', name: 'Ruth' } }),
        )
      }
      if (url === '/api/stats') {
        return Promise.resolve(
          jsonResponse(200, { players: 5, boards: 0, liveGames: 0 }),
        )
      }
      if (url.startsWith('/api/boards')) {
        return Promise.resolve(jsonResponse(200, { boards: [], total: 0 }))
      }
      return Promise.resolve(
        jsonResponse(404, { code: 'unauthorized', error: 'nope' }),
      )
    }),
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  // BrowserRouter reads jsdom's shared location — reset it between tests.
  window.history.replaceState({}, '', '/')
})

describe('header wordmark', () => {
  it('links back to the home screen from another route', async () => {
    mockApi()
    window.history.replaceState({}, '', '/boards')
    render(<App />)
    expect(
      await screen.findByRole('heading', { name: /Pick your battlefield/ }),
    ).toBeDefined()
    fireEvent.click(screen.getByRole('link', { name: 'Bingus' }))
    expect(
      await screen.findByRole('heading', { name: /Game on, Ruth/ }),
    ).toBeDefined()
  })
})
