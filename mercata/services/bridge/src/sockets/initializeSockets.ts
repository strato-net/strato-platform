import { AlchemyWebSocket } from "./alchemyWebSocket";

export async function initializeSockets() {
  try {
    const alchemyWs = new AlchemyWebSocket();
    await alchemyWs.connect();
    console.log("alchemyWs connected");
    return { alchemyWs };
  } catch (error: any) {
    throw error;
  }
}
