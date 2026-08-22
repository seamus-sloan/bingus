import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { GAME_MAX_PLAYERS, type GameSummary } from '@bingus/shared'
import { AppHeader } from '../components/AppHeader'
import { listGames } from '../lib/api'
import styles from './JoinGamesPage.module.css'

// Mockup 1e — the live tables. Every joinable game gets a row; joining is
// just navigating to /game/:code (the game route seats you). The list polls
// every 5s (and on window focus) so it actually updates live.

const POLL_MS = 5000
const FILLING_FAST_WINDOW_MS = 5 * 60 * 1000
const AVATAR_LIMIT = 3

// Candy accents for size badges + avatars, hashed from the game code /
// player name so a table always looks the same without any styling
// server-side (same trick as the board archive).
const CANDY = ['#FFD43B', '#A3E635', '#FF8FC1', '#7DD3FC', '#C89BF5', '#FFA94D']

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function candyFor(s: string): string {
  return CANDY[hashString(s) % CANDY.length]
}

// Per-row display data, judged when the API response lands (render must stay
// pure — no clock reads there).
interface GameRow {
  game: GameSummary
  phase: string
  fillingFast: boolean
}

function toRow(game: GameSummary, now: number): GameRow {
  const startedAgoMs =
    game.startedAt === null ? null : now - Date.parse(game.startedAt)
  let phase = 'waiting for players'
  if (startedAgoMs !== null) {
    const mins = Math.floor(startedAgoMs / 60_000)
    if (mins < 1) phase = 'started just now'
    else if (mins < 60) phase = `started ${mins} min ago`
    else phase = `started ${Math.floor(mins / 60)} hr ago`
  }
  const fillingFast =
    (startedAgoMs !== null && startedAgoMs < FILLING_FAST_WINDOW_MS) ||
    game.playerNames.length >= GAME_MAX_PLAYERS / 2
  return { game, phase, fillingFast }
}

function GameRowCard({
  row,
  onJoin,
}: {
  row: GameRow
  onJoin: () => void
}) {
  const { game, phase, fillingFast } = row
  const shown = game.playerNames.slice(0, AVATAR_LIMIT)
  const extra = game.playerNames.length - shown.length
  return (
    <li className={styles.row}>
      <span
        className={styles.sizeBadge}
        style={{ background: candyFor(game.code) }}
      >
        {game.size}×{game.size}
      </span>
      <div className={styles.info}>
        <div className={styles.nameRow}>
          <h3 className={styles.boardName}>{game.boardName}</h3>
          {fillingFast && (
            <span className={styles.fillingPill}>🔥 FILLING FAST</span>
          )}
        </div>
        <p className={styles.hostLine}>
          hosted by {game.hostName} · {phase}
        </p>
      </div>
      <div className={styles.seats}>
        <div className={styles.avatars}>
          {shown.map((name) => (
            <span
              key={name}
              className={styles.avatar}
              style={{ background: candyFor(name) }}
              title={name}
            >
              {name[0]?.toUpperCase()}
            </span>
          ))}
          {extra > 0 && (
            <span className={`${styles.avatar} ${styles.avatarMore}`}>
              +{extra}
            </span>
          )}
        </div>
        <span className={styles.count}>
          {game.playerNames.length} / {GAME_MAX_PLAYERS}
        </span>
        <button
          className={styles.joinCta}
          type="button"
          aria-label={`Join ${game.boardName}`}
          onClick={onJoin}
        >
          Join →
        </button>
      </div>
    </li>
  )
}

export function JoinGamesPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<GameRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    function load() {
      listGames()
        .then((res) => {
          if (cancelled) return
          const now = Date.now()
          setRows(res.games.map((game) => toRow(game, now)))
        })
        .catch(() => {})
    }
    load()
    const timer = window.setInterval(load, POLL_MS)
    window.addEventListener('focus', load)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [])

  return (
    <>
      <AppHeader />
      <main className={styles.main}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>Live tables</h2>
          <span className={styles.liveBadge}>
            <span className={styles.pulseDot} />
            UPDATING LIVE
          </span>
        </div>
        <p className={styles.subtitle}>
          Pick a table. Bring your A-game — these people show no mercy.
        </p>
        {rows !== null && rows.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyCopy}>
              No live tables right now. Go print a board and start one.
            </p>
            <button
              className={styles.archiveCta}
              type="button"
              onClick={() => navigate('/boards')}
            >
              To the archive →
            </button>
          </div>
        )}
        {rows !== null && rows.length > 0 && (
          <ul className={styles.list}>
            {rows.map((row) => (
              <GameRowCard
                key={row.game.code}
                row={row}
                onJoin={() => navigate(`/game/${row.game.code}`)}
              />
            ))}
          </ul>
        )}
        <p className={styles.footNote}>
          You'll get your own shuffled board the second you sit down. Names
          shown are live players in each game.
        </p>
      </main>
    </>
  )
}
