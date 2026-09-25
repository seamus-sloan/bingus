import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, GamePlayer, GameState } from '@bingus/shared'
import type { GameRoomView } from '../lib/gameRoom'
import { SessionProvider, useSession } from '../lib/session'
import { playBubble, unlockAudio } from '../lib/sounds'
import { GamePlayPage } from './GamePlayPage'

vi.mock('../lib/sounds', () => ({
  playPop: vi.fn(),
  playBubble: vi.fn(),
  unlockAudio: vi.fn(),
}))

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

// Mirrors Screens() in App.tsx, which withholds every route while the
// session is still loading — GamePlayPage never mounts without a player.
function GameScreen({ room }: { room: GameRoomView }) {
  const { player } = useSession()
  if (!player) return null
  return <GamePlayPage room={room} />
}

function gameTree(room: GameRoomView) {
  return (
    <MemoryRouter initialEntries={['/game/BNGS-421']}>
      <SessionProvider>
        <Routes>
          <Route path="/game/:code" element={<GameScreen room={room} />} />
          <Route path="/boards" element={<h2>Archive probe</h2>} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>
  )
}

async function renderGame(room: GameRoomView) {
  stubMe()
  render(gameTree(room))
  // The page renders once the session resolves.
  return within(await screen.findByRole('group', { name: 'Your card' }))
}

function chatFrom(id: string, name: string, text: string): ChatMessage {
  return { player: { id, name }, text, at: '2026-08-22T00:00:00.000Z' }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
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

  // Finished games render GameOverPage (see GameRoute), but the guard keeps
  // a stray click harmless during the state flip.
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

describe('chat sound', () => {
  const backlog = [chatFrom('p2', 'Zoe', 'get rekt')]

  // Renders a table with a join backlog, then returns a way to deliver the
  // next chat array the way a socket broadcast would.
  async function renderWithChat(chat: ChatMessage[]) {
    stubMe()
    const room = makeRoom(makeState(), chat)
    const { rerender } = render(gameTree(room))
    await screen.findByRole('group', { name: 'Your card' })
    return (next: ChatMessage[]) => rerender(gameTree({ ...room, chat: next }))
  }

  it('wakes audio on mount and again on the first tap or keypress', async () => {
    await renderGame(makeRoom(makeState()))
    expect(unlockAudio).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(window)
    fireEvent.pointerUp(window)
    expect(unlockAudio).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(window)
    expect(unlockAudio).toHaveBeenCalledTimes(3)
  })

  it('bubbles when a rival speaks, but not for the join backlog', async () => {
    const deliver = await renderWithChat(backlog)
    expect(playBubble).not.toHaveBeenCalled()
    deliver([...backlog, chatFrom('p2', 'Zoe', 'bingo soon')])
    expect(playBubble).toHaveBeenCalledTimes(1)
  })

  it('stays quiet for my own messages', async () => {
    const deliver = await renderWithChat(backlog)
    deliver([...backlog, chatFrom('p1', 'Ruth', 'nice one')])
    expect(playBubble).not.toHaveBeenCalled()
  })

  it('stays quiet with sound off', async () => {
    const deliver = await renderWithChat(backlog)
    fireEvent.click(screen.getByRole('button', { name: /sound on/i }))
    deliver([...backlog, chatFrom('p2', 'Zoe', 'bingo soon')])
    expect(playBubble).not.toHaveBeenCalled()
  })

  it('a reconnect with a shorter backlog stays quiet, then bubbles for the next rival message', async () => {
    const longBacklog = [
      chatFrom('p2', 'Zoe', 'get rekt'),
      chatFrom('p1', 'Ruth', 'never'),
      chatFrom('p2', 'Zoe', 'watch this'),
    ]
    const deliver = await renderWithChat(longBacklog)
    // The server caps its backlog at 100; a reconnect can hand back a
    // shorter array than what we already rendered. That shouldn't bloop.
    const rejoinBacklog = longBacklog.slice(1)
    deliver(rejoinBacklog)
    expect(playBubble).not.toHaveBeenCalled()
    deliver([...rejoinBacklog, chatFrom('p2', 'Zoe', 'bingo soon')])
    expect(playBubble).toHaveBeenCalledTimes(1)
  })
})
