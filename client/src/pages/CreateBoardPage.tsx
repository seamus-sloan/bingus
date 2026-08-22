import { useNavigate } from 'react-router'
import { CreateBoardRequestSchema } from '@bingus/shared'
import { AppHeader } from '../components/AppHeader'
import { createBoard } from '../lib/api'
import { BoardForm } from './BoardForm'

// Mockup 1d — print a fresh board. The form itself (and its live preview)
// lives in BoardForm, shared with the edit page.
export function CreateBoardPage() {
  const navigate = useNavigate()
  return (
    <>
      <AppHeader />
      <BoardForm
        eyebrow="NEW GAME · STEP 1.5 — BUILD A BOARD"
        title="Print a fresh one"
        submitLabel="Print it → start a game"
        schema={CreateBoardRequestSchema}
        onSubmit={async (data) => {
          await createBoard(data)
          // The archive page shows a "Board printed" toast from this state.
          navigate('/boards', { state: { printed: data.name } })
        }}
      />
    </>
  )
}
