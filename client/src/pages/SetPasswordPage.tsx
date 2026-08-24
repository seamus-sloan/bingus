import { useState, type FormEvent } from 'react'
import { PASSWORD_MIN } from '@bingus/shared'
import { ApiError } from '../lib/api'
import { useSession } from '../lib/session'
import styles from './SetPasswordPage.module.css'

// The forced stop after a first login with a one-time code. Rendered by the
// session gate in App.tsx whenever needsPasswordReset is set — there is no
// route to it and no way around it (the server 403s everything else anyway).
export function SetPasswordPage() {
  const { player, setPassword } = useSession()
  const [password, setDraft] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < PASSWORD_MIN) {
      setError(`At least ${PASSWORD_MIN} characters.`)
      return
    }
    if (password !== confirm) {
      setError("Those don't match. Try again.")
      return
    }
    setError(null)
    setPending(true)
    try {
      await setPassword(password)
      // Success flips the session state; the gate in App.tsx re-renders into
      // the app — nothing to navigate here.
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Something broke. Try again in a second.',
      )
      setPending(false)
    }
  }

  return (
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.badge}>ONE LAST THING</div>
        <h1 className={styles.heading}>
          Hey {player?.name ?? 'you'} — pick a password
        </h1>
        <p className={styles.tagline}>
          That code was a one-timer. Set a real password and it's game on.
        </p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="new-password">
            NEW PASSWORD
          </label>
          <input
            id="new-password"
            className={styles.input}
            type="password"
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="confirm-password">
            SAY IT AGAIN
          </label>
          <input
            id="confirm-password"
            className={styles.input}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {error ? (
            <div className={styles.error} role="alert">
              {error}
            </div>
          ) : (
            <div className={styles.hint}>
              At least {PASSWORD_MIN} characters. Make it memorable.
            </div>
          )}
        </div>
        <button className={styles.submit} type="submit" disabled={pending}>
          Lock it in <span className={styles.arrow}>→</span>
        </button>
      </form>
    </div>
  )
}
