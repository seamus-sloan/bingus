import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Player } from '@bingus/shared'
import { createPlayer, getMe, renameMe } from './api'

// Identity rides in an httpOnly session cookie owned by the server. On load
// we ask /api/me who we are — if the cookie is missing or points at a player
// that no longer exists (a ghost session), the server 401s and we land on
// the sign-in screen. Client code never sees the token.

type SessionState =
  | { status: 'loading'; player: null }
  | { status: 'signed-out'; player: null }
  | { status: 'signed-in'; player: Player }

interface SessionContextValue {
  status: SessionState['status']
  player: Player | null
  signIn: (name: string) => Promise<void>
  rename: (name: string) => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    status: 'loading',
    player: null,
  })

  useEffect(() => {
    // Pre-cookie builds kept the session in localStorage — clear the leftover.
    localStorage.removeItem('bingus.session')
    let cancelled = false
    getMe()
      .then((res) => {
        if (cancelled) return
        setState(
          res
            ? { status: 'signed-in', player: res.player }
            : { status: 'signed-out', player: null },
        )
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'signed-out', player: null })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (name: string) => {
    const { player } = await createPlayer(name)
    setState({ status: 'signed-in', player })
  }, [])

  const rename = useCallback(async (name: string) => {
    const { player } = await renameMe(name)
    setState({ status: 'signed-in', player })
  }, [])

  return (
    <SessionContext.Provider
      value={{ status: state.status, player: state.player, signIn, rename }}
    >
      {children}
    </SessionContext.Provider>
  )
}

// oxlint-disable-next-line react/only-export-components -- provider + hook belong together
export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
