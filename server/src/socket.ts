import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import {
  ChatMessageSchema,
  type ClientToServerEvents,
  type Player,
  type ServerToClientEvents,
} from "@bingus/shared";
import { SESSION_COOKIE } from "./app.ts";
import type { BoardsRepo, PlayersRepo } from "./db.ts";
import type { GameManager } from "./games.ts";

interface SocketData {
  player: Player;
  gameCode: string | null;
}

// The socket rides the same httpOnly session cookie as REST: the browser
// sends it on the handshake, we resolve it to a player, and unauthenticated
// sockets never connect.
export function attachSocket(
  httpServer: HttpServer,
  deps: { players: PlayersRepo; boards: BoardsRepo; games: GameManager },
) {
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer);

  io.use((socket, next) => {
    const cookies = socket.handshake.headers.cookie ?? "";
    const token = cookies
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
    const me = token ? deps.players.getByToken(token) : undefined;
    if (!me) return next(new Error("unauthorized"));
    socket.data.player = me.player;
    socket.data.gameCode = null;
    next();
  });

  const broadcast = (code: string) => {
    const room = deps.games.get(code);
    if (room) io.to(code).emit("game:state", room.toState());
  };

  // REST-side room changes (profile renames) broadcast through here too.
  deps.games.onRoomChanged = broadcast;

  io.on("connection", (socket) => {
    const leaveCurrent = () => {
      const code = socket.data.gameCode;
      if (!code) return;
      socket.data.gameCode = null;
      void socket.leave(code);
      const room = deps.games.get(code);
      if (!room) return;
      // Only mark disconnected when this was the player's last socket here.
      const stillHere = [...io.of("/").sockets.values()].some(
        (s) =>
          s.id !== socket.id &&
          s.data.player.id === socket.data.player.id &&
          s.data.gameCode === code,
      );
      if (!stillHere) room.disconnect(socket.data.player.id);
      broadcast(code);
      deps.games.sweep(code);
    };

    socket.on("game:join", (code, ack) => {
      if (typeof code !== "string" || typeof ack !== "function") return;
      const room = deps.games.get(code);
      if (!room) {
        ack({ error: "No table with that code. It may have wrapped up." });
        return;
      }
      leaveCurrent();
      room.join(socket.data.player);
      socket.data.gameCode = room.code;
      void socket.join(room.code);
      ack({ state: room.toState(), chat: room.chat });
      broadcast(room.code);
    });

    socket.on("game:start", (ack) => {
      if (typeof ack !== "function") return;
      const code = socket.data.gameCode;
      const room = code ? deps.games.get(code) : undefined;
      if (!room) {
        ack({ error: "You're not at a table." });
        return;
      }
      const result = room.start(socket.data.player.id);
      if ("error" in result) {
        ack(result);
        return;
      }
      deps.boards.incrementPlays(room.board.id);
      ack({ ok: true, state: room.toState() });
      broadcast(room.code);
    });

    socket.on("game:mark", (cell, marked, ack) => {
      if (typeof ack !== "function") return;
      const code = socket.data.gameCode;
      const room = code ? deps.games.get(code) : undefined;
      if (!room) {
        ack({ error: "You're not at a table." });
        return;
      }
      const result = room.mark(socket.data.player.id, cell, marked === true);
      if ("error" in result) {
        ack({ error: "That mark didn't land." });
        return;
      }
      ack({ ok: true, state: room.toState() });
      broadcast(room.code);
    });

    socket.on("game:chat", (text) => {
      const code = socket.data.gameCode;
      const room = code ? deps.games.get(code) : undefined;
      if (!room) return;
      const parsed = ChatMessageSchema.shape.text.safeParse(text);
      if (!parsed.success) return;
      const message = room.addChat(socket.data.player, parsed.data);
      io.to(room.code).emit("game:chat", message);
    });

    socket.on("game:leave", leaveCurrent);
    socket.on("disconnect", leaveCurrent);
  });

  return io;
}
