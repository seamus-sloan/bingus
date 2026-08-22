import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import {
  HelloSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@bingus/shared";

export function attachSocket(httpServer: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

  io.on("connection", (socket) => {
    socket.on("session:hello", (hello, ack) => {
      const parsed = HelloSchema.safeParse(hello);
      if (!parsed.success) {
        socket.disconnect(true);
        return;
      }
      ack({ playerId: randomUUID(), name: parsed.data.name });
    });
  });

  return io;
}
