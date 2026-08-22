import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import {
  BOARD_NAME_MAX,
  BOARD_SIZES,
  termsRequired,
  type BoardSize,
  type CreateBoardRequest,
  type CreateBoardRequestSchema,
} from '@bingus/shared'
import { ApiError } from '../lib/api'
import styles from './BoardForm.module.css'

const SIZE_FLAVOR: Record<BoardSize, string> = {
  3: 'quick',
  4: 'medium',
  5: 'classic',
}

interface BoardFormProps {
  eyebrow: string
  title: string
  submitLabel: string
  // Create and edit share one request shape; each page passes its own schema.
  schema: typeof CreateBoardRequestSchema
  initial?: { name: string; size: BoardSize; terms: string[] }
  onSubmit: (data: CreateBoardRequest) => Promise<void>
}

// The board form shared by the create and edit pages: form column on the
// left, live preview card on the right mirroring name/size/terms as typed.
export function BoardForm({
  eyebrow,
  title,
  submitLabel,
  schema,
  initial,
  onSubmit,
}: BoardFormProps) {
  const navigate = useNavigate()
  const [name, setName] = useState(initial?.name ?? '')
  const [size, setSize] = useState<BoardSize>(initial?.size ?? 5)
  const [termsText, setTermsText] = useState(initial?.terms.join('\n') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const terms = termsText
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
  const required = termsRequired(size)
  const countRight = terms.length === required
  const center = Math.floor((size * size) / 2)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = schema.safeParse({ name, size, terms })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the board and try again.')
      return
    }
    setPending(true)
    try {
      await onSubmit(parsed.data)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Something broke. Try again in a second.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <main className={styles.main}>
      <form className={styles.formCol} onSubmit={handleSubmit}>
        <div className={styles.eyebrow}>{eyebrow}</div>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="board-name">
            BOARD NAME
          </label>
          <input
            id="board-name"
            className={styles.input}
            placeholder="Standup Standoff"
            value={name}
            maxLength={BOARD_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <div className={styles.label} id="board-size-label">
            BOARD SIZE
          </div>
          <div className={styles.sizes} role="group" aria-labelledby="board-size-label">
            {BOARD_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                className={s === size ? styles.sizeCardSelected : styles.sizeCard}
                aria-pressed={s === size}
                onClick={() => setSize(s)}
              >
                <span className={styles.sizeName}>
                  {s}×{s}
                  {s === size && ' ✓'}
                </span>
                <span className={styles.sizeSub}>
                  {termsRequired(s)} terms · {SIZE_FLAVOR[s]}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label className={styles.label} htmlFor="board-terms">
              YOUR TERMS — ONE PER LINE
            </label>
            <span className={countRight ? styles.chipDone : styles.chip}>
              {terms.length} / {required}
              {countRight && ' ✓'}
            </span>
          </div>
          <textarea
            id="board-terms"
            className={styles.textarea}
            rows={11}
            placeholder="one spicy term per line"
            value={termsText}
            onChange={(e) => setTermsText(e.target.value)}
          />
          <p className={styles.hint}>
            The center tile is a FREE space — we throw it in for nothing. Make
            the terms spicy.
          </p>
        </div>
        <div className={styles.errorSlot}>
          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
        </div>
        <div className={styles.actions}>
          <button
            className={styles.submit}
            type="submit"
            disabled={pending || !countRight || !name.trim()}
          >
            {submitLabel}
          </button>
          <button
            className={styles.back}
            type="button"
            onClick={() => navigate('/boards')}
          >
            Back
          </button>
        </div>
      </form>
      <aside className={styles.previewCol}>
        <div className={styles.previewLabel}>LIVE PREVIEW — SHUFFLED PER PLAYER</div>
        <div
          className={styles.previewCard}
          data-testid="board-preview"
          style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
        >
          {Array.from({ length: size * size }, (_, i) => {
            if (i === center) {
              return (
                <div key={i} className={styles.cellFree}>
                  FREE
                </div>
              )
            }
            const term = terms[i < center ? i : i - 1]
            return (
              <div key={i} className={term ? styles.cell : styles.cellBlank}>
                {term}
              </div>
            )
          })}
        </div>
        <p className={styles.previewCaption}>
          Every player gets these same {required} terms in a different order.
          Row, column, diagonal or full blackout wins.
        </p>
      </aside>
    </main>
  )
}
