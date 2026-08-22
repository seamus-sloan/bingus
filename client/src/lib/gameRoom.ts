import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, GameState } from '@bingus/shared'
import { connectSocket, socket } from './socket'

// One hook = one seat at one table. Joins the game on mount, keeps the full
// public state + chat in sync from server broadcasts, and exposes the only
// four things a player can do. Lobby and gameplay screens are pure views on
// top of this.
export interface GameRoomView {
  state: GameState
  chat: ChatMessage[]
  start: () => Promise<string | null>
  rematch: () => Promise<string | null>
  mark: (cell: number, marked: boolean) => Promise<string | null>
  sendChat: (text: string) => void
}

export type GameRoomStatus =
  | { phase: 'joining' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; room: GameRoomView }

// NOTE: mount the component that calls this with `key={code}` — state resets
// by remounting when the code changes (see GameRoute).
export function useGameRoom(code: string): GameRoomStatus {
  const [state, setState] = useState<GameState | null>(null)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const joinedCode = useRef<string | null>(null)

  useEffect(() => {
    const s = connectSocket()

    const onState = (next: GameState) => {
      if (next.code === joinedCode.current) setState(next)
    }
    const onChat = (message: ChatMessage) => setChat((c) => [...c, message])
    const join = () => {
      s.emit('game:join', code, (result) => {
        if ('error' in result) {
          setError(result.error)
          return
        }
        joinedCode.current = result.state.code
        setState(result.state)
        setChat(result.chat)
      })
    }

    s.on('game:state', onState)
    s.on('game:chat', onChat)
    // (Re)join on every (re)connect so a dropped socket resumes its seat.
    s.on('connect', join)
    if (s.connected) join()

    return () => {
      s.off('game:state', onState)
      s.off('game:chat', onChat)
      s.off('connect', join)
      joinedCode.current = null
      s.emit('game:leave')
    }
  }, [code])

  const start = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        socket.emit('game:start', (result) =>
          resolve('error' in result ? result.error : null),
        )
      }),
    [],
  )

  const rematch = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        socket.emit('game:rematch', (result) =>
          resolve('error' in result ? result.error : null),
        )
      }),
    [],
  )

  const mark = useCallback(
    (cell: number, marked: boolean) =>
      new Promise<string | null>((resolve) => {
        socket.emit('game:mark', cell, marked, (result) => {
          if ('error' in result) {
            resolve(result.error)
          } else {
            setState(result.state)
            resolve(null)
          }
        })
      }),
    [],
  )

  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim()
    if (trimmed) socket.emit('game:chat', trimmed)
  }, [])

  if (error) return { phase: 'error', message: error }
  if (!state) return { phase: 'joining' }
  return { phase: 'ready', room: { state, chat, start, rematch, mark, sendChat } }
}
