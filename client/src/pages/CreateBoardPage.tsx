import { AppHeader } from '../components/AppHeader'

// Stub — mockup 1d (print a fresh board) is being built on its own branch.
// Route and API contract are already live; only this page changes.
export function CreateBoardPage() {
  return (
    <>
      <AppHeader />
      <main style={{ padding: '40px 56px' }}>
        <h2>Print a fresh one</h2>
        <p>Board creator coming right up.</p>
      </main>
    </>
  )
}
