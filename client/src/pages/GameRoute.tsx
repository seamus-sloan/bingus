import { useNavigate, useParams } from 'react-router'
import { AppHeader } from '../components/AppHeader'
import { useGameRoom } from '../lib/gameRoom'
import { GameOverPage } from './GameOverPage'
import { GamePlayPage } from './GamePlayPage'
import { LobbyPage } from './LobbyPage'

// /game/:code — joins the table over the socket and hands the live room to
// the right screen: lobby before the host starts, gameplay while playing,
// and the full-art win/lose screen once the server declares a winner.
export function GameRoute() {
  const { code = '' } = useParams()
  // Remounting on code change resets useGameRoom's state wholesale.
  return <GameRoomScreens key={code} code={code} />
}

function GameRoomScreens({ code }: { code: string }) {
  const navigate = useNavigate()
  const status = useGameRoom(code)

  if (status.phase === 'joining') {
    return (
      <>
        <AppHeader />
        <main style={{ padding: '56px 72px', fontWeight: 700 }}>
          Pulling up a chair…
        </main>
      </>
    )
  }

  if (status.phase === 'error') {
    return (
      <>
        <AppHeader />
        <main style={{ padding: '56px 72px' }}>
          <p style={{ fontWeight: 700 }} role="alert">
            {status.message}
          </p>
          <button type="button" onClick={() => navigate('/boards')}>
            Back to the archive
          </button>
        </main>
      </>
    )
  }

  if (status.room.state.status === 'lobby') return <LobbyPage room={status.room} />
  if (status.room.state.status === 'finished') {
    return <GameOverPage room={status.room} />
  }
  return <GamePlayPage room={status.room} />
}
