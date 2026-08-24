import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AdminPlayer, Board, BoardSize, Player } from "@bingus/shared";
import { generateOneTimeCode, hashPassword, verifyPassword } from "./passwords.ts";

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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_players_token ON players (token);
    CREATE TABLE IF NOT EXISTS boards (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      size       INTEGER NOT NULL,
      terms      TEXT NOT NULL, -- JSON array of strings
      created_by TEXT NOT NULL REFERENCES players (id),
      plays      INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_boards_created_at ON boards (created_at);
  `);
  // Pre-auth databases exist in the wild; CREATE TABLE IF NOT EXISTS silently
  // skips them, so column additions must be their own idempotent step.
  // NULL password_hash = "cannot log in until an admin issues a code";
  // needs_password_reset defaults to 1 so every pre-auth player is gated.
  ensureColumn(db, "players", "password_hash", "password_hash TEXT");
  ensureColumn(
    db,
    "players",
    "needs_password_reset",
    "needs_password_reset INTEGER NOT NULL DEFAULT 1",
  );
  ensureColumn(db, "players", "is_admin", "is_admin INTEGER NOT NULL DEFAULT 0");
  return db;
}

function ensureColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  ddl: string,
) {
  const cols = db
    .prepare("SELECT name FROM pragma_table_info(?)")
    .all(table) as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

interface PlayerRow {
  id: string;
  name: string;
  token: string;
  needs_password_reset: number;
  is_admin: number;
}

/** A resolved session: the public player plus the private, never-broadcast flags. */
export interface AuthedPlayer {
  player: Player;
  token: string;
  needsPasswordReset: boolean;
  isAdmin: boolean;
}

const PLAYER_SELECT =
  "SELECT id, name, token, needs_password_reset, is_admin FROM players";

function rowToAuthed(row: PlayerRow): AuthedPlayer {
  return {
    player: { id: row.id, name: row.name },
    token: row.token,
    needsPasswordReset: row.needs_password_reset === 1,
    isAdmin: row.is_admin === 1,
  };
}

export class PlayersRepo {
  constructor(private db: DatabaseSync) {}

  /**
   * Provision an account under a unique name (admin flow). The one-time code
   * is the player's first password — only its hash is stored, and the caller
   * shows the plaintext exactly once. Returns "name_taken" on collision.
   */
  provision(
    name: string,
  ): { player: Player; oneTimeCode: string } | "name_taken" {
    const player: Player = { id: randomUUID(), name };
    const oneTimeCode = generateOneTimeCode();
    try {
      this.db
        .prepare(
          `INSERT INTO players (id, name, token, password_hash, needs_password_reset)
           VALUES (?, ?, ?, ?, 1)`,
        )
        .run(player.id, player.name, randomUUID(), hashPassword(oneTimeCode));
    } catch (err) {
      if (isUniqueViolation(err)) return "name_taken";
      throw err;
    }
    return { player, oneTimeCode };
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM players").get() as {
      n: number;
    };
    return row.n;
  }

  get(id: string): AuthedPlayer | undefined {
    const row = this.db
      .prepare(`${PLAYER_SELECT} WHERE id = ?`)
      .get(id) as PlayerRow | undefined;
    return row && rowToAuthed(row);
  }

  /** Resolve a session token to a player — the ghost-session gate. */
  getByToken(token: string): AuthedPlayer | undefined {
    const row = this.db
      .prepare(`${PLAYER_SELECT} WHERE token = ?`)
      .get(token) as PlayerRow | undefined;
    return row && rowToAuthed(row);
  }

  /** Case-insensitive name lookup (NOCASE collation on the column). */
  findByName(
    name: string,
  ): (AuthedPlayer & { hasPassword: boolean }) | undefined {
    const row = this.db
      .prepare(
        "SELECT id, name, token, needs_password_reset, is_admin, password_hash FROM players WHERE name = ?",
      )
      .get(name) as (PlayerRow & { password_hash: string | null }) | undefined;
    return row && { ...rowToAuthed(row), hasPassword: row.password_hash !== null };
  }

  /**
   * Check credentials and, on success, rotate the session token — logging in
   * anywhere kills every other session for the player (one token per player).
   */
  verifyLogin(name: string, password: string): AuthedPlayer | undefined {
    const row = this.db
      .prepare(
        "SELECT id, name, token, needs_password_reset, is_admin, password_hash FROM players WHERE name = ?",
      )
      .get(name) as (PlayerRow & { password_hash: string | null }) | undefined;
    if (!row || row.password_hash === null) {
      // Burn a comparable amount of time so an unknown name isn't
      // distinguishable from a wrong password by the clock.
      verifyPassword(password, hashPassword("timing-decoy"));
      return undefined;
    }
    if (!verifyPassword(password, row.password_hash)) return undefined;
    const token = randomUUID();
    this.db.prepare("UPDATE players SET token = ? WHERE id = ?").run(token, row.id);
    return { ...rowToAuthed(row), token };
  }

  /** Set a real password and lift the reset gate. */
  setPassword(id: string, password: string): void {
    this.db
      .prepare(
        "UPDATE players SET password_hash = ?, needs_password_reset = 0 WHERE id = ?",
      )
      .run(hashPassword(password), id);
  }

  /**
   * Re-issue a one-time code (the locked-out-friend rescue). Overwrites the
   * password, re-arms the reset gate, and rotates the token so any live
   * session for the account dies at its next request.
   */
  reissueCode(id: string): { oneTimeCode: string } | undefined {
    if (!this.get(id)) return undefined;
    const oneTimeCode = generateOneTimeCode();
    this.db
      .prepare(
        "UPDATE players SET password_hash = ?, needs_password_reset = 1, token = ? WHERE id = ?",
      )
      .run(hashPassword(oneTimeCode), randomUUID(), id);
    return { oneTimeCode };
  }

  /** Invalidate the current session token (logout). */
  rotateToken(id: string): void {
    this.db
      .prepare("UPDATE players SET token = ? WHERE id = ?")
      .run(randomUUID(), id);
  }

  setAdmin(id: string): void {
    this.db.prepare("UPDATE players SET is_admin = 1 WHERE id = ?").run(id);
  }

  /** The admin roster — oldest account first. */
  listAll(): AdminPlayer[] {
    const rows = this.db
      .prepare(
        "SELECT id, name, needs_password_reset, is_admin, created_at FROM players ORDER BY created_at, rowid",
      )
      .all() as (Omit<PlayerRow, "token"> & { created_at: string })[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      needsPasswordReset: row.needs_password_reset === 1,
      isAdmin: row.is_admin === 1,
      createdAt: row.created_at,
    }));
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

interface BoardRow {
  id: string;
  name: string;
  size: number;
  terms: string;
  created_by: string;
  created_by_name: string;
  plays: number;
  created_at: string;
}

function rowToBoard(row: BoardRow): Board {
  return {
    id: row.id,
    name: row.name,
    size: row.size as BoardSize,
    terms: JSON.parse(row.terms) as string[],
    createdBy: row.created_by_name,
    plays: row.plays,
    createdAt: row.created_at,
  };
}

const BOARD_SELECT = `
  SELECT b.id, b.name, b.size, b.terms, b.created_by, b.plays, b.created_at,
         p.name AS created_by_name
  FROM boards b JOIN players p ON p.id = b.created_by
`;

export class BoardsRepo {
  constructor(private db: DatabaseSync) {}

  create(
    input: { name: string; size: BoardSize; terms: string[] },
    createdByPlayerId: string,
  ): Board {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO boards (id, name, size, terms, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.size,
        JSON.stringify(input.terms),
        createdByPlayerId,
        createdAt,
      );
    const row = this.db
      .prepare(`${BOARD_SELECT} WHERE b.id = ?`)
      .get(id) as unknown as BoardRow;
    return rowToBoard(row);
  }

  /** Newest first, optionally filtered by a case-insensitive name search. */
  list(query: { search?: string; limit: number; offset: number }): {
    boards: Board[];
    total: number;
  } {
    const filter = query.search ? "WHERE b.name LIKE ? ESCAPE '\\'" : "";
    const params = query.search
      ? [`%${query.search.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`]
      : [];
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM boards b ${filter}`)
        .get(...params) as { n: number }
    ).n;
    const rows = this.db
      .prepare(
        `${BOARD_SELECT} ${filter} ORDER BY b.created_at DESC, b.rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, query.limit, query.offset) as unknown as BoardRow[];
    return { boards: rows.map(rowToBoard), total };
  }

  /** One board plus its creator's player id (for ownership checks). */
  get(id: string): { board: Board; createdById: string } | undefined {
    const row = this.db
      .prepare(`${BOARD_SELECT} WHERE b.id = ?`)
      .get(id) as unknown as BoardRow | undefined;
    return row && { board: rowToBoard(row), createdById: row.created_by };
  }

  update(
    id: string,
    input: { name: string; size: BoardSize; terms: string[] },
  ): Board {
    this.db
      .prepare("UPDATE boards SET name = ?, size = ?, terms = ? WHERE id = ?")
      .run(input.name, input.size, JSON.stringify(input.terms), id);
    const row = this.db
      .prepare(`${BOARD_SELECT} WHERE b.id = ?`)
      .get(id) as unknown as BoardRow;
    return rowToBoard(row);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM boards WHERE id = ?").run(id);
  }

  incrementPlays(id: string): void {
    this.db.prepare("UPDATE boards SET plays = plays + 1 WHERE id = ?").run(id);
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM boards").get() as {
      n: number;
    };
    return row.n;
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
