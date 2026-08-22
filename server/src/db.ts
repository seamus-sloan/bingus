import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Player } from "@bingus/shared";

// node:sqlite is still marked experimental by Node, but the surface we use
// (exec/prepare/get/run) is tiny — swap the driver here if it ever shifts.

export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      token      TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    ) STRICT;
  `);
  return db;
}

interface PlayerRow {
  id: string;
  name: string;
  token: string;
}

export class PlayersRepo {
  constructor(private db: DatabaseSync) {}

  /** Claim a unique name. Returns "name_taken" if it's already in use. */
  create(name: string): { player: Player; token: string } | "name_taken" {
    const player: Player = { id: randomUUID(), name };
    const token = randomUUID();
    try {
      this.db
        .prepare("INSERT INTO players (id, name, token) VALUES (?, ?, ?)")
        .run(player.id, player.name, token);
    } catch (err) {
      if (isUniqueViolation(err)) return "name_taken";
      throw err;
    }
    return { player, token };
  }

  get(id: string): { player: Player; token: string } | undefined {
    const row = this.db
      .prepare("SELECT id, name, token FROM players WHERE id = ?")
      .get(id) as PlayerRow | undefined;
    return row && { player: { id: row.id, name: row.name }, token: row.token };
  }

  /** Rename a player. Returns "name_taken" if another player has the name. */
  rename(id: string, name: string): Player | "name_taken" {
    try {
      this.db
        .prepare("UPDATE players SET name = ? WHERE id = ?")
        .run(name, id);
    } catch (err) {
      if (isUniqueViolation(err)) return "name_taken";
      throw err;
    }
    return { id, name };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    "errcode" in err &&
    // SQLITE_CONSTRAINT_UNIQUE (2067)
    (err as { errcode?: number }).errcode === 2067
  );
}
