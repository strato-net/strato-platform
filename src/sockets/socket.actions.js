export const SOCKET_SUBSCRIBE_ROOM = 'SOCKET_SUBSCRIBE_ROOM'
export const SOCKET_UNSUBSCRIBE_ROOM = 'SOCKET_UNSUBSCRIBE_ROOM'

export const subscribeRoom = function (room) {
  return {
    type: SOCKET_SUBSCRIBE_ROOM,
    name: `SUBSCRIBE/${room}`
  }
}

export const unSubscribeRoom = function (room) {
  return {
    type: SOCKET_UNSUBSCRIBE_ROOM,
    name: `UNSUBSCRIBE/${room}`
  }
}