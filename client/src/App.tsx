import { HomePage } from './pages/HomePage'
import { SignInPage } from './pages/SignInPage'
import { SessionProvider, useSession } from './lib/session'

// Route guard, pre-router: anything that isn't the sign-in screen renders
// only in the signed-in branch. When a router lands, this becomes a proper
// guard around every authenticated route.
function Screens() {
  const { status } = useSession()
  if (status === 'loading') return null // brief blank cream while /api/me resolves
  return status === 'signed-in' ? <HomePage /> : <SignInPage />
}

function App() {
  return (
    <SessionProvider>
      <Screens />
    </SessionProvider>
  )
}

export default App
