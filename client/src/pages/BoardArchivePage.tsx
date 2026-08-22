import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { Board } from '@bingus/shared'
import { AppHeader } from '../components/AppHeader'
import { listBoards } from '../lib/api'
import styles from './BoardArchivePage.module.css'

// Mockup 1c — pick a board from the archive (step 1 of starting a game).
// Search hits the API's `search` param (debounced), load-more pages by
// offset, and the first grid cell is always the "create a new board" tile.

const PAGE_SIZE = 12
const SEARCH_DEBOUNCE_MS = 300
const NEW_RIBBON_WINDOW_MS = 2 * 60 * 1000
const PRINTED_TOAST_MS = 3000

// Candy accents for the mini previews + size chips. Which one a board gets —
// and which preview tiles are "filled" — derives from its id, so a board
// always looks the same without storing any styling server-side.
const CANDY = ['#FFD43B', '#A3E635', '#FF8FC1', '#7DD3FC', '#C89BF5', '#FFA94D']

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

function BoardArchivePreview({ board }: { board: Board }) {
  const h = hashId(board.id)
  const accent = CANDY[h % CANDY.length]
  return (
    <div className={styles.preview} aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className={styles.previewTile}
          style={{
            background: (h >> i) & 1 ? accent : '#F1E9F4',
          }}
        />
      ))}
    </div>
  )
}

// Ids of boards created inside the NEW-ribbon window, judged when the API
// response lands (render must stay pure — no clock reads there).
function freshIds(boards: Board[]): string[] {
  const now = Date.now()
  return boards
    .filter((b) => now - Date.parse(b.createdAt) < NEW_RIBBON_WINDOW_MS)
    .map((b) => b.id)
}

function BoardArchiveCard({
  board,
  isNew,
  onPlay,
}: {
  board: Board
  isNew: boolean
  onPlay: () => void
}) {
  const accent = CANDY[hashId(board.id) % CANDY.length]
  return (
    <article className={styles.card}>
      {isNew && <span className={styles.newRibbon}>NEW</span>}
      <BoardArchivePreview board={board} />
      <h3 className={styles.cardName}>{board.name}</h3>
      <p className={styles.cardBy}>by {board.createdBy}</p>
      <div className={styles.chips}>
        <span className={styles.sizeChip} style={{ background: accent }}>
          {board.size}×{board.size}
        </span>
        <span className={styles.playsChip}>
          {board.plays === 0
            ? 'fresh off the press'
            : `${board.plays} play${board.plays === 1 ? '' : 's'}`}
        </span>
      </div>
      <button className={styles.playCta} type="button" onClick={onPlay}>
        Play this board →
      </button>
    </article>
  )
}

export function BoardArchivePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [boards, setBoards] = useState<Board[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [archiveTotal, setArchiveTotal] = useState<number | null>(null)
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [printedToast, setPrintedToast] = useState<string | null>(
    (location.state as { printed?: string } | null)?.printed ?? null,
  )

  useEffect(() => {
    if (query === search) return
    const timer = window.setTimeout(
      () => setSearch(query),
      SEARCH_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [query, search])

  useEffect(() => {
    let cancelled = false
    listBoards({
      search: search || undefined,
      limit: PAGE_SIZE,
      offset: 0,
    })
      .then((res) => {
        if (cancelled) return
        setBoards(res.boards)
        setTotal(res.total)
        setFresh(new Set(freshIds(res.boards)))
        if (!search) setArchiveTotal(res.total)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [search])

  useEffect(() => {
    if (!printedToast) return
    const timer = window.setTimeout(
      () => setPrintedToast(null),
      PRINTED_TOAST_MS,
    )
    return () => window.clearTimeout(timer)
  }, [printedToast])

  function loadMore() {
    setLoadingMore(true)
    listBoards({
      search: search || undefined,
      limit: PAGE_SIZE,
      offset: boards.length,
    })
      .then((res) => {
        setBoards((prev) => [...prev, ...res.boards])
        setTotal(res.total)
        setFresh((prev) => new Set([...prev, ...freshIds(res.boards)]))
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false))
  }

  function tablesComingSoon() {
    setToast("Game tables aren't open yet. Soon.")
    window.setTimeout(() => setToast(null), 2500)
  }

  const hasMore = total !== null && boards.length < total
  const searchCount = archiveTotal ?? total
  const emptyArchive = total === 0 && !search
  const emptySearch = total === 0 && search !== ''

  return (
    <>
      <AppHeader />
      <main className={styles.main}>
        <div className={styles.titleRow}>
          <div>
            <p className={styles.eyebrow}>NEW GAME · STEP 1 OF 2</p>
            <h2 className={styles.title}>Pick your battlefield</h2>
          </div>
          <input
            className={styles.search}
            type="search"
            aria-label="Search boards"
            placeholder={
              searchCount === null
                ? '⌕ Search boards…'
                : `⌕ Search ${searchCount} board${searchCount === 1 ? '' : 's'}…`
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className={styles.grid}>
          <button
            className={styles.createTile}
            type="button"
            onClick={() => navigate('/boards/new')}
          >
            <span className={styles.createPlus} aria-hidden>
              +
            </span>
            <span className={styles.createTitle}>Create a new board</span>
            <span className={styles.createSub}>
              Your terms, your rules.
              <br />
              Takes about a minute.
            </span>
          </button>
          {boards.map((board) => (
            <BoardArchiveCard
              key={board.id}
              board={board}
              isNew={fresh.has(board.id)}
              onPlay={tablesComingSoon}
            />
          ))}
          {emptyArchive && (
            <p className={styles.empty}>
              Nothing in the archive yet. Print the first one and set the
              tone.
            </p>
          )}
          {emptySearch && (
            <p className={styles.empty}>
              No boards match — try fewer letters or print it yourself.
            </p>
          )}
        </div>
        {total !== null && total > 0 && (
          <div className={styles.pager}>
            {hasMore && (
              <button
                className={styles.loadMore}
                type="button"
                disabled={loadingMore}
                onClick={loadMore}
              >
                Load more boards ↓
              </button>
            )}
            <p className={styles.showing}>
              showing {boards.length} of {total}
            </p>
          </div>
        )}
        <p className={styles.footerHint}>
          Picking a board opens a live table other players can join. Boards
          shuffle per player, so no memorizing.
        </p>
      </main>
      {toast && (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      )}
      {printedToast && (
        <div className={styles.printedToast} role="status">
          Board printed: {printedToast} ✓
        </div>
      )}
    </>
  )
}
