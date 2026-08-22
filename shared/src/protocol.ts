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

// --- REST: stats ---------------------------------------------------------
// GET /api/stats — the Home screen's live numbers. `boards` and `liveGames`
// stay 0 until the board archive and game tables exist.

export const StatsResponseSchema = z.object({
  players: z.number().int().nonnegative(),
  boards: z.number().int().nonnegative(),
  liveGames: z.number().int().nonnegative(),
});
export type StatsResponse = z.infer<typeof StatsResponseSchema>;

// --- REST: players -------------------------------------------------------
// POST /api/players — sign in by claiming a unique name.
// PATCH /api/players/:id — rename (requires `Authorization: Bearer <token>`).

export const CreatePlayerRequestSchema = z.object({ name: PlayerNameSchema });
export type CreatePlayerRequest = z.infer<typeof CreatePlayerRequestSchema>;

export const CreatePlayerResponseSchema = z.object({
  player: PlayerSchema,
  token: z.string(),
});
export type CreatePlayerResponse = z.infer<typeof CreatePlayerResponseSchema>;

export const RenamePlayerRequestSchema = z.object({ name: PlayerNameSchema });
export type RenamePlayerRequest = z.infer<typeof RenamePlayerRequestSchema>;

export const RenamePlayerResponseSchema = z.object({ player: PlayerSchema });
export type RenamePlayerResponse = z.infer<typeof RenamePlayerResponseSchema>;

export const ApiErrorSchema = z.object({
  code: z.enum(["invalid_name", "name_taken", "not_found", "unauthorized"]),
  error: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiErrorCode = ApiError["code"];

// --- Socket.IO typed-event maps ------------------------------------------
// Realtime game events (lobby presence, tile marks, chat…) land here as the
// screens that need them are built.

export type ClientToServerEvents = Record<string, never>;

export type ServerToClientEvents = Record<string, never>;
