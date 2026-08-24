import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import {
  BOARD_NAME_MAX,
  BOARD_SIZES,
  BOARD_TERMS_MAX,
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
  // Drives the name field's attention state: an empty name only turns
  // magenta once the player has moved on to the terms or tried to submit —
  // not the moment the form loads.
  const [nudgeName, setNudgeName] = useState(false)

  const terms = termsText
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
  // `required` is the card's tile count, and so the shallowest bank that can
  // fill one. Anything above it is depth: extra terms the deal can reach for.
  const required = termsRequired(size)
  const countRight = terms.length >= required && terms.length <= BOARD_TERMS_MAX
  const center = Math.floor((size * size) / 2)

  // What still blocks the submit button — rendered next to it so the
  // disabled state never has to explain itself.
  const missing: string[] = []
  if (!name.trim()) missing.push('a board name')
  if (terms.length < required) {
    const short = required - terms.length
    missing.push(`${short} more term${short === 1 ? '' : 's'}`)
  } else if (terms.length > BOARD_TERMS_MAX) {
    missing.push(`${terms.length - BOARD_TERMS_MAX} terms over the cap`)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setNudgeName(true)
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
            className={
              nudgeName && !name.trim() ? styles.inputAttention : styles.input
            }
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
                  {termsRequired(s)} tiles · {SIZE_FLAVOR[s]}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label className={styles.label} htmlFor="board-terms">
              YOUR WORD BANK — ONE PER LINE
            </label>
            <span className={countRight ? styles.chipDone : styles.chip}>
              {terms.length} / {required} min
              {countRight && ' ✓'}
            </span>
          </div>
          <textarea
            id="board-terms"
            className={styles.textarea}
            rows={11}
            placeholder="one spicy term per line"
            value={termsText}
            onChange={(e) => {
              setTermsText(e.target.value)
              setNudgeName(true)
            }}
          />
          <p className={styles.hint}>
            Each card is dealt {required} terms off this bank, and the center
            tile is a FREE space we throw in for nothing. Stock more than{' '}
            {required} (up to {BOARD_TERMS_MAX}) and no two players get the
            same board — stop at {required} and everyone shares one term list,
            shuffled.
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
        {missing.length > 0 && (
          <p className={styles.stillNeeded} role="status">
            Still needed: {missing.join(' · ')}
          </p>
        )}
      </form>
      <aside className={styles.previewCol}>
        <div className={styles.previewLabel}>LIVE PREVIEW — DEALT PER PLAYER</div>
        <div
          className={styles.previewCard}
          data-testid="board-preview"
          style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
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
          {terms.length > required
            ? `One of many ${required}-tile hands off a ${terms.length}-term bank.`
            : `Every player gets these same ${required} terms in a different order.`}{' '}
          Row, column, diagonal or full blackout wins.
        </p>
      </aside>
    </main>
  )
}
