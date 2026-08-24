import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { BoardArchivePage } from './pages/BoardArchivePage'
import { CreateBoardPage } from './pages/CreateBoardPage'
import { EditBoardPage } from './pages/EditBoardPage'
import { GameRoute } from './pages/GameRoute'
import { HomePage } from './pages/HomePage'
import { JoinGamesPage } from './pages/JoinGamesPage'
import { SetPasswordPage } from './pages/SetPasswordPage'
import { SignInPage } from './pages/SignInPage'
import { SessionProvider, useSession } from './lib/session'

// Route guard: every authenticated route lives inside the signed-in branch.
// Signed-out (including ghost sessions the server 401'd) always renders the
// login screen, whatever the URL. A player behind the password-reset gate
// only ever sees the set-password screen — unroutable and unskippable (the
// server enforces the same gate on every other endpoint). The admin route is
// registered only for admins; everyone else falls into the catch-all and
// bounces home, and the server checks admin on the API anyway.
function Screens() {
  const { status, needsPasswordReset, isAdmin } = useSession()
  if (status === 'loading') return null // brief blank cream while /api/me resolves
  if (status !== 'signed-in') return <SignInPage />
  if (needsPasswordReset) return <SetPasswordPage />
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/boards" element={<BoardArchivePage />} />
      <Route path="/boards/new" element={<CreateBoardPage />} />
      <Route path="/boards/:id/edit" element={<EditBoardPage />} />
      <Route path="/join" element={<JoinGamesPage />} />
      <Route path="/game/:code" element={<GameRoute />} />
      {isAdmin && <Route path="/admin/users" element={<AdminUsersPage />} />}
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
