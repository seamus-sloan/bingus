import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GamePlayer, GameState } from '@bingus/shared'
import type { GameRoomView } from '../lib/gameRoom'
import { SessionProvider } from '../lib/session'
import { GameOverPage } from './GameOverPage'

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
const THIRD_TERMS = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']

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

function makeThird(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return makePlayer({
    player: { id: 'p3', name: 'Kai' },
    card: THIRD_TERMS,
    isHost: false,
    ...overrides,
  })
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    code: 'BNGS-421',
    board: { id: 'b1', name: 'Office Chaos', size: 3 },
    status: 'finished',
    players: [makePlayer(), makeRival(), makeThird()],
    winner: { playerId: 'p1', pattern: 'diagonal', line: [0, 4, 8] },
    ...overrides,
  }
}

function makeRoom(
  state: GameState,
): GameRoomView & { rematch: ReturnType<typeof vi.fn> } {
  return {
    state,
    chat: [],
    start: vi.fn().mockResolvedValue(null),
    mark: vi.fn().mockResolvedValue(null),
    sendChat: vi.fn(),
    rematch: vi.fn().mockResolvedValue(null),
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

function renderGameOver(room: GameRoomView) {
  stubMe()
  render(
    <MemoryRouter initialEntries={['/game/BNGS-421']}>
      <SessionProvider>
        <Routes>
          <Route path="/game/:code" element={<GameOverPage room={room} />} />
          <Route path="/" element={<h2>Home probe</h2>} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  )
}

function winState(): GameState {
  return makeState({
    players: [makePlayer({ marks: [0, 8] }), makeRival(), makeThird()],
    winner: { playerId: 'p1', pattern: 'diagonal', line: [0, 4, 8] },
  })
}

function loseState(): GameState {
  return makeState({
    players: [
      makePlayer({ marks: [1] }),
      makeRival({ marks: [0, 1, 2, 5] }),
      makeThird({ marks: [3] }),
    ],
    winner: { playerId: 'p2', pattern: 'row', line: [0, 1, 2] },
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('game over screen — win', () => {
  it('celebrates with BINGO, the pattern badge, and my card with the winning line ringed', async () => {
    renderGameOver(makeRoom(winState()))
    expect(await screen.findByText('BINGO!')).toBeDefined()
    expect(screen.getByText('DIAGONAL, BABY')).toBeDefined()
    expect(screen.getByText(/Ruth wins/)).toBeDefined()
    const card = screen.getByRole('group', { name: 'Your winning card' })
    const tiles = Array.from(card.children)
    expect(tiles).toHaveLength(9)
    for (const i of [0, 4, 8]) {
      expect(tiles[i].className).toContain('tileRing')
    }
    expect(tiles[1].className).not.toContain('tileRing')
  })

  it('"Run it back" calls room.rematch', async () => {
    const room = makeRoom(winState())
    renderGameOver(room)
    fireEvent.click(await screen.findByRole('button', { name: 'Run it back 🔁' }))
    expect(room.rematch).toHaveBeenCalledTimes(1)
  })

  it('keeps rivals\' boards visible with click-to-peek', async () => {
    renderGameOver(makeRoom(winState()))
    expect(await screen.findByText('THE REST OF THE TABLE')).toBeDefined()
    expect(screen.getByRole('button', { name: "Kai's board" })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: "Zoe's board" }))
    const peek = screen.getByRole('dialog', { name: "Zoe's full card" })
    expect(peek.textContent).toContain("Zoe's card")
    fireEvent.click(screen.getByRole('button', { name: 'Close peek' }))
    expect(
      screen.queryByRole('dialog', { name: "Zoe's full card" }),
    ).toBeNull()
  })

  it('"Back to the homepage" navigates to /', async () => {
    renderGameOver(makeRoom(winState()))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Back to the homepage' }),
    )
    expect(await screen.findByText('Home probe')).toBeDefined()
  })
})

describe('game over screen — lose', () => {
  it('names the winner, shows their card with terms, and the rest of the table', async () => {
    renderGameOver(makeRoom(loseState()))
    expect(await screen.findByText('You Lose! 💀')).toBeDefined()
    expect(
      screen.getByText(/Zoe hit a full row across on Office Chaos/),
    ).toBeDefined()
    expect(screen.getByText('Zoe · full row across')).toBeDefined()
    // The winner's full card renders with its terms.
    const card = screen.getByRole('group', { name: "Zoe's winning card" })
    expect(card.textContent).toContain('z1')
    expect(card.textContent).toContain('z8')
    expect(card.textContent).toContain('FREE')
    // Non-winners get mini mark-boards; the winner does not appear there.
    expect(screen.getByRole('button', { name: "Ruth's board" })).toBeDefined()
    expect(screen.getByRole('button', { name: "Kai's board" })).toBeDefined()
    expect(screen.queryByRole('button', { name: "Zoe's board" })).toBeNull()
  })

  it('clicking a rest-of-table board opens their full card as a peek', async () => {
    renderGameOver(makeRoom(loseState()))
    fireEvent.click(await screen.findByRole('button', { name: "Kai's board" }))
    const peek = screen.getByRole('dialog', { name: "Kai's full card" })
    expect(peek.textContent).toContain("Kai's card")
    expect(peek.textContent).toContain('2 tiles · so close')
    expect(peek.textContent).toContain('k1')
    expect(peek.textContent).toContain('FREE')
    fireEvent.click(screen.getByRole('button', { name: 'Close peek' }))
    expect(
      screen.queryByRole('dialog', { name: "Kai's full card" }),
    ).toBeNull()
  })

  it('"Run it back" calls room.rematch and surfaces a returned error', async () => {
    const room = makeRoom(loseState())
    room.rematch.mockResolvedValue('Table is gone.')
    renderGameOver(room)
    fireEvent.click(await screen.findByRole('button', { name: 'Run it back 🔁' }))
    expect(room.rematch).toHaveBeenCalledTimes(1)
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Table is gone.',
    )
  })

  it('"Return to the homepage" navigates to /', async () => {
    renderGameOver(makeRoom(loseState()))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Return to the homepage' }),
    )
    expect(await screen.findByText('Home probe')).toBeDefined()
  })
})
