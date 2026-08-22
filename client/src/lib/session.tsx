import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react'
import type { Player } from '@bingus/shared'
import { createPlayer, renamePlayer } from './api'

// The signed-in identity, persisted in localStorage. The token authorizes
// profile changes (sent as a Bearer header) and never leaves this module
// except inside API calls.
export interface Session {
  player: Player
  token: string
}

const STORAGE_KEY = 'bingus.session'

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

interface SessionContextValue {
  session: Session | null
  signIn: (name: string) => Promise<void>
  rename: (name: string) => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession)

  const store = useCallback((next: Session) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setSession(next)
  }, [])

  const signIn = useCallback(
    async (name: string) => {
      const { player, token } = await createPlayer(name)
      store({ player, token })
    },
    [store],
  )

  const rename = useCallback(
    async (name: string) => {
      if (!session) throw new Error('Not signed in')
      const { player } = await renamePlayer(session.player.id, session.token, name)
      store({ player, token: session.token })
    },
    [session, store],
  )

  return (
    <SessionContext.Provider value={{ session, signIn, rename }}>
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
