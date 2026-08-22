import { HomePage } from './pages/HomePage'
import { SignInPage } from './pages/SignInPage'
import { SessionProvider, useSession } from './lib/session'

function Screens() {
  const { session } = useSession()
  return session ? <HomePage /> : <SignInPage />
}

function App() {
  return (
    <SessionProvider>
      <Screens />
    </SessionProvider>
  )
}

export default App
