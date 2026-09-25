import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { freeIndex, type BoardSize, type GamePlayer } from '@bingus/shared'
import type { GameRoomView } from '../lib/gameRoom'
import { useSession } from '../lib/session'
import { playBubble, playPop, unlockAudio } from '../lib/sounds'
import styles from './GamePlayPage.module.css'

// Mockup 1g — the live table. My card in the main column, rivals' mini
// boards + trash-talk chat in the right rail. Once the server declares a
// winner, GameRoute swaps this screen for GameOverPage (mockups 1i/1h).

// Candy accents for rivals + chat avatars, derived from the player id so a
// player keeps their color across renders without storing anything.
const CANDY = ['#FFD43B', '#A3E635', '#FF8FC1', '#7DD3FC', '#C89BF5', '#FFA94D']

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

function accentFor(id: string): string {
  return CANDY[hashId(id) % CANDY.length]
}

// Cells run 0..size²-1 with the FREE tile at freeIndex(size); the card array
// omits FREE, so terms after it shift down by one.
function cellTerm(gp: GamePlayer, cell: number, free: number): string {
  return gp.card[cell < free ? cell : cell - 1]
}

function GamePlayRival({
  rival,
  size,
  onPeek,
}: {
  rival: GamePlayer
  size: BoardSize
  onPeek: () => void
}) {
  const free = freeIndex(size)
  const accent = accentFor(rival.player.id)
  return (
    <button className={styles.rival} type="button" onClick={onPeek}>
      <span
        className={styles.rivalGrid}
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
        aria-hidden
      >
        {Array.from({ length: size * size }, (_, cell) => (
          <span
            key={cell}
            className={styles.rivalCell}
            style={{
              background:
                cell === free || rival.marks.includes(cell)
                  ? accent
                  : '#F1E9F4',
            }}
          />
        ))}
      </span>
      <span className={styles.rivalName}>
        <span className={styles.avatar} style={{ background: accent }}>
          {rival.player.name[0]?.toUpperCase()}
        </span>
        {rival.player.name}
      </span>
      <span className={styles.rivalCount}>{rival.marks.length + 1} tiles</span>
    </button>
  )
}

