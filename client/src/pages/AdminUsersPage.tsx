import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { PLAYER_NAME_MAX, type AdminPlayer } from '@bingus/shared'
import { AppHeader } from '../components/AppHeader'
import { ApiError, listPlayers, provisionPlayer, reissueCode } from '../lib/api'
import styles from './AdminUsersPage.module.css'

// Admin-only: provision accounts and rescue locked-out friends. The server
// enforces admin on every endpoint used here; the route itself only renders
// for admins (see App.tsx). One-time codes appear exactly once — copy them
// before doing anything else.

interface IssuedCode {
  playerName: string
  code: string
}

export function AdminUsersPage() {
  const [roster, setRoster] = useState<AdminPlayer[] | null>(null)
  const [name, setName] = useState('')
  const [issued, setIssued] = useState<IssuedCode | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const refresh = useCallback(() => {
    listPlayers()
      .then((res) => setRoster(res.players))
      .catch(() => setRoster([]))
  }, [])

  useEffect(refresh, [refresh])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const res = await provisionPlayer(name)
      setIssued({ playerName: res.player.name, code: res.oneTimeCode })
      setCopied(false)
      setName('')
      refresh()
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

  async function handleReissue(player: AdminPlayer) {
    const sure = window.confirm(
      `Re-issue a code for ${player.name}? Their current password (and any active session) stops working immediately.`,
    )
    if (!sure) return
    setError(null)
    try {
      const res = await reissueCode(player.id)
      setIssued({ playerName: player.name, code: res.oneTimeCode })
      setCopied(false)
      refresh()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Something broke. Try again in a second.',
      )
    }
  }

  async function handleCopy() {
    if (!issued) return
    await navigator.clipboard.writeText(issued.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <AppHeader />
      <main className={styles.main}>
        <h1 className={styles.title}>Player accounts</h1>
        <p className={styles.subtitle}>
          Make an account, hand over the code, let them pick a password.
        </p>

        <form className={styles.createCard} onSubmit={handleCreate}>
          <label className={styles.label} htmlFor="new-player-name">
            NEW PLAYER'S NAME
          </label>
          <div className={styles.createRow}>
            <input
              id="new-player-name"
              className={styles.input}
              placeholder="e.g. TileSlayer"
              value={name}
              maxLength={PLAYER_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
            />
            <button className={styles.create} type="submit" disabled={pending}>
              Create player
            </button>
          </div>
          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
        </form>

        {issued && (
          <div className={styles.codeCard} role="status">
            <div className={styles.codeHeading}>
              One-time code for {issued.playerName}
            </div>
            <div className={styles.codeRow}>
              <code className={styles.code}>{issued.code}</code>
              <button className={styles.copy} type="button" onClick={handleCopy}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className={styles.codeWarning}>
              Shown once — send it to them now. They log in with it as their
              password, then set their own.
            </div>
          </div>
        )}

        <h2 className={styles.rosterTitle}>Roster</h2>
        {roster === null ? (
          <p className={styles.empty}>Pulling up the roster…</p>
        ) : roster.length === 0 ? (
          <p className={styles.empty}>Nobody here yet.</p>
        ) : (
          <ul className={styles.roster}>
            {roster.map((p) => (
              <li key={p.id} className={styles.row}>
                <span className={styles.rowName}>{p.name}</span>
                {p.isAdmin && <span className={styles.adminBadge}>ADMIN</span>}
                {p.needsPasswordReset && (
                  <span className={styles.needsBadge}>NEEDS CODE</span>
                )}
                <button
                  className={styles.reissue}
                  type="button"
                  onClick={() => handleReissue(p)}
                >
                  Re-issue code
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
