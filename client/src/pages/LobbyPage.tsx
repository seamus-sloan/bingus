import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { GameRoomView } from '../lib/gameRoom'
import { useSession } from '../lib/session'
import styles from './LobbyPage.module.css'

// Background candy — static equivalent of the mockup's seeded float field.
const FLOATS = [
  { left: 7, top: 14, s: 28, color: '#ff8a00', round: true, r: -10, dur: 4.8, delay: -1.4 },
  { left: 90, top: 11, s: 22, color: '#ff3d8f', round: false, r: 12, dur: 5.5, delay: -2.9 },
  { left: 13, top: 78, s: 26, color: '#ffd43b', round: false, r: -8, dur: 6.1, delay: -0.6 },
  { left: 82, top: 82, s: 32, color: '#a78bfa', round: true, r: 6, dur: 5.0, delay: -2.2 },
  { left: 4, top: 45, s: 18, color: '#4dd8e6', round: false, r: 16, dur: 5.3, delay: -3.8 },
  { left: 94, top: 50, s: 24, color: '#a3e635', round: true, r: -14, dur: 6.3, delay: -1.7 },
  { left: 48, top: 6, s: 16, color: '#4dd8e6', round: true, r: 5, dur: 5.7, delay: -3.2 },
]

// Guests get a stable candy color hashed from their id; the host is always pink.
const AVATAR_COLORS = ['#ff8a00', '#ffd43b', '#a3e635', '#4dd8e6', '#a78bfa', '#ffa8c5']

function avatarColor(playerId: string, isHost: boolean): string {
  if (isHost) return '#ff3d8f'
  let hash = 0
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export function LobbyPage({ room }: { room: GameRoomView }) {
  const { player: me } = useSession()
  const { code, board, players } = room.state
  const host = players.find((p) => p.isHost)
  const amHost = me !== null && host?.player.id === me.id
  const [startError, setStartError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    [],
  )

  async function handleStart() {
    setStartError(null)
    const error = await room.start()
    if (error) setStartError(error)
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/game/${code}`)
    } catch {
      return
    }
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 2000)
  }

  // Letters before the dash ride yellow, the dash cream, digits white.
  const dashIndex = code.indexOf('-')
  function tileClass(char: string, index: number): string {
    if (char === '-') return `${styles.tile} ${styles.tileDash}`
    if (index < dashIndex) return `${styles.tile} ${styles.tileLetter}`
    return styles.tile
  }

  return (
    <div className={styles.screen}>
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
        />
      ))}
      <main className={styles.card}>
        <div className={styles.liveBadge}>
          <span className={styles.liveDot} />
          TABLE IS LIVE
        </div>
        <h1 className={styles.title}>{board.name}</h1>
        <p className={styles.subline}>
          {board.size}×{board.size} · row, column, diagonal or blackout wins ·
          boards shuffle per player
        </p>
        <div className={styles.codeRow} role="group" aria-label={`Join code ${code}`}>
          {[...code].map((char, i) => (
            <span key={i} className={tileClass(char, i)}>
              {char}
            </span>
          ))}
        </div>
        <div className={styles.players}>
          {players.map((p) => (
            <span
              key={p.player.id}
              className={
                p.connected ? styles.chip : `${styles.chip} ${styles.chipOffline}`
              }
            >
              <span
                className={styles.avatar}
                style={{ background: avatarColor(p.player.id, p.isHost) }}
                aria-hidden="true"
              >
                {p.player.name.charAt(0).toUpperCase()}
              </span>
              <span className={styles.chipName}>{p.player.name}</span>
              {p.isHost ? <span className={styles.hostTag}>HOST</span> : null}
            </span>
          ))}
          <span className={styles.waitingChip}>waiting for victims…</span>
        </div>
        <div className={styles.buttons}>
          {amHost ? (
            <button type="button" className={styles.startBtn} onClick={handleStart}>
              Start the game <span className={styles.arrow}>→</span>
            </button>
          ) : (
            <p className={styles.hostWait}>
              waiting for {host?.player.name ?? 'the host'} to start the game…
            </p>
          )}
          <button type="button" className={styles.copyBtn} onClick={handleCopy}>
            {copied ? 'Copied! Now recruit ✓' : 'Copy invite link'}
          </button>
        </div>
        {startError ? (
          <p className={styles.error} role="alert">
            {startError}
          </p>
        ) : null}
      </main>
    </div>
  )
}
