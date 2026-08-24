import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { PLAYER_NAME_MAX } from '@bingus/shared'
import { ApiError } from '../lib/api'
import { useSession } from '../lib/session'
import styles from './AppHeader.module.css'

export function AppHeader() {
  const { player, isAdmin, rename, logOut } = useSession()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (!player) return null
  const { name } = player

  function toggle() {
    setOpen((was) => !was)
    setDraft(name)
    setError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (draft.trim() === name) {
      setOpen(false)
      return
    }
    setError(null)
    setPending(true)
    try {
      await rename(draft)
      setOpen(false)
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
    <header className={styles.header}>
      <Link to="/" className={styles.homeLink}>
        <div className={styles.logoDot} />
        <h1 className={styles.wordmark}>Bingus</h1>
      </Link>
      <div className={styles.profileWrap}>
        {isAdmin && (
          <Link to="/admin/users" className={styles.adminLink}>
            Admin
          </Link>
        )}
        <button
          type="button"
          className={styles.chip}
          aria-expanded={open}
          onClick={toggle}
        >
          <span className={styles.avatar}>{name[0]?.toUpperCase()}</span>
          {name}
        </button>
        {open && (
          <form className={styles.popover} onSubmit={handleSubmit}>
            <label className={styles.popLabel} htmlFor="rename-input">
              CHANGE YOUR NAME
            </label>
            <input
              id="rename-input"
              className={styles.popInput}
              value={draft}
              maxLength={PLAYER_NAME_MAX}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
            />
            {error && (
              <div className={styles.popError} role="alert">
                {error}
              </div>
            )}
            <div className={styles.popActions}>
              <button className={styles.save} type="submit" disabled={pending}>
                Save
              </button>
              <button className={styles.cancel} type="button" onClick={toggle}>
                Cancel
              </button>
            </div>
            <button
              className={styles.logout}
              type="button"
              onClick={() => void logOut()}
            >
              Log out
            </button>
          </form>
        )}
      </div>
    </header>
  )
}
