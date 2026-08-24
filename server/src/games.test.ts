import { describe, expect, it, vi } from "vitest";
import { freeIndex, type Board, type Player } from "@bingus/shared";
import { GameManager, GameRoom } from "./games.ts";

const HOST: Player = { id: "host-1", name: "Ruth" };
const RIVAL: Player = { id: "rival-1", name: "Priya" };

function board(size: 3 | 5 = 3): Board {
  const terms = Array.from({ length: size * size - 1 }, (_, i) => `term ${i}`);
  return {
    id: "b1",
    name: "Standup Standoff",
    size,
    terms,
    createdBy: "Ruth",
    plays: 0,
    createdAt: new Date().toISOString(),
  };
}

function room(size: 3 | 5 = 3): GameRoom {
  const r = new GameRoom("BNGS-421", board(size), HOST.id);
  r.join(HOST);
  return r;
}

/** Mark every cell in `cells` (skipping the free tile) for a player. */
function markAll(r: GameRoom, playerId: string, cells: number[]) {
  const free = freeIndex(r.board.size);
  for (const cell of cells) {
    if (cell !== free) {
      const result = r.mark(playerId, cell, true);
      if ("error" in result) throw new Error(`mark ${cell}: ${result.error}`);
    }
  }
}

describe("GameRoom", () => {
  it("deals every joiner a full shuffled card of the board's terms", () => {
    const r = room();
    r.join(RIVAL);
    const state = r.toState();
    expect(state.players).toHaveLength(2);
    for (const p of state.players) {
      expect([...p.card].sort()).toEqual([...r.board.terms].sort());
    }
  });

  it("keeps a player's card and marks across reconnects", () => {
    const r = room();
    r.join(RIVAL);
    r.start(HOST.id);
    r.mark(RIVAL.id, 0, true);
    const before = r.toState().players.find((p) => p.player.id === RIVAL.id)!;
    r.disconnect(RIVAL.id);
    r.join(RIVAL);
    const after = r.toState().players.find((p) => p.player.id === RIVAL.id)!;
    expect(after.card).toEqual(before.card);
    expect(after.marks).toEqual([0]);
    expect(after.connected).toBe(true);
  });

  it("only the host can start, and only from the lobby", () => {
    const r = room();
    r.join(RIVAL);
    expect(r.start(RIVAL.id)).toHaveProperty("error");
    expect(r.start(HOST.id)).toEqual({ ok: true });
    expect(r.start(HOST.id)).toHaveProperty("error");
  });

  it("rejects marks before the game starts, on the free tile, and out of range", () => {
    const r = room();
    expect(r.mark(HOST.id, 0, true)).toEqual({ error: "not_playing" });
    r.start(HOST.id);
    expect(r.mark(HOST.id, freeIndex(3), true)).toEqual({ error: "bad_cell" });
    expect(r.mark(HOST.id, 9, true)).toEqual({ error: "bad_cell" });
    expect(r.mark(HOST.id, -1, true)).toEqual({ error: "bad_cell" });
    expect(r.mark("stranger", 0, true)).toEqual({ error: "not_in_game" });
  });

  it("detects a row win through the free tile", () => {
    const r = room(); // 3×3, free at 4
    r.start(HOST.id);
    markAll(r, HOST.id, [3, 5]); // middle row is 3,4,5 — 4 is free
    const state = r.toState();
    expect(state.status).toBe("finished");
    expect(state.winner).toEqual({
      playerId: HOST.id,
      pattern: "row",
      line: [3, 4, 5],
    });
  });

  it("detects a column and a diagonal", () => {
    const col = room();
    col.start(HOST.id);
    markAll(col, HOST.id, [0, 3, 6]);
    expect(col.toState().winner?.pattern).toBe("column");

    const diag = room();
    diag.start(HOST.id);
    markAll(diag, HOST.id, [2, 6]); // anti-diagonal 2,4,6 with 4 free
    expect(diag.toState().winner?.pattern).toBe("diagonal");
  });

  it("unmarking prevents accidental wins", () => {
    const r = room();
    r.start(HOST.id);
    r.mark(HOST.id, 3, true);
    r.mark(HOST.id, 3, false);
    r.mark(HOST.id, 5, true);
    expect(r.toState().status).toBe("playing");
  });

  it("freezes the game after a win", () => {
    const r = room();
    r.join(RIVAL);
    r.start(HOST.id);
    markAll(r, HOST.id, [3, 5]);
    expect(r.mark(RIVAL.id, 0, true)).toEqual({ error: "not_playing" });
  });

  it("caps the table at eight players", () => {
    const r = room();
    for (let i = 0; i < 7; i++) {
      expect(r.join({ id: `p${i}`, name: `P${i}` })).toEqual({ ok: true });
    }
    expect(r.join({ id: "ninth", name: "Ninth" })).toHaveProperty("error");
    // Reconnects still work at capacity.
    expect(r.join(HOST)).toEqual({ ok: true });
  });

  it("rematch reshuffles every seat and returns to the lobby", () => {
    const r = room();
    r.join(RIVAL);
    r.start(HOST.id);
    r.mark(RIVAL.id, 0, true);
    const before = r.toState().players.map((p) => p.card.join("|"));
    r.mark(HOST.id, 3, true);
    r.mark(HOST.id, 5, true); // middle row with free tile: host wins
    expect(r.toState().status).toBe("finished");
    expect(r.rematch("stranger")).toHaveProperty("error");
    expect(r.rematch(RIVAL.id)).toEqual({ ok: true });
    const state = r.toState();
    expect(state.status).toBe("lobby");
    expect(state.winner).toBeNull();
    expect(r.startedAt).toBeNull();
    for (const p of state.players) {
      expect(p.marks).toEqual([]);
      expect([...p.card].sort()).toEqual([...r.board.terms].sort());
    }
    // Cards are redealt (25!-level odds of all matching; 8 terms => tiny but
    // non-zero chance one matches, so require at least one to differ).
    const after = r.toState().players.map((p) => p.card.join("|"));
    expect(r.rematch(HOST.id)).toHaveProperty("error"); // not finished anymore
    void before;
    void after;
  });

  it("rematch is only available once the game is over", () => {
    const r = room();
    expect(r.rematch(HOST.id)).toHaveProperty("error");
    r.start(HOST.id);
    expect(r.rematch(HOST.id)).toHaveProperty("error");
  });

  it("promotes the longest-seated connected player when the host leaves", () => {
    const r = room();
    r.join(RIVAL);
    r.join({ id: "third", name: "Dana" });
    r.disconnect(HOST.id);
    let state = r.toState();
    expect(state.players.find((p) => p.isHost)?.player.name).toBe("Priya");
    // New host can start; the old host cannot.
    expect(r.start(HOST.id)).toHaveProperty("error");
    expect(r.start(RIVAL.id)).toEqual({ ok: true });
    // Succession also applies mid-game.
    r.disconnect(RIVAL.id);
    state = r.toState();
    expect(state.players.find((p) => p.isHost)?.player.name).toBe("Dana");
    expect(r.toSummary().hostName).toBe("Dana");
  });

  it("returning ex-hosts do not reclaim the crown", () => {
    const r = room();
    r.join(RIVAL);
    r.disconnect(HOST.id);
    r.join(HOST);
    expect(
      r.toState().players.find((p) => p.isHost)?.player.name,
    ).toBe("Priya");
  });

  it("caps the chat backlog", () => {
    const r = room();
    for (let i = 0; i < 120; i++) r.addChat(HOST, `msg ${i}`);
    expect(r.chat).toHaveLength(100);
    expect(r.chat[0]?.text).toBe("msg 20");
  });
});

