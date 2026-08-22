import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router'
import {
  freeIndex,
  type BoardSize,
  type GamePlayer,
  type GameState,
  type GameWinner,
  type WinPattern,
} from '@bingus/shared'
import type { GameRoomView } from '../lib/gameRoom'
import { useSession } from '../lib/session'
import styles from './GameOverPage.module.css'

// Mockups 1i (win) + 1h (lose) — the full-art end screens. GameRoute sends
// finished games here. "Run it back" asks the server for a rematch; on
// success the table resets and the next state broadcast flips every client
// back to the lobby, so this screen just waits for GameRoute to swap.

// Candy accents for avatars + mini boards — same id-hash as the gameplay
// screen so a player keeps their color across screens.
const ACCENTS = ['#FFD43B', '#A3E635', '#FF8FC1', '#7DD3FC', '#C89BF5', '#FFA94D']

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

function accentFor(id: string): string {
  return ACCENTS[hashId(id) % ACCENTS.length]
}

const WIN_BADGE: Record<WinPattern, string> = {
  row: 'ROW, BABY',
  column: 'COLUMN, BABY',
  diagonal: 'DIAGONAL, BABY',
  blackout: 'TOTAL BLACKOUT',
}

const WIN_PHRASE: Record<WinPattern, string> = {
  row: 'full row across',
  column: 'column crunch',
  diagonal: 'clean diagonal',
  blackout: 'full blackout',
}

// Static layouts for the celebration garnish — deterministic so render stays
// pure (no Math.random / Date.now).
const CONFETTI_COLORS = ['#FF8A00', '#FF3D8F', '#FFD43B', '#A78BFA', '#4DD8E6', '#A3E635']

const CONFETTI = Array.from({ length: 40 }, (_, i) => ({
  left: (i * 83) % 100,
  delay: -(((i * 37) % 26) / 10),
  duration: 2.6 + ((i * 53) % 14) / 10,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
}))

const MINI_CONFETTI = Array.from({ length: 16 }, (_, i) => ({
  left: (i * 61) % 100,
  delay: -(((i * 41) % 22) / 10),
  duration: 2.2 + ((i * 29) % 12) / 10,
  color: CONFETTI_COLORS[(i * 5 + 1) % CONFETTI_COLORS.length],
}))

// Background candy for the win screen — static equivalent of the mockup's
// seeded float field (same shapes as the sign-in screen).
const FLOATS = [
  { left: 8, top: 12, s: 30, color: '#ff8a00', round: true, r: -12, dur: 4.5, delay: -1.2 },
  { left: 88, top: 9, s: 22, color: '#ff3d8f', round: false, r: 14, dur: 5.6, delay: -3.1 },
  { left: 16, top: 74, s: 26, color: '#ffd43b', round: false, r: -6, dur: 6.2, delay: -0.4 },
  { left: 78, top: 80, s: 34, color: '#a78bfa', round: true, r: 8, dur: 4.9, delay: -2.6 },
  { left: 5, top: 44, s: 18, color: '#4dd8e6', round: false, r: 18, dur: 5.2, delay: -4.0 },
  { left: 93, top: 47, s: 24, color: '#a3e635', round: true, r: -16, dur: 6.4, delay: -1.8 },
  { left: 30, top: 6, s: 16, color: '#4dd8e6', round: true, r: 4, dur: 5.8, delay: -2.2 },
  { left: 64, top: 90, s: 20, color: '#ff8a00', round: false, r: -10, dur: 4.6, delay: -3.6 },
]

// Cells run 0..size²-1 with the FREE tile at freeIndex(size); the card array
// omits FREE, so terms after it shift down by one.
function cellTerm(gp: GamePlayer, cell: number, free: number): string {
  return gp.card[cell < free ? cell : cell - 1]
}

