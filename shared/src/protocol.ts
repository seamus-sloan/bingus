import { z } from "zod";

// Wire contract between client and server. Every REST payload and Socket.IO
// event is defined here — neither side may invent shapes locally.

export const PLAYER_NAME_MAX = 24;

export const PlayerNameSchema = z
  .string()
  .trim()
  .min(1, "Pick a name first.")
  .max(PLAYER_NAME_MAX, `Keep it under ${PLAYER_NAME_MAX} characters.`);

export const PlayerSchema = z.object({
  id: z.string(),
  name: PlayerNameSchema,
});
export type Player = z.infer<typeof PlayerSchema>;

// --- Boards --------------------------------------------------------------
// A board is a named word bank. Each player's card is dealt from that bank
// server-side: shuffle, then take the first n*n - 1 terms (the center tile is
// a FREE space). A bank of exactly n*n - 1 gives everyone the same terms in a
// different order; a bigger bank makes cards differ in content too, which is
// the point of stocking one.
//
// GET  /api/boards?search=&limit=&offset= — browse the archive (newest first).
// POST /api/boards — print a fresh board (requires a session).
// GET  /api/boards/:id — fetch one board.
// PATCH /api/boards/:id — edit any board (same shape as create). The archive
//   is a shared shelf: every signed-in player may improve someone else's board.
// DELETE /api/boards/:id — permanently delete a board you created.

