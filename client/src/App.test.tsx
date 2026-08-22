import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./lib/socket', () => ({
  socket: {
    on: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}))

describe('App', () => {
  it('renders the app shell', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true }),
    )
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Bingus' })).toBeDefined()
  })
})
