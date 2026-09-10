import { io, type Socket } from "socket.io-client";

// Singleton connection to the apex websocket (socket.io v4, served at /apex-ws).
// Rooms are subscribed via `SUBSCRIBE/<room>` and deliver `PRELOAD_<room>` (initial)
// then `EVENT_<room>` (updates).
let _socket: Socket | null = null;

export function getSocket(): Socket {
  if (!_socket) {
    _socket = io({ path: "/apex-ws", transports: ["websocket"] });
  }
  return _socket;
}

export const ROOMS = {
  LAST_BLOCK_NUMBER: "LAST_BLOCK_NUMBER",
  USERS_COUNT: "USERS_COUNT",
  CONTRACTS_COUNT: "CONTRACTS_COUNT",
  TRANSACTIONS_COUNT: "TRANSACTIONS_COUNT",
  TRANSACTIONS_TYPE: "TRANSACTIONS_TYPE",
  BLOCKS_PROPAGATION: "BLOCKS_PROPAGATION",
  BLOCKS_DIFFICULTY: "BLOCKS_DIFFICULTY",
  GET_TRANSACTIONS: "GET_TRANSACTIONS",
  GET_HEALTH: "GET_HEALTH",
  GET_NODE_UPTIME: "GET_NODE_UPTIME",
  GET_SYSTEM_INFO: "GET_SYSTEM_INFO",
  GET_NETWORK_HEALTH: "GET_NETWORK_HEALTH",
  GET_PEERS: "GET_PEERS",
} as const;

export type Room = (typeof ROOMS)[keyof typeof ROOMS];
