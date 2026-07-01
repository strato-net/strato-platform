import { useEffect, useState } from "react";
import { getSocket, type Room } from "@/lib/socket";

/**
 * Subscribe to an apex websocket room and return its latest payload.
 * Emits SUBSCRIBE/<room>, listens for PRELOAD_<room> + EVENT_<room>, and
 * UNSUBSCRIBE/<room>s on unmount.
 */
export function useSocketRoom<T>(room: Room, initial: T): T {
  const [data, setData] = useState<T>(initial);

  useEffect(() => {
    const socket = getSocket();
    const onPreload = (payload: T) => setData(payload);
    const onEvent = (payload: T) => setData(payload);

    socket.on(`PRELOAD_${room}`, onPreload);
    socket.on(`EVENT_${room}`, onEvent);

    const subscribe = () => socket.emit(`SUBSCRIBE/${room}`);
    if (socket.connected) subscribe();
    socket.on("connect", subscribe);

    return () => {
      socket.emit(`UNSUBSCRIBE/${room}`);
      socket.off(`PRELOAD_${room}`, onPreload);
      socket.off(`EVENT_${room}`, onEvent);
      socket.off("connect", subscribe);
    };
  }, [room]);

  return data;
}
