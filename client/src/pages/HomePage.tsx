import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import type { StatsResponse } from '@bingus/shared'
import { AppHeader } from '../components/AppHeader'
import { getStats } from '../lib/api'
import { useSession } from '../lib/session'
import styles from './HomePage.module.css'

// Mockup 1b — start a new game or join one. The two CTAs lead to the board
// picker (1c) and live tables (1e).
export function HomePage() {
  const { player } = useSession()
  const navigate = useNavigate()
  const [stats, setStats] = useState<StatsResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    getStats()
      .then((s) => {
        if (!cancelled) setStats(s)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const live = stats?.liveGames ?? 0

  return (
    <>
      <AppHeader />
      <main className={styles.main}>
        <h2 className={styles.title}>Game on, {player?.name}.</h2>
        <p className={styles.subtitle}>Pick your poison.</p>
        <div className={styles.cards}>
          <section className={styles.newCard}>
            <div className={styles.star} aria-hidden>
              ★
            </div>
            <h3 className={styles.cardTitle}>
              Start a<br />
              new game
            </h3>
            <p className={styles.newCopy}>
              Pick a board from the archive or print a fresh one. Then watch
              them crumble.
            </p>
            <button
              className={styles.newCta}
              type="button"
              onClick={() => navigate('/boards')}
            >
              Let's go →
            </button>
          </section>
          <section className={styles.joinCard}>
            {live > 0 && (
              <div className={styles.liveBadge}>
                <span className={styles.pulseDot} />
                {live} LIVE
              </div>
            )}
            <h3 className={styles.cardTitle}>
              Join a<br />
              game
            </h3>
            <p className={styles.joinCopy}>
              {live > 0
                ? `${live === 1 ? 'One table is' : `${live} tables are`} playing right now. Go ruin someone's streak.`
                : 'No live tables right now. Start one and lure them in.'}
            </p>
            <button
              className={styles.joinCta}
              type="button"
              onClick={() => navigate('/join')}
            >
              See live tables →
            </button>
          </section>
        </div>
        <div className={styles.stats}>
          {stats ? (
            <>
              <span>
                {stats.boards} board{stats.boards === 1 ? '' : 's'} in the
                archive
              </span>
              <span>·</span>
              <span>
                {stats.players} player{stats.players === 1 ? '' : 's'} signed
                up
              </span>
              <span>·</span>
              <span>
                {live} game{live === 1 ? '' : 's'} live right now
              </span>
            </>
          ) : (
            <span>counting the chaos…</span>
          )}
        </div>
      </main>
    </>
  )
}
