import { useState, type FormEvent } from 'react'
import { PLAYER_NAME_MAX } from '@bingus/shared'
import { ApiError } from '../lib/api'
import { useSession } from '../lib/session'
import styles from './SignInPage.module.css'

// Background candy — static equivalent of the mockup's seeded float field.
const FLOATS = [
  { left: 8, top: 12, s: 30, color: '#ff8a00', round: true, r: -12, dur: 4.5, delay: -1.2 },
  { left: 88, top: 9, s: 22, color: '#ff3d8f', round: false, r: 14, dur: 5.6, delay: -3.1 },
  { left: 16, top: 74, s: 26, color: '#ffd43b', round: false, r: -6, dur: 6.2, delay: -0.4 },
  { left: 78, top: 80, s: 34, color: '#a78bfa', round: true, r: 8, dur: 4.9, delay: -2.6 },
  { left: 5, top: 44, s: 18, color: '#4dd8e6', round: false, r: 18, dur: 5.2, delay: -4.0 },
  { left: 93, top: 47, s: 24, color: '#a3e635', round: true, r: -16, dur: 6.4, delay: -1.8 },
  { left: 30, top: 6, s: 16, color: '#4dd8e6', round: true, r: 4, dur: 5.8, delay: -2.2 },
  { left: 64, top: 90, s: 20, color: '#ff8a00', round: false, r: -10, dur: 4.6, delay: -3.6 },
  { left: 42, top: 88, s: 15, color: '#ff3d8f', round: true, r: 12, dur: 6.0, delay: -0.9 },
  { left: 70, top: 5, s: 27, color: '#ffd43b', round: true, r: -4, dur: 5.4, delay: -4.4 },
]

export function SignInPage() {
  const { logIn } = useSession()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await logIn(name, password)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Something broke. Try again in a second.',
      )
    } finally {
      setPending(false)
    }
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
          } as React.CSSProperties}
        />
      ))}
      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.badge}>MULTIPLAYER BINGO</div>
        <div className={styles.logoRow}>
          <div className={styles.logoDot} />
          <h1 className={styles.wordmark}>Bingus</h1>
        </div>
        <p className={styles.tagline}>Bingo with friends. And trash talk.</p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="player-name">
            YOUR NAME
          </label>
          <input
            id="player-name"
            className={styles.input}
            placeholder="e.g. TileSlayer"
            value={name}
            maxLength={PLAYER_NAME_MAX}
            autoFocus
            autoComplete="username"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="player-password">
            CODE OR PASSWORD
          </label>
          <input
            id="player-password"
            className={styles.input}
            type="password"
            placeholder="Your password (or a fresh code)"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? (
            <div className={styles.error} role="alert">
              {error}
            </div>
          ) : (
            <div className={styles.hint}>No account? Bug the host for a code.</div>
          )}
        </div>
        <button className={styles.submit} type="submit" disabled={pending}>
          Let's play <span className={styles.arrow}>→</span>
        </button>
      </form>
    </div>
  )
}
