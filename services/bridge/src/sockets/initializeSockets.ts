import { AlchemyWebSocket } from "./alchemyWebSocket";

export async function initializeSockets() {
  try {
    const alchemyWs = new AlchemyWebSocket();
    await alchemyWs.connect();
    return { alchemyWs };
  } catch (error: any) {
    throw error;
  }
}