export const BOARD_SIZES = [3, 4, 5] as const;
export const BoardSizeSchema = z.union([
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type BoardSize = z.infer<typeof BoardSizeSchema>;

export const BOARD_NAME_MAX = 60;
export const TERM_MAX = 80;
/** Ceiling on a board's word bank — deep enough for genuinely varied cards,
 *  shallow enough that the archive row stays a reasonable size. */
export const BOARD_TERMS_MAX = 200;

/**
 * Tiles a card of this size holds, and so the smallest word bank a board can
 * ship with (center tile is FREE). Banks may be larger — see BOARD_TERMS_MAX.
 */
export function termsRequired(size: BoardSize): number {
  return size * size - 1;
}

export const BoardNameSchema = z
  .string()
  .trim()
  .min(1, "Name the board first.")
  .max(BOARD_NAME_MAX, `Keep it under ${BOARD_NAME_MAX} characters.`);

export const BoardTermSchema = z
  .string()
  .trim()
  .min(1)
  .max(TERM_MAX, `Terms max out at ${TERM_MAX} characters.`);

export const BoardSchema = z.object({
  id: z.string(),
  name: BoardNameSchema,
  size: BoardSizeSchema,
  terms: z.array(BoardTermSchema),
  createdBy: z.string(),
  plays: z.number().int().nonnegative(),
  createdAt: z.string(), // ISO 8601
});
export type Board = z.infer<typeof BoardSchema>;

export const ListBoardsQuerySchema = z.object({
  search: z.string().trim().max(BOARD_NAME_MAX).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListBoardsQuery = z.infer<typeof ListBoardsQuerySchema>;

export const ListBoardsResponseSchema = z.object({
  boards: z.array(BoardSchema),
  total: z.number().int().nonnegative(),
});
export type ListBoardsResponse = z.infer<typeof ListBoardsResponseSchema>;

export const CreateBoardRequestSchema = z
  .object({
    name: BoardNameSchema,
    size: BoardSizeSchema,
    terms: z.array(BoardTermSchema),
  })
  .refine((b) => b.terms.length >= termsRequired(b.size), {
    message: "Not enough terms to fill a card (center tile is free).",
  })
  .refine((b) => b.terms.length <= BOARD_TERMS_MAX, {
    message: `A word bank tops out at ${BOARD_TERMS_MAX} terms.`,
  })
  .refine(
    (b) => new Set(b.terms.map((t) => t.toLowerCase())).size === b.terms.length,
    { message: "No duplicate terms — keep it spicy, keep it varied." },
  );
export type CreateBoardRequest = z.infer<typeof CreateBoardRequestSchema>;

export const CreateBoardResponseSchema = z.object({ board: BoardSchema });
export type CreateBoardResponse = z.infer<typeof CreateBoardResponseSchema>;

// Editing reuses the create shape wholesale — any signed-in player may edit
// any board, so the only extra server check is that the board exists.
export const UpdateBoardRequestSchema = CreateBoardRequestSchema;
export type UpdateBoardRequest = CreateBoardRequest;

export const GetBoardResponseSchema = z.object({ board: BoardSchema });
export type GetBoardResponse = z.infer<typeof GetBoardResponseSchema>;

export const DeleteBoardResponseSchema = z.object({ ok: z.literal(true) });
export type DeleteBoardResponse = z.infer<typeof DeleteBoardResponseSchema>;

// --- Games ----------------------------------------------------------------
// A game is a live table for one board. It lives in server memory: created
// via REST, then everything else happens over the socket. Every player is
// dealt their own card from the board's word bank server-side; index
// `freeIndex(size)` is the FREE tile. Marks are self-reported; the server is
// the referee and detects row / column / diagonal / blackout wins.
//
// POST /api/games {boardId} — open a table (host = session player) → {code}.
// GET  /api/games — list joinable tables (lobby + playing, newest first).

export const GAME_CODE_PATTERN = /^BNGS-\d{3}$/;
export const GAME_MAX_PLAYERS = 8;

/** The FREE tile's index in a player's card (center for odd sizes). */
export function freeIndex(size: BoardSize): number {
  return Math.floor((size * size) / 2);
}

export const GameStatusSchema = z.enum(["lobby", "playing", "finished"]);
export type GameStatus = z.infer<typeof GameStatusSchema>;

export const WinPatternSchema = z.enum(["row", "column", "diagonal", "blackout"]);
export type WinPattern = z.infer<typeof WinPatternSchema>;

export const CreateGameRequestSchema = z.object({ boardId: z.string() });
export type CreateGameRequest = z.infer<typeof CreateGameRequestSchema>;

// What the live-tables screen shows per joinable game.
export const GameSummarySchema = z.object({
  code: z.string(),
  boardName: BoardNameSchema,
  size: BoardSizeSchema,
  hostName: z.string(),
  status: z.enum(["lobby", "playing"]),
  playerNames: z.array(z.string()),
  createdAt: z.string(), // ISO 8601
  startedAt: z.string().nullable(),
});
export type GameSummary = z.infer<typeof GameSummarySchema>;

export const ListGamesResponseSchema = z.object({
  games: z.array(GameSummarySchema),
});
export type ListGamesResponse = z.infer<typeof ListGamesResponseSchema>;

export const CreateGameResponseSchema = z.object({ code: z.string() });
export type CreateGameResponse = z.infer<typeof CreateGameResponseSchema>;

// Everything about a player that the whole table can see. Cards are public
// by design — rivals' mini boards and the "peek" feature depend on it.
export const GamePlayerSchema = z.object({
  player: PlayerSchema,
  /** This player's dealt terms in card order (FREE tile omitted — it sits at freeIndex). */
  card: z.array(z.string()),
  /** Marked cell indices (0..size²-1); the FREE tile is always implicitly marked. */
  marks: z.array(z.number().int().nonnegative()),
  connected: z.boolean(),
  isHost: z.boolean(),
});
export type GamePlayer = z.infer<typeof GamePlayerSchema>;

export const GameWinnerSchema = z.object({
  playerId: z.string(),
  pattern: WinPatternSchema,
  /** Winning cell indices (empty for blackout). */
  line: z.array(z.number().int().nonnegative()),
});
export type GameWinner = z.infer<typeof GameWinnerSchema>;

export const GameStateSchema = z.object({
  code: z.string(),
  board: z.object({
    id: z.string(),
    name: BoardNameSchema,
    size: BoardSizeSchema,
  }),
  status: GameStatusSchema,
  players: z.array(GamePlayerSchema),
  winner: GameWinnerSchema.nullable(),
});
export type GameState = z.infer<typeof GameStateSchema>;

export const ChatMessageSchema = z.object({
  player: PlayerSchema,
  text: z.string().trim().min(1).max(300),
  at: z.string(), // ISO 8601
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Ack payload for game:join — full state plus recent chat backlog. */
export interface GameJoinOk {
  state: GameState;
  chat: ChatMessage[];
}
export type GameJoinResult = GameJoinOk | { error: string };
export type GameAck = { ok: true; state: GameState } | { error: string };

// --- REST: stats ---------------------------------------------------------
// GET /api/stats — the Home screen's live numbers. `liveGames` stays 0 until
// game tables exist.

export const StatsResponseSchema = z.object({
  players: z.number().int().nonnegative(),
  boards: z.number().int().nonnegative(),
  liveGames: z.number().int().nonnegative(),
});
export type StatsResponse = z.infer<typeof StatsResponseSchema>;

// --- REST: players & session ---------------------------------------------
// Identity rides in an httpOnly session cookie set by the server; the client
// never sees or stores the token. There is no public registration: an admin
// provisions each account and hands out a one-time code, which the player
// uses as their first password. Until they set a real password the server
// keeps them behind the reset gate (only /api/me and /api/me/password work).
//
// POST /api/login — name + password (or one-time code). Sets the cookie and
//   rotates the session token, so any previous session for the player dies.
// POST /api/logout — rotate the token and clear the cookie.
// GET  /api/me — resolve the cookie to a player. 401 when the cookie is
//   missing or stale. Exempt from the reset gate.
// POST /api/me/password — set a new password; clears needsPasswordReset.
// PATCH /api/me — rename the signed-in player.
// POST /api/players — admin only: provision an account → one-time code.
// GET  /api/players — admin only: list every account.
// POST /api/players/:id/code — admin only: re-issue a one-time code (doubles
//   as a password reset; puts the player back behind the reset gate).

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// No .trim(): passwords keep their whitespace exactly as typed.
export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Keep it under ${PASSWORD_MAX} characters.`);

export const LoginRequestSchema = z.object({
  name: PlayerNameSchema,
  // Any non-empty string: one-time codes are shorter than PASSWORD_MIN, and
  // the real check is the hash comparison server-side.
  password: z.string().min(1, "Enter your code or password."),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const MeResponseSchema = z.object({
  player: PlayerSchema,
  // Private flags live here, never on PlayerSchema — GamePlayerSchema
  // broadcasts PlayerSchema to the whole table. Defaults keep older payloads
  // (and test stubs) parsing.
  needsPasswordReset: z.boolean().default(false),
  isAdmin: z.boolean().default(false),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const LoginResponseSchema = MeResponseSchema;
export type LoginResponse = MeResponse;

export const LogoutResponseSchema = z.object({ ok: z.literal(true) });
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

export const SetPasswordRequestSchema = z.object({ password: PasswordSchema });
export type SetPasswordRequest = z.infer<typeof SetPasswordRequestSchema>;

export const RenamePlayerRequestSchema = z.object({ name: PlayerNameSchema });
export type RenamePlayerRequest = z.infer<typeof RenamePlayerRequestSchema>;

export const ProvisionPlayerRequestSchema = z.object({
  name: PlayerNameSchema,
});
export type ProvisionPlayerRequest = z.infer<
  typeof ProvisionPlayerRequestSchema
>;

export const ProvisionPlayerResponseSchema = z.object({
  player: PlayerSchema,
  /** Shown exactly once — the server stores only its hash. */
  oneTimeCode: z.string(),
});
export type ProvisionPlayerResponse = z.infer<
  typeof ProvisionPlayerResponseSchema
>;

export const ReissueCodeResponseSchema = z.object({ oneTimeCode: z.string() });
export type ReissueCodeResponse = z.infer<typeof ReissueCodeResponseSchema>;

// The admin roster view — flags are fine here because the endpoint itself is
// admin-only.
export const AdminPlayerSchema = z.object({
  id: z.string(),
  name: PlayerNameSchema,
  needsPasswordReset: z.boolean(),
  isAdmin: z.boolean(),
  createdAt: z.string(), // ISO 8601
});
export type AdminPlayer = z.infer<typeof AdminPlayerSchema>;

export const ListPlayersResponseSchema = z.object({
  players: z.array(AdminPlayerSchema),
});
export type ListPlayersResponse = z.infer<typeof ListPlayersResponseSchema>;

export const ApiErrorSchema = z.object({
  code: z.enum([
    "invalid_name",
    "name_taken",
    "invalid_board",
    "not_found",
    "unauthorized",
    "invalid_credentials",
    "password_reset_required",
    "forbidden",
    "invalid_password",
    "rate_limited",
  ]),
  error: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiErrorCode = ApiError["code"];

// --- Socket.IO typed-event maps ------------------------------------------
// The socket authenticates via the session cookie on the handshake; a
// rejected handshake surfaces client-side as a `connect_error` whose message
// is "unauthorized" (no/stale session) or "password_reset_required" (player
// is still behind the reset gate). A socket joins one game room at a time;
// the server broadcasts the full public state on every change (friends-scale
// tables — simplicity beats deltas).

export interface ClientToServerEvents {
  "game:join": (code: string, ack: (result: GameJoinResult) => void) => void;
  "game:start": (ack: (result: GameAck) => void) => void;
  "game:mark": (
    cell: number,
    marked: boolean,
    ack: (result: GameAck) => void,
  ) => void;
  "game:chat": (text: string) => void;
  /** Reset a finished table for another round (any seated player). Fresh
   * shuffled cards for everyone; the room returns to the lobby. */
  "game:rematch": (ack: (result: GameAck) => void) => void;
  "game:leave": () => void;
}

export interface ServerToClientEvents {
  "game:state": (state: GameState) => void;
  "game:chat": (message: ChatMessage) => void;
}
