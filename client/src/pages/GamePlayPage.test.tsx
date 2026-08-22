import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, GamePlayer, GameState } from '@bingus/shared'
import type { GameRoomView } from '../lib/gameRoom'
import { SessionProvider } from '../lib/session'
import { GamePlayPage } from './GamePlayPage'

// Size-3 fixtures: cells 0..8, FREE at index 4, cards carry 8 terms.
const MY_TERMS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
]
const RIVAL_TERMS = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7', 'z8']

function makePlayer(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    player: { id: 'p1', name: 'Ruth' },
    card: MY_TERMS,
    marks: [],
    connected: true,
    isHost: true,
    ...overrides,
  }
}

function makeRival(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return makePlayer({
    player: { id: 'p2', name: 'Zoe' },
    card: RIVAL_TERMS,
    isHost: false,
    ...overrides,
  })
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    code: 'BNGS-421',
    board: { id: 'b1', name: 'Office Chaos', size: 3 },
    status: 'playing',
    players: [makePlayer(), makeRival()],
    winner: null,
    ...overrides,
  }
}

function makeRoom(
  state: GameState,
  chat: ChatMessage[] = [],
): GameRoomView & { mark: ReturnType<typeof vi.fn> } {
  return {
    state,
    chat,
    start: vi.fn().mockResolvedValue(null),
    mark: vi.fn().mockResolvedValue(null),
    sendChat: vi.fn(),
  }
}

function stubMe() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ player: { id: 'p1', name: 'Ruth' } }),
    }),
  )
}

async function renderGame(room: GameRoomView) {
  stubMe()
  render(
    <MemoryRouter initialEntries={['/game/BNGS-421']}>
      <SessionProvider>
        <Routes>
          <Route path="/game/:code" element={<GamePlayPage room={room} />} />
          <Route path="/boards" element={<h2>Archive probe</h2>} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  )
  // The page renders once the session resolves.
  return within(await screen.findByRole('group', { name: 'Your card' }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('gameplay screen', () => {
  it('renders my card in order with FREE at the free index', async () => {
    const card = await renderGame(
      makeRoom(makeState({ players: [makePlayer({ marks: [0] }), makeRival()] })),
    )
    const cells = card.getAllByRole('button')
    expect(cells).toHaveLength(9)
    // Terms keep card order around the FREE tile at index 4.
    expect(cells[0].textContent).toBe('alpha')
    expect(cells[3].textContent).toBe('delta')
    expect(cells[4].textContent).toContain('FREE')
    expect(cells[5].textContent).toBe('echo')
    expect(cells[8].textContent).toBe('hotel')
    // Marked cells (and FREE) carry the pressed state; the rest do not.
    expect(cells[0].getAttribute('aria-pressed')).toBe('true')
    expect(cells[4].getAttribute('aria-pressed')).toBe('true')
    expect(cells[1].getAttribute('aria-pressed')).toBe('false')
  })

  it('clicking an unmarked cell marks it; the FREE tile never calls mark', async () => {
    const room = makeRoom(makeState())
    const card = await renderGame(room)
    const cells = card.getAllByRole('button')
    fireEvent.click(cells[1])
    expect(room.mark).toHaveBeenCalledWith(1, true)
    fireEvent.click(cells[4])
    expect(room.mark).toHaveBeenCalledTimes(1)
  })

  it('clicking a marked cell unmarks it', async () => {
    const room = makeRoom(
      makeState({ players: [makePlayer({ marks: [2] }), makeRival()] }),
    )
    const card = await renderGame(room)
    fireEvent.click(card.getAllByRole('button')[2])
    expect(room.mark).toHaveBeenCalledWith(2, false)
  })

  it('shows rival mini-boards with tile counts and opens the peek card', async () => {
    const room = makeRoom(
      makeState({ players: [makePlayer(), makeRival({ marks: [0, 2] })] }),
    )
    await renderGame(room)
    const rival = screen.getByRole('button', { name: /Zoe/ })
    // marks + the FREE tile
    expect(rival.textContent).toContain('3 tiles')
    fireEvent.click(rival)
    expect(screen.getByText("Zoe's card")).toBeDefined()
    expect(screen.getByText('3 tiles · updating live')).toBeDefined()
    expect(screen.getByText('z1')).toBeDefined()
    expect(screen.getByText('z8')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Close peek' }))
    expect(screen.queryByText("Zoe's card")).toBeNull()
  })

  it('renders incoming chat and sends via the input', async () => {
    const room = makeRoom(makeState(), [
      {
        player: { id: 'p2', name: 'Zoe' },
        text: 'get rekt',
        at: '2026-08-22T00:00:00.000Z',
      },
    ])
    await renderGame(room)
    expect(screen.getByText('get rekt')).toBeDefined()
    fireEvent.change(screen.getByPlaceholderText('say something spicy…'), {
      target: { value: 'nice one' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(room.sendChat).toHaveBeenCalledWith('nice one')
    expect(
      (screen.getByPlaceholderText('say something spicy…') as HTMLInputElement)
        .value,
    ).toBe('')
  })

  it('shows the BINGO overlay with the pattern badge when I win', async () => {
    await renderGame(
      makeRoom(
        makeState({
          status: 'finished',
          winner: { playerId: 'p1', pattern: 'diagonal', line: [0, 4, 8] },
        }),
      ),
    )
    expect(screen.getByText('BINGO!')).toBeDefined()
    expect(screen.getByText('DIAGONAL, BABY')).toBeDefined()
    expect(screen.getByText(/Ruth wins/)).toBeDefined()
  })

  it('shows the loss card naming the winner when a rival wins', async () => {
    await renderGame(
      makeRoom(
        makeState({
          status: 'finished',
          winner: { playerId: 'p2', pattern: 'row', line: [0, 1, 2] },
        }),
      ),
    )
    expect(screen.getByText('You Lose! 💀')).toBeDefined()
    expect(
      screen.getByText('Zoe hit a full row across on Office Chaos.'),
    ).toBeDefined()
  })

  it('cells stop responding once the game is finished', async () => {
    const room = makeRoom(
      makeState({
        status: 'finished',
        winner: { playerId: 'p2', pattern: 'blackout', line: [] },
      }),
    )
    const card = await renderGame(room)
    fireEvent.click(card.getAllByRole('button')[1])
    expect(room.mark).not.toHaveBeenCalled()
  })
})
