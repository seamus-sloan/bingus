import type { GameRoomView } from '../lib/gameRoom'

// Stub — mockup 1f (game lobby) is being built on its own branch. The room
// prop carries live state + actions; only this file changes.
export function LobbyPage({ room }: { room: GameRoomView }) {
  return (
    <main style={{ padding: '56px 72px' }}>
      <h2>{room.state.board.name}</h2>
      <p>
        Lobby {room.state.code} — {room.state.players.length} seated. Screen
        coming right up.
      </p>
    </main>
  )
}