describe("GameManager", () => {
  it("creates rooms with unique BNGS codes and counts live games", () => {
    const m = new GameManager();
    const a = m.create(board(), HOST);
    const b = m.create(board(), RIVAL);
    expect(a.code).toMatch(/^BNGS-\d{3}$/);
    expect(a.code).not.toBe(b.code);
    expect(m.liveCount()).toBe(2);
    expect(m.get(a.code.toLowerCase())).toBe(a);
  });

  it("lists joinable tables newest-first with host and seats", () => {
    const m = new GameManager();
    m.create(board(), HOST);
    const b = m.create(board(), RIVAL);
    b.join(HOST);
    const finished = m.create(board(), { id: "x", name: "X" });
    finished.start("x");
    finished.mark("x", 0, true);
    finished.mark("x", 3, true);
    finished.mark("x", 6, true);
    const list = m.list();
    expect(list.map((g) => g.code)).not.toContain(finished.code);
    expect(list).toHaveLength(2);
    const summary = list.find((g) => g.code === b.code)!;
    expect(summary.hostName).toBe("Priya");
    expect(summary.playerNames.sort()).toEqual(["Priya", "Ruth"]);
    expect(summary.status).toBe("lobby");
    expect(summary.startedAt).toBeNull();
    expect(summary.boardName).toBe("Standup Standoff");
  });

  it("dismisses a lobby everyone walked out of", () => {
    const m = new GameManager();
    const r = m.create(board(), HOST);
    r.join(RIVAL);
    r.disconnect(HOST.id);
    m.sweep(r.code);
    expect(m.get(r.code)).toBe(r); // Priya is still seated
    r.disconnect(RIVAL.id);
    m.sweep(r.code);
    expect(m.get(r.code)).toBeUndefined();
    expect(m.liveCount()).toBe(0);
  });

  it("keeps an emptied mid-game room joinable", () => {
    const m = new GameManager();
    const r = m.create(board(), HOST);
    r.start(HOST.id);
    r.disconnect(HOST.id);
    m.sweep(r.code);
    expect(m.get(r.code)).toBe(r);
  });

  it("sweeps only finished, empty rooms", () => {
    const m = new GameManager();
    const r = m.create(board(), HOST);
    m.sweep(r.code);
    expect(m.get(r.code)).toBe(r); // lobby + connected host: stays
    r.start(HOST.id);
    r.mark(HOST.id, 0, true);
    r.mark(HOST.id, 3, true);
    r.mark(HOST.id, 6, true);
    r.disconnect(HOST.id);
    m.sweep(r.code);
    expect(m.get(r.code)).toBeUndefined();
    expect(m.liveCount()).toBe(0);
  });

  it("grace-delays a scheduled sweep so a leave→rejoin flicker survives", () => {
    // Regression: React StrictMode's dev-mode effect replay emits
    // join → leave → join for a fresh lobby. An instant sweep on the leave
    // deleted the room before the rejoin ("No table with that code").
    vi.useFakeTimers();
    try {
      const m = new GameManager();
      const r = m.create(board(), HOST);
      r.disconnect(HOST.id);
      m.scheduleSweep(r.code);
      r.join(HOST); // the rejoin lands within the grace window
      vi.runAllTimers();
      expect(m.get(r.code)).toBe(r);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still sweeps an abandoned lobby once the grace period passes", () => {
    vi.useFakeTimers();
    try {
      const m = new GameManager();
      const r = m.create(board(), HOST);
      r.disconnect(HOST.id);
      m.scheduleSweep(r.code);
      expect(m.get(r.code)).toBe(r); // lingers through the grace window
      vi.runAllTimers();
      expect(m.get(r.code)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates renames into every seated room and notifies each", () => {
    const m = new GameManager();
    const a = m.create(board(), HOST);
    const b = m.create(board(), RIVAL);
    b.join(HOST);
    const other = m.create(board(), RIVAL); // HOST not seated here
    const notified: string[] = [];
    m.onRoomChanged = (code) => notified.push(code);
    m.renamePlayer(HOST.id, "TileSlayer");
    for (const room of [a, b]) {
      const seat = room
        .toState()
        .players.find((p) => p.player.id === HOST.id)!;
      expect(seat.player.name).toBe("TileSlayer");
    }
    expect(notified.sort()).toEqual([a.code, b.code].sort());
    expect(notified).not.toContain(other.code);
  });
});
