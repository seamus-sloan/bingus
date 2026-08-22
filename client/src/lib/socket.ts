import { io, type Socket } from 'socket.io-client'
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@bingus/shared'

// Same-origin connection; the session cookie rides the handshake, so the
// server knows who we are. Vite proxies /socket.io in dev. Connected lazily
// by the game screens and left connected while the tab lives.
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: false,
})

export function connectSocket() {
  if (!socket.connected) socket.connect()
  return socket
}
