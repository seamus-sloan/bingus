import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { UpdateBoardRequestSchema, type Board } from '@bingus/shared'
import { AppHeader } from '../components/AppHeader'
import { getBoard, updateBoard } from '../lib/api'
import { BoardForm } from './BoardForm'
import styles from './EditBoardPage.module.css'

// Reprint an existing board: fetch it, prefill the shared BoardForm, and
// PATCH the whole shape back. Any signed-in player may edit any board, so the
// only failure the server raises here is a board that isn't in the archive.
export function EditBoardPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [board, setBoard] = useState<Board | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    getBoard(id)
      .then((res) => {
        if (!cancelled) setBoard(res.board)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (failed) {
    return (
      <>
        <AppHeader />
        <main className={styles.statusMain}>
          <p className={styles.statusLine}>
            That board isn't in the archive — maybe it never was.
          </p>
          <button
            className={styles.back}
            type="button"
            onClick={() => navigate('/boards')}
          >
            Back to the archive
          </button>
        </main>
      </>
    )
  }

  if (!board) {
    return (
      <>
        <AppHeader />
        <main className={styles.statusMain}>
          <p className={styles.statusLine}>Fetching the board…</p>
        </main>
      </>
    )
  }

  return (
    <>
      <AppHeader />
      <BoardForm
        eyebrow="EDIT BOARD"
        title={`Reprint ${board.name}`}
        submitLabel="Reprint it ✓"
        schema={UpdateBoardRequestSchema}
        initial={{ name: board.name, size: board.size, terms: board.terms }}
        onSubmit={async (data) => {
          await updateBoard(board.id, data)
          // The archive page shows a "Board printed" toast from this state.
          navigate('/boards', { state: { printed: data.name } })
        }}
      />
    </>
  )
}
