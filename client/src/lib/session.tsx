import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { MeResponse, Player } from '@bingus/shared'
import * as api from './api'
import { socket } from './socket'

// Identity rides in an httpOnly session cookie owned by the server. On load
// we ask /api/me who we are — if the cookie is missing or points at a player
// that no longer exists (a ghost session), the server 401s and we land on
// the login screen. Client code never sees the token.
//
// The signed-in state carries the whole MeResponse: `needsPasswordReset`
// drives the forced set-password screen, `isAdmin` unlocks the admin route.

type SessionState =
  | { status: 'loading'; me: null }
  | { status: 'signed-out'; me: null }
  | { status: 'signed-in'; me: MeResponse }

interface SessionContextValue {
  status: SessionState['status']
  player: Player | null
  needsPasswordReset: boolean
  isAdmin: boolean
  logIn: (name: string, password: string) => Promise<void>
  logOut: () => Promise<void>
  setPassword: (password: string) => Promise<void>
  rename: (name: string) => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    status: 'loading',
    me: null,
  })

  useEffect(() => {
    // Pre-cookie builds kept the session in localStorage — clear the leftover.
    localStorage.removeItem('bingus.session')
    let cancelled = false
    api
      .getMe()
      .then((res) => {
        if (cancelled) return
        setState(
          res
            ? { status: 'signed-in', me: res }
            : { status: 'signed-out', me: null },
        )
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'signed-out', me: null })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const logIn = useCallback(async (name: string, password: string) => {
    const me = await api.logIn(name, password)
    setState({ status: 'signed-in', me })
  }, [])

  const logOut = useCallback(async () => {
    await api.logOut()
    // A live game socket would outlive the dead session — cut it too.
    socket.disconnect()
    setState({ status: 'signed-out', me: null })
  }, [])

  const setPassword = useCallback(async (password: string) => {
    const me = await api.setPassword(password)
    setState({ status: 'signed-in', me })
  }, [])

  const rename = useCallback(async (name: string) => {
    const me = await api.renameMe(name)
    setState({ status: 'signed-in', me })
  }, [])

  return (
    <SessionContext.Provider
      value={{
        status: state.status,
        player: state.me?.player ?? null,
        needsPasswordReset: state.me?.needsPasswordReset ?? false,
        isAdmin: state.me?.isAdmin ?? false,
        logIn,
        logOut,
        setPassword,
        rename,
      }}
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