function WinScreen({
  me,
  rest,
  size,
  winner,
  pending,
  error,
  onRematch,
  onExit,
}: {
  me: GamePlayer
  rest: GamePlayer[]
  size: BoardSize
  winner: GameWinner
  pending: boolean
  error: string | null
  onRematch: () => void
  onExit: () => void
}) {
  const free = freeIndex(size)
  const [peekId, setPeekId] = useState<string | null>(null)
  const peeked = rest.find((p) => p.player.id === peekId)
  return (
    <div className={styles.winScreen}>
      {FLOATS.map((f, i) => (
        <div
          key={i}
          className={styles.float}
          style={{
            left: `${f.left}%`,
            top: `${f.top}%`,
            width: f.s,
            height: f.s,
            background: f.color,
            borderRadius: f.round ? '50%' : 6,
            '--r': `${f.r}deg`,
            '--dur': `${f.dur}s`,
            '--delay': `${f.delay}s`,
          } as CSSProperties}
          aria-hidden
        />
      ))}
      {CONFETTI.map((c, i) => (
        <span
          key={i}
          className={styles.confetti}
          style={{
            left: `${c.left}%`,
            background: c.color,
            animationDelay: `${c.delay}s`,
            animationDuration: `${c.duration}s`,
          }}
          aria-hidden
        />
      ))}
      <div className={styles.winColumn}>
        <span className={styles.winBadge}>{WIN_BADGE[winner.pattern]}</span>
        <h1 className={styles.bingo}>BINGO!</h1>
        <p className={styles.winSub}>
          {me.player.name} wins. Crowd goes wild.{' '}
          <span className={styles.winSubFaint}>
            (Try to be humble about it.)
          </span>
        </p>
        <div
          className={styles.winCard}
          role="group"
          aria-label="Your winning card"
          style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
        >
          {Array.from({ length: size * size }, (_, cell) => {
            const isFree = cell === free
            const marked = isFree || me.marks.includes(cell)
            const classes = [
              styles.winTile,
              marked && !isFree && styles.winTileMarked,
              isFree && styles.winTileFree,
              winner.line.includes(cell) && styles.tileRing,
            ]
            return (
              <span key={cell} className={classes.filter(Boolean).join(' ')} />
            )
          })}
        </div>
        {rest.length > 0 && (
          <aside className={styles.winRest}>
            <p className={styles.restLabel}>THE REST OF THE TABLE</p>
            <div className={styles.winRestGrid}>
              {rest.map((gp) => (
                <RestBoard
                  key={gp.player.id}
                  gp={gp}
                  size={size}
                  onPeek={() => setPeekId(gp.player.id)}
                />
              ))}
            </div>
            <p className={styles.restHint}>
              click any board to see every cell
            </p>
          </aside>
        )}
        <div className={styles.actions}>
          <button
            className={styles.ctaPrimary}
            type="button"
            disabled={pending}
            onClick={onRematch}
          >
            Run it back 🔁
          </button>
          <button className={styles.ctaGhost} type="button" onClick={onExit}>
            Back to the homepage
          </button>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
      {peeked && (
        <PeekCard
          gp={peeked}
          size={size}
          onClose={() => setPeekId(null)}
        />
      )}
    </div>
  )
}

function RestBoard({
  gp,
  size,
  onPeek,
}: {
  gp: GamePlayer
  size: BoardSize
  onPeek: () => void
}) {
  const free = freeIndex(size)
  const accent = accentFor(gp.player.id)
  return (
    <button
      className={styles.restPlayer}
      type="button"
      aria-label={`${gp.player.name}'s board`}
      onClick={onPeek}
    >
      <span
        className={styles.restBoard}
        style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
        aria-hidden
      >
        {Array.from({ length: size * size }, (_, cell) => (
          <span
            key={cell}
            className={styles.restCell}
            style={{
              background:
                cell === free || gp.marks.includes(cell) ? accent : '#F1E9F4',
            }}
          />
        ))}
      </span>
      <span className={styles.restName}>
        <span className={styles.avatar} style={{ background: accent }}>
          {gp.player.name[0]?.toUpperCase()}
        </span>
        {gp.player.name}
      </span>
    </button>
  )
}

