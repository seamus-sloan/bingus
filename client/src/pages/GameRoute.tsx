import { useNavigate, useParams } from 'react-router'
import { AppHeader } from '../components/AppHeader'
import { useGameRoom } from '../lib/gameRoom'
import { GamePlayPage } from './GamePlayPage'
import { LobbyPage } from './LobbyPage'

// /game/:code — joins the table over the socket and hands the live room to
// the right screen: lobby before the host starts, gameplay after (the
// gameplay screen also owns the finished/win/lose presentation).
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

  return status.room.state.status === 'lobby' ? (
    <LobbyPage room={status.room} />
  ) : (
    <GamePlayPage room={status.room} />
  )
}
