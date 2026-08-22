import { z } from "zod";

// Wire contract between client and server. Every Socket.IO event and its
// payload is defined here — neither side may invent events locally.

export const PLAYER_NAME_MAX = 24;

export const HelloSchema = z.object({
  name: z.string().trim().min(1).max(PLAYER_NAME_MAX),
});
export type Hello = z.infer<typeof HelloSchema>;

export const WelcomeSchema = z.object({
  playerId: z.string(),
  name: z.string(),
});
export type Welcome = z.infer<typeof WelcomeSchema>;

// Socket.IO typed-event maps (passed as generics to Server / io() on each side).
export interface ClientToServerEvents {
  "session:hello": (hello: Hello, ack: (welcome: Welcome) => void) => void;
}

export interface ServerToClientEvents {
  // Server-initiated events (lobby presence, tile marks, chat…) land here.
}