// Full-cell view of a rival's card, opened by clicking their mini board.
function PeekCard({
  gp,
  size,
  onClose,
}: {
  gp: GamePlayer
  size: BoardSize
  onClose: () => void
}) {
  const free = freeIndex(size)
  const accent = accentFor(gp.player.id)
  const tiles = gp.marks.length + 1 // FREE rides along
  return (
    <div className={styles.peekBackdrop} onClick={onClose}>
      <div
        className={styles.peekCard}
        role="dialog"
        aria-label={`${gp.player.name}'s full card`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.peekHead}>
          <span className={styles.avatar} style={{ background: accent }}>
            {gp.player.name[0]?.toUpperCase()}
          </span>
          <div>
            <p className={styles.peekTitle}>{gp.player.name}'s card</p>
            <p className={styles.peekSub}>
              {tiles} tile{tiles === 1 ? '' : 's'} · so close
            </p>
          </div>
          <button
            className={styles.peekClose}
            type="button"
            aria-label="Close peek"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div
          className={styles.peekGrid}
          style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
        >
          {Array.from({ length: size * size }, (_, cell) => {
            const isFree = cell === free
            const marked = isFree || gp.marks.includes(cell)
            return (
              <span
                key={cell}
                className={[
                  styles.peekCell,
                  isFree && styles.peekCellFree,
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={
                  marked && !isFree ? { background: accent } : undefined
                }
              >
                {isFree ? 'FREE' : cellTerm(gp, cell, free)}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function LoseScreen({
  state,
  winner,
  winnerSeat,
  pending,
  error,
  onRematch,
  onExit,
}: {
  state: GameState
  winner: GameWinner
  winnerSeat: GamePlayer
  pending: boolean
  error: string | null
  onRematch: () => void
  onExit: () => void
}) {
  const size = state.board.size
  const free = freeIndex(size)
  const winnerName = winnerSeat.player.name
  const accent = accentFor(winnerSeat.player.id)
  const rest = state.players.filter((p) => p.player.id !== winner.playerId)
  const [peekId, setPeekId] = useState<string | null>(null)
  const peeked = rest.find((p) => p.player.id === peekId)
  return (
    <div className={styles.loseScreen}>
      <div className={styles.loseInner}>
        <p className={styles.eyebrow}>
          GAME OVER — {winnerName.toUpperCase()} HIT BINGO
        </p>
        <div className={styles.loseGrid}>
          <section>
            <div className={styles.winnerWrap}>
              <span className={styles.ribbon}>
                BINGO! 👑 {winnerName.toUpperCase()}'S BOARD
              </span>
              <div
                className={styles.winnerCard}
                role="group"
                aria-label={`${winnerName}'s winning card`}
              >
                {MINI_CONFETTI.map((c, i) => (
                  <span
                    key={i}
                    className={styles.miniConfetti}
                    style={{
                      left: `${c.left}%`,
                      background: c.color,
                      animationDelay: `${c.delay}s`,
                      animationDuration: `${c.duration}s`,
                    }}
                    aria-hidden
                  />
                ))}
                <div
                  className={styles.winnerGrid}
                  style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
                >
                  {Array.from({ length: size * size }, (_, cell) => {
                    const isFree = cell === free
                    const marked = isFree || winnerSeat.marks.includes(cell)
                    const inLine = winner.line.includes(cell)
                    const classes = [
                      styles.winnerCell,
                      isFree && !inLine && styles.winnerCellFree,
                      inLine && styles.winnerCellLine,
                    ]
                    return (
                      <span
                        key={cell}
                        className={classes.filter(Boolean).join(' ')}
                        style={
                          marked && !isFree && !inLine
                            ? { background: accent }
                            : undefined
                        }
                      >
                        {isFree ? 'FREE' : cellTerm(winnerSeat, cell, free)}
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>
            <p className={styles.winnerLine}>
              {winnerName} · {WIN_PHRASE[winner.pattern]}
            </p>
            <p className={styles.restHint}>
              click any board to see every cell — the winner's is already open
            </p>
          </section>
          <section>
            <p className={styles.restLabel}>THE REST OF THE TABLE</p>
            <div className={styles.restGrid}>
              {rest.map((gp) => (
                <RestBoard
                  key={gp.player.id}
                  gp={gp}
                  size={size}
                  onPeek={() => setPeekId(gp.player.id)}
                />
              ))}
            </div>
            <div className={styles.loseCard}>
              <h1 className={styles.loseTitle}>You Lose! 💀</h1>
              <p className={styles.loseSub}>
                {winnerName} hit a {WIN_PHRASE[winner.pattern]} on{' '}
                {state.board.name}. The center square carried them — everyone
                knows it.
              </p>
              <div className={styles.loseActions}>
                <button
                  className={styles.ctaPrimaryDark}
                  type="button"
                  disabled={pending}
                  onClick={onRematch}
                >
                  Run it back 🔁
                </button>
                <button
                  className={styles.ctaGhostDark}
                  type="button"
                  onClick={onExit}
                >
                  Return to the homepage
                </button>
              </div>
              {error && (
                <p className={styles.errorDark} role="alert">
                  {error}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
      {peeked && (
        <PeekCard
          gp={peeked}
          size={size}
          onClose={() => setPeekId(null)}
        />
      )}
    </div>
  )
}

export function GameOverPage({ room }: { room: GameRoomView }) {
  const navigate = useNavigate()
  const { player } = useSession()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!player) return null
  const { state } = room
  const winner = state.winner
  const winnerSeat = winner
    ? state.players.find((p) => p.player.id === winner.playerId)
    : undefined
  const me = state.players.find((p) => p.player.id === player.id)
  if (!winner || !winnerSeat || !me) return null

  async function handleRematch() {
    setPending(true)
    setError(null)
    // On success the server broadcast flips everyone back to the lobby and
    // GameRoute swaps screens — nothing more to do here.
    const err = await room.rematch()
    if (err) setError(err)
    setPending(false)
  }

  const onExit = () => navigate('/')

  return winner.playerId === player.id ? (
    <WinScreen
      me={me}
      rest={state.players.filter((p) => p.player.id !== player.id)}
      size={state.board.size}
      winner={winner}
      pending={pending}
      error={error}
      onRematch={handleRematch}
      onExit={onExit}
    />
  ) : (
    <LoseScreen
      state={state}
      winner={winner}
      winnerSeat={winnerSeat}
      pending={pending}
      error={error}
      onRematch={handleRematch}
      onExit={onExit}
    />
  )
}
