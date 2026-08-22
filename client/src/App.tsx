import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { BoardArchivePage } from './pages/BoardArchivePage'
import { CreateBoardPage } from './pages/CreateBoardPage'
import { GameRoute } from './pages/GameRoute'
import { HomePage } from './pages/HomePage'
import { SignInPage } from './pages/SignInPage'
import { SessionProvider, useSession } from './lib/session'

// Route guard: every authenticated route lives inside the signed-in branch.
// Signed-out (including ghost sessions the server 401'd) always renders the
// sign-in screen, whatever the URL.
function Screens() {
  const { status } = useSession()
  if (status === 'loading') return null // brief blank cream while /api/me resolves
  if (status !== 'signed-in') return <SignInPage />
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/boards" element={<BoardArchivePage />} />
      <Route path="/boards/new" element={<CreateBoardPage />} />
      <Route path="/game/:code" element={<GameRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Screens />
      </SessionProvider>
    </BrowserRouter>
  )
}

export default App
