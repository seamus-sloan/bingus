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
// A board is a named set of terms. Every player in a game gets the same
// terms shuffled into their own card; the center tile is a FREE space, so a
// size-n board needs n*n - 1 terms.
//
// GET  /api/boards?search=&limit=&offset= — browse the archive (newest first).
// POST /api/boards — print a fresh board (requires a session).

export const BOARD_SIZES = [3, 4, 5] as const;
export const BoardSizeSchema = z.union([
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type BoardSize = z.infer<typeof BoardSizeSchema>;

export const BOARD_NAME_MAX = 60;
export const TERM_MAX = 80;

/** Terms a board of this size needs (center tile is FREE). */
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
  .refine((b) => b.terms.length === termsRequired(b.size), {
    message: "Term count must match the board size (center tile is free).",
  })
  .refine(
    (b) => new Set(b.terms.map((t) => t.toLowerCase())).size === b.terms.length,
    { message: "No duplicate terms — keep it spicy, keep it varied." },
  );
export type CreateBoardRequest = z.infer<typeof CreateBoardRequestSchema>;

export const CreateBoardResponseSchema = z.object({ board: BoardSchema });
export type CreateBoardResponse = z.infer<typeof CreateBoardResponseSchema>;

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
// never sees or stores the token.
//
// POST /api/players — sign in by claiming a unique name. Sets the cookie.
// GET  /api/me — resolve the cookie to a player. 401 when the cookie is
//   missing or the player no longer exists (a stale "ghost" session).
// PATCH /api/me — rename the signed-in player.

export const CreatePlayerRequestSchema = z.object({ name: PlayerNameSchema });
export type CreatePlayerRequest = z.infer<typeof CreatePlayerRequestSchema>;

export const CreatePlayerResponseSchema = z.object({ player: PlayerSchema });
export type CreatePlayerResponse = z.infer<typeof CreatePlayerResponseSchema>;

export const MeResponseSchema = z.object({ player: PlayerSchema });
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const RenamePlayerRequestSchema = z.object({ name: PlayerNameSchema });
export type RenamePlayerRequest = z.infer<typeof RenamePlayerRequestSchema>;

export const ApiErrorSchema = z.object({
  code: z.enum(["invalid_name", "name_taken", "invalid_board", "unauthorized"]),
  error: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiErrorCode = ApiError["code"];

// --- Socket.IO typed-event maps ------------------------------------------
// Realtime game events (lobby presence, tile marks, chat…) land here as the
// screens that need them are built.

export type ClientToServerEvents = Record<string, never>;

export type ServerToClientEvents = Record<string, never>;
