import { PlayerNameSchema } from "@bingus/shared";
import type { PlayersRepo } from "./db.ts";

// BINGUS_ADMIN startup hook: make sure the named player exists, is an admin,
// and can actually log in. Runs on every boot and is idempotent — a code is
// only minted when the account is new or has no password (which covers
// databases that predate auth entirely, where even the admin's own row has a
// NULL hash and nobody could ever provision anyone).

export type BootstrapResult =
  | { name: string; created: boolean; oneTimeCode?: string }
  | { error: string };

export function bootstrapAdmin(
  players: PlayersRepo,
  rawName: string,
): BootstrapResult {
  const parsed = PlayerNameSchema.safeParse(rawName);
  if (!parsed.success) {
    return {
      error: `BINGUS_ADMIN is not a valid player name: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    };
  }
  const name = parsed.data;

  const existing = players.findByName(name);
  if (!existing) {
    const provisioned = players.provision(name);
    if (provisioned === "name_taken") {
      // Raced with a concurrent insert; treat as pre-existing on next boot.
      return { error: `Could not provision admin "${name}" (name taken).` };
    }
    players.setAdmin(provisioned.player.id);
    return { name, created: true, oneTimeCode: provisioned.oneTimeCode };
  }

  if (!existing.isAdmin) players.setAdmin(existing.player.id);
  if (!existing.hasPassword) {
    const reissued = players.reissueCode(existing.player.id);
    return { name, created: false, oneTimeCode: reissued?.oneTimeCode };
  }
  return { name, created: false };
}
