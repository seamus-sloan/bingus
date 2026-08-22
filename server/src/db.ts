import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Board, BoardSize, Player } from "@bingus/shared";

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

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM players").get() as {
      n: number;
    };
    return row.n;
  }

  get(id: string): { player: Player; token: string } | undefined {
    const row = this.db
      .prepare("SELECT id, name, token FROM players WHERE id = ?")
      .get(id) as PlayerRow | undefined;
    return row && { player: { id: row.id, name: row.name }, token: row.token };
  }

  /** Resolve a session token to a player — the ghost-session gate. */
  getByToken(token: string): { player: Player; token: string } | undefined {
    const row = this.db
      .prepare("SELECT id, name, token FROM players WHERE token = ?")
      .get(token) as PlayerRow | undefined;
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
        `${BOARD_SELECT} ${filter} ORDER BY b.created_at DESC, b.id LIMIT ? OFFSET ?`,
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
