import {
  freeIndex,
  GAME_MAX_PLAYERS,
  type Board,
  type ChatMessage,
  type GamePlayer,
  type GameState,
  type GameStatus,
  type GameSummary,
  type GameWinner,
  type Player,
} from "@bingus/shared";

// Live game tables. Everything lives in memory on the single server process
// (see docs/architecture.md) — the board archive is the only persisted part.

const CHAT_BACKLOG = 100;

interface PlayerState {
  player: Player;
  card: string[]; // board terms in this player's order (FREE tile omitted)
  marks: Set<number>;
  connected: boolean;
  isHost: boolean;
}

export type MarkResult =
  | { ok: true }
  | { error: "not_playing" | "bad_cell" | "not_in_game" };

export class GameRoom {
  status: GameStatus = "lobby";
  winner: GameWinner | null = null;
  chat: ChatMessage[] = [];
  readonly createdAt = new Date().toISOString();
  startedAt: string | null = null;
  private players = new Map<string, PlayerState>();

  constructor(
    readonly code: string,
    readonly board: Board,
    readonly hostId: string,
  ) {}

  /** Add (or reconnect) a player. New players get a freshly shuffled card. */
  join(player: Player): { ok: true } | { error: string } {
    const existing = this.players.get(player.id);
    if (existing) {
      existing.connected = true;
      existing.player = player; // pick up renames
      return { ok: true };
    }
    if (this.players.size >= GAME_MAX_PLAYERS) {
      return { error: "Table's full — eight is the legal limit." };
    }
    this.players.set(player.id, {
      player,
      card: shuffled(this.board.terms),
      marks: new Set(),
      connected: true,
      isHost: player.id === this.hostId,
    });
    return { ok: true };
  }

  disconnect(playerId: string): void {
    const p = this.players.get(playerId);
    if (p) p.connected = false;
  }

  /** Refresh a seated player's name (profile renames mid-game). */
  renamePlayer(playerId: string, name: string): boolean {
    const p = this.players.get(playerId);
    if (!p) return false;
    p.player = { ...p.player, name };
    return true;
  }

  get empty(): boolean {
    return [...this.players.values()].every((p) => !p.connected);
  }

  start(byPlayerId: string): { ok: true } | { error: string } {
    if (byPlayerId !== this.hostId)
      return { error: "Only the host starts the game." };
    if (this.status !== "lobby")
      return { error: "This game already started." };
    this.status = "playing";
    this.startedAt = new Date().toISOString();
    return { ok: true };
  }

  /** Run it back: fresh cards for every seat, back to the lobby. */
  rematch(byPlayerId: string): { ok: true } | { error: string } {
    if (!this.players.has(byPlayerId))
      return { error: "You're not at this table." };
    if (this.status !== "finished")
      return { error: "This game isn't over yet." };
    for (const seat of this.players.values()) {
      seat.card = shuffled(this.board.terms);
      seat.marks.clear();
    }
    this.winner = null;
    this.startedAt = null;
    this.status = "lobby";
    return { ok: true };
  }

  mark(playerId: string, cell: number, marked: boolean): MarkResult {
    const p = this.players.get(playerId);
    if (!p) return { error: "not_in_game" };
    if (this.status !== "playing") return { error: "not_playing" };
    const cells = this.board.size * this.board.size;
    if (
      !Number.isInteger(cell) ||
      cell < 0 ||
      cell >= cells ||
      cell === freeIndex(this.board.size)
    ) {
      return { error: "bad_cell" };
    }
    if (marked) p.marks.add(cell);
    else p.marks.delete(cell);
    if (marked) this.checkWin(playerId, p);
    return { ok: true };
  }

  addChat(player: Player, text: string): ChatMessage {
    const message: ChatMessage = {
      player,
      text,
      at: new Date().toISOString(),
    };
    this.chat.push(message);
    if (this.chat.length > CHAT_BACKLOG) this.chat.shift();
    return message;
  }

  toSummary(): GameSummary {
    return {
      code: this.code,
      boardName: this.board.name,
      size: this.board.size,
      hostName: this.players.get(this.hostId)?.player.name ?? "a mystery host",
      status: this.status === "finished" ? "playing" : this.status,
      playerNames: [...this.players.values()].map((p) => p.player.name),
      createdAt: this.createdAt,
      startedAt: this.startedAt,
    };
  }

  toState(): GameState {
    return {
      code: this.code,
      board: {
        id: this.board.id,
        name: this.board.name,
        size: this.board.size,
      },
      status: this.status,
      players: [...this.players.values()].map(
        (p): GamePlayer => ({
          player: p.player,
          card: p.card,
          marks: [...p.marks].sort((a, b) => a - b),
          connected: p.connected,
          isHost: p.isHost,
        }),
      ),
      winner: this.winner,
    };
  }

  private checkWin(playerId: string, p: PlayerState): void {
    const size = this.board.size;
    const free = freeIndex(size);
    const has = (cell: number) => cell === free || p.marks.has(cell);
    const lines: number[][] = [];
    for (let r = 0; r < size; r++)
      lines.push(Array.from({ length: size }, (_, c) => r * size + c));
    for (let c = 0; c < size; c++)
      lines.push(Array.from({ length: size }, (_, r) => r * size + c));
    lines.push(Array.from({ length: size }, (_, i) => i * size + i));
    lines.push(Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)));

    const rows = size,
      cols = size;
    const winningLine = lines.find((line) => line.every(has));
    if (winningLine) {
      const idx = lines.indexOf(winningLine);
      const pattern =
        idx < rows ? "row" : idx < rows + cols ? "column" : "diagonal";
      this.finish(playerId, pattern, winningLine);
      return;
    }
    const all = size * size;
    let markedAll = true;
    for (let i = 0; i < all; i++) if (!has(i)) markedAll = false;
    if (markedAll) this.finish(playerId, "blackout", []);
  }

  private finish(
    playerId: string,
    pattern: GameWinner["pattern"],
    line: number[],
  ): void {
    this.status = "finished";
    this.winner = { playerId, pattern, line };
  }
}

export class GameManager {
  private games = new Map<string, GameRoom>();

  /** Set by the socket layer so out-of-band room changes (e.g. renames via
   * REST) still reach everyone at the table. */
  onRoomChanged: ((code: string) => void) | null = null;

  /** Propagate a profile rename into every room the player is seated at. */
  renamePlayer(playerId: string, name: string): void {
    for (const room of this.games.values()) {
      if (room.renamePlayer(playerId, name)) {
        this.onRoomChanged?.(room.code);
      }
    }
  }

  /** Open a table for a board. Returns the join code. */
  create(board: Board, host: Player): GameRoom {
    let code: string;
    do {
      code = `BNGS-${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
    } while (this.games.has(code));
    const room = new GameRoom(code, board, host.id);
    room.join(host);
    this.games.set(code, room);
    return room;
  }

  get(code: string): GameRoom | undefined {
    return this.games.get(code.toUpperCase());
  }

  /** Drop a room nobody can come back to (finished and fully disconnected). */
  sweep(code: string): void {
    const room = this.games.get(code);
    if (room && room.status === "finished" && room.empty)
      this.games.delete(code);
  }

  liveCount(): number {
    return [...this.games.values()].filter((g) => g.status !== "finished")
      .length;
  }

  /** Joinable tables (lobby + playing), newest first. */
  list(): GameSummary[] {
    return [...this.games.values()]
      .filter(
        (g): g is GameRoom & { status: "lobby" | "playing" } =>
          g.status !== "finished",
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((g) => g.toSummary());
  }
}

function shuffled<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
