import type { GameRoomView } from '../lib/gameRoom'

// Stub — mockup 1g (gameplay) is being built on its own branch. The room
// prop carries live state + actions; only this file changes.
export function GamePlayPage({ room }: { room: GameRoomView }) {
  return (
    <main style={{ padding: '56px 72px' }}>
      <h2>{room.state.board.name}</h2>
      <p>
        Game {room.state.code} is {room.state.status}. Screen coming right up.
      </p>
    </main>
  )
}
