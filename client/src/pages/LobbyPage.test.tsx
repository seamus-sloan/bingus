import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GamePlayer, GameState, Player } from '@bingus/shared'
import type { GameRoomView } from '../lib/gameRoom'
import { SessionProvider } from '../lib/session'
import { LobbyPage } from './LobbyPage'

const HOST: Player = { id: 'p1', name: 'Ruth' }
const GUEST: Player = { id: 'p2', name: 'Milo' }

function seat(player: Player, overrides: Partial<GamePlayer> = {}): GamePlayer {
  return { player, card: [], marks: [], connected: true, isHost: false, ...overrides }
}

function makeRoom(overrides: Partial<GameState> = {}): GameRoomView {
  return {
    state: {
      code: 'BNGS-421',
      board: { id: 'b1', name: 'Office Chaos', size: 5 },
      status: 'lobby',
      players: [seat(HOST, { isHost: true }), seat(GUEST)],
      winner: null,
      ...overrides,
    },
    chat: [],
    start: vi.fn().mockResolvedValue(null),
    mark: vi.fn().mockResolvedValue(null),
    sendChat: vi.fn(),
    rematch: vi.fn().mockResolvedValue(null),
  }
}

// The session provider resolves the signed-in player via /api/me.
function stubMe(player: Player) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ player }),
    }),
  )
}

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  return writeText
}

function renderLobby(room: GameRoomView) {
  return render(
    <MemoryRouter initialEntries={[`/game/${room.state.code}`]}>
      <SessionProvider>
        <LobbyPage room={room} />
      </SessionProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('game lobby', () => {
  it('renders the board name, one tile per code character, and a chip per player', async () => {
    stubMe(HOST)
    renderLobby(makeRoom())
    expect(
      await screen.findByRole('heading', { name: 'Office Chaos' }),
    ).toBeDefined()
    const tiles = screen.getByRole('group', { name: 'Join code BNGS-421' })
    expect(tiles.children).toHaveLength('BNGS-421'.length)
    expect(tiles.textContent).toBe('BNGS-421')
    expect(screen.getByText('Ruth')).toBeDefined()
    expect(screen.getByText('Milo')).toBeDefined()
    // Exactly one HOST badge, and it sits on the host's chip.
    const hostTag = screen.getByText('HOST')
    expect(hostTag.parentElement?.textContent).toContain('Ruth')
    expect(screen.getByText('waiting for victims…')).toBeDefined()
  })

  it('shows the start button to the host', async () => {
    stubMe(HOST)
    renderLobby(makeRoom())
    expect(
      await screen.findByRole('button', { name: /Start the game/ }),
    ).toBeDefined()
    expect(screen.queryByText(/waiting for Ruth to start/)).toBeNull()
  })

  it('shows guests the waiting line instead of the start button', async () => {
    stubMe(GUEST)
    renderLobby(makeRoom())
    expect(
      await screen.findByText('waiting for Ruth to start the game…'),
    ).toBeDefined()
    expect(screen.queryByRole('button', { name: /Start the game/ })).toBeNull()
  })

  it('clicking start calls room.start and surfaces a returned error', async () => {
    stubMe(HOST)
    const room = makeRoom()
    room.start = vi.fn().mockResolvedValue('Need at least 2 players.')
    renderLobby(room)
    fireEvent.click(
      await screen.findByRole('button', { name: /Start the game/ }),
    )
    expect(room.start).toHaveBeenCalledTimes(1)
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Need at least 2 players.',
    )
  })

  it('copy invite link writes the game URL and flips its label', async () => {
    stubMe(GUEST)
    const writeText = stubClipboard()
    renderLobby(makeRoom())
    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        `${location.origin}/game/BNGS-421`,
      )
    })
    expect(
      await screen.findByRole('button', { name: 'Copied! Now recruit ✓' }),
    ).toBeDefined()
  })
})
