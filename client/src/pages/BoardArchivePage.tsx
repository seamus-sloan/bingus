import { AppHeader } from '../components/AppHeader'

// Stub — mockup 1c (pick a board from the archive) is being built on its own
// branch. Route and API contract are already live; only this page changes.
export function BoardArchivePage() {
  return (
    <>
      <AppHeader />
      <main style={{ padding: '40px 56px' }}>
        <h2>Pick your battlefield</h2>
        <p>Board archive coming right up.</p>
      </main>
    </>
  )
}