function GamePlayPeek({
  rival,
  size,
  onClose,
}: {
  rival: GamePlayer
  size: BoardSize
  onClose: () => void
}) {
  const free = freeIndex(size)
  const accent = accentFor(rival.player.id)
  return (
    <div className={styles.peek}>
      <button
        className={styles.peekClose}
        type="button"
        aria-label="Close peek"
        onClick={onClose}
      >
        ×
      </button>
      <h3 className={styles.peekTitle}>{`${rival.player.name}'s card`}</h3>
      <p className={styles.peekSub}>
        {rival.marks.length + 1} tiles · updating live
      </p>
      <div
        className={styles.peekGrid}
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: size * size }, (_, cell) => {
          const isFree = cell === free
          const marked = isFree || rival.marks.includes(cell)
          return (
            <span
              key={cell}
              className={styles.peekCell}
              style={{
                background: isFree
                  ? 'var(--yellow)'
                  : marked
                    ? accent
                    : '#F1E9F4',
              }}
            >
              {isFree ? 'FREE' : cellTerm(rival, cell, free)}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function GamePlayPage({ room }: { room: GameRoomView }) {
  const navigate = useNavigate()
  const { player } = useSession()
  const [soundOn, setSoundOn] = useState(true)
  const [peekId, setPeekId] = useState<string | null>(null)
  const [chatDraft, setChatDraft] = useState('')
  const chatListRef = useRef<HTMLDivElement>(null)
  const chatCount = room.chat.length

  useEffect(() => {
    const el = chatListRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chatCount])

  // Rival bubbles arrive outside any gesture, so wake audio up front: on
  // mount (Chrome and Firefox start once the player has clicked into the
  // page) and on the first tap or keypress (Safari and iOS only start audio
  // mid-gesture). pointerup, not click — iOS won't reliably fire click on a
  // plain element, and a touch pointerdown doesn't count as a gesture.
  useEffect(() => {
    unlockAudio()
    window.addEventListener('pointerup', unlockAudio, { once: true })
    window.addEventListener('keydown', unlockAudio, { once: true })
    return () => {
      window.removeEventListener('pointerup', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
    }
  }, [])

  // Bloop when someone else speaks. Tracks the server timestamp of the
  // newest message heard, starting from the join backlog so arriving at a
  // chatty table stays quiet. A reconnect's backlog — shorter, or rotated at
  // the server's cap — only bloops for what was missed.
  const heardUpTo = useRef(room.chat[room.chat.length - 1]?.at ?? '')
  useEffect(() => {
    const fresh = room.chat.filter((m) => m.at > heardUpTo.current)
    if (fresh.length === 0) return
    heardUpTo.current = fresh[fresh.length - 1].at
    if (soundOn && player && fresh.some((m) => m.player.id !== player.id)) {
      playBubble()
    }
  }, [room.chat, soundOn, player])

  if (!player) return null
  const { state } = room
  const me = state.players.find((p) => p.player.id === player.id)
  if (!me) return null

  const size = state.board.size
  const free = freeIndex(size)
  const finished = state.status === 'finished'
  const winner = state.winner
  const rivals = state.players.filter((p) => p.player.id !== player.id)
  const peeked = rivals.find((r) => r.player.id === peekId) ?? null
  const online = state.players.filter((p) => p.connected).length

  const handleCell = (cell: number) => {
    const isMarked = me.marks.includes(cell)
    if (!isMarked && soundOn) playPop()
    // The server is the referee — a rejected mark just means the next state
    // broadcast wins, so error strings are dropped on the floor.
    void room.mark(cell, !isMarked)
  }

  function handleChatSubmit(e: FormEvent) {
    e.preventDefault()
    if (!chatDraft.trim()) return
    room.sendChat(chatDraft)
    setChatDraft('')
  }

  return (
    <>
      <header className={styles.header}>
        <button
          className={styles.back}
          type="button"
          aria-label="Back to the archive"
          onClick={() => navigate('/boards')}
        >
          ←
        </button>
        <div>
          <h1 className={styles.boardName}>{state.board.name}</h1>
          <p className={styles.subline}>
            ROUND 1 · {state.players.length} PLAYERS · WINS: ROW / COL / DIAG /
            BLACKOUT
          </p>
        </div>
        <div className={styles.headerRight}>
          <button
            className={soundOn ? styles.soundOn : styles.soundOff}
            type="button"
            aria-pressed={soundOn}
            onClick={() => setSoundOn((was) => !was)}
          >
            {soundOn ? '🔊 SOUND ON' : '🔇 SOUND OFF'}
          </button>
          <button
            className={styles.rageQuit}
            type="button"
            onClick={() => navigate('/boards')}
          >
            RAGE QUIT
          </button>
          <span className={styles.chip}>
            <span
              className={styles.avatar}
              style={{ background: accentFor(player.id) }}
            >
              {player.name[0]?.toUpperCase()}
            </span>
            {player.name}
          </span>
        </div>
      </header>
      <main className={styles.body}>
        <section className={styles.main}>
          <div className={styles.cardLabelRow}>
            <p className={styles.cardLabel}>YOUR CARD</p>
            <span className={styles.shuffledPill}>SHUFFLED JUST FOR YOU</span>
          </div>
          <div
            className={styles.card}
            role="group"
            aria-label="Your card"
            style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: size * size }, (_, cell) => {
              const isFree = cell === free
              const marked = isFree || me.marks.includes(cell)
              const inLine =
                finished && winner !== null && winner.line.includes(cell)
              const classes = [
                styles.cell,
                marked && styles.cellMarked,
                isFree && styles.cellFree,
                inLine && styles.cellWinning,
              ]
              return (
                <button
                  key={cell}
                  type="button"
                  className={classes.filter(Boolean).join(' ')}
                  aria-pressed={marked}
                  disabled={isFree || finished}
                  onClick={() => handleCell(cell)}
                >
                  {isFree ? (
                    <>
                      <span className={styles.freeStar} aria-hidden>
                        ★
                      </span>
                      FREE
                    </>
                  ) : (
                    cellTerm(me, cell, free)
                  )}
                </button>
              )
            })}
          </div>
        </section>
        <aside className={styles.rail}>
          <p className={styles.rivalsLabel}>
            <span className={styles.liveDot} aria-hidden />
            THE COMPETITION — LIVE
          </p>
          <div className={styles.rivalsGrid}>
            {rivals.map((rival) => (
              <GamePlayRival
                key={rival.player.id}
                rival={rival}
                size={size}
                onPeek={() => setPeekId(rival.player.id)}
              />
            ))}
          </div>
          {peeked && (
            <GamePlayPeek
              rival={peeked}
              size={size}
              onClose={() => setPeekId(null)}
            />
          )}
          <p className={styles.peekHint}>
            click a rival's board to peek at their card
          </p>
          <div className={styles.chat}>
            <div className={styles.chatHeader}>
              TRASH TALK
              <span className={styles.onlinePill}>{online} online</span>
            </div>
            <div className={styles.chatList} ref={chatListRef}>
              {room.chat.map((m, i) => (
                <div key={`${m.at}-${i}`} className={styles.chatMessage}>
                  <span
                    className={styles.avatar}
                    style={{ background: accentFor(m.player.id) }}
                  >
                    {m.player.name[0]?.toUpperCase()}
                  </span>
                  <p className={styles.chatBody}>
                    <strong className={styles.chatName}>
                      {m.player.name}:
                    </strong>{' '}
                    {m.text}
                  </p>
                </div>
              ))}
            </div>
            <form className={styles.chatInputRow} onSubmit={handleChatSubmit}>
              <input
                className={styles.chatInput}
                placeholder="say something spicy…"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
              />
              <button className={styles.chatSend} type="submit" aria-label="Send">
                →
              </button>
            </form>
          </div>
        </aside>
      </main>
    </>
  )
}
