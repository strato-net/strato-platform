import { useWebSocket } from 'react-use-websocket/dist/lib/use-websocket';
import { useCallback } from 'react';

function constructEndpoint() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const port = window.location.port ? ':' + window.location.port : '';
  return wsProtocol + '//' + window.location.hostname + port + '/eventstream';
}

export function useEventStream(filterFunc = null) {
  const filterPongs = useCallback(
    (msg) => msg.data !== 'pong' && (filterFunc ? filterFunc(msg) : true),
    [filterFunc]
  );

  const { sendMessage, lastMessage, readyState } = useWebSocket(
    constructEndpoint(),
    {
      share: true,
      filter: filterPongs,
      retryOnError: true,
      onOpen: () => handleOpen(sendMessage),
      onClose: handleClose,
    }
  );

  return { sendMessage, lastMessage, readyState };
}

let numWebsockets = 0;
let intervalID = null;

function handleOpen(sendMessage) {
  console.log('WebSocket connected!!!');
  numWebsockets++;
  if (!intervalID) {
    intervalID = setInterval(() => sendPing(sendMessage), 50 * 1000);
  }
}

function sendPing(sendMessage) {
  sendMessage('ping');
}

function handleClose() {
  numWebsockets = Math.max(0, numWebsockets - 1);
  if (numWebsockets === 0) {
    clearInterval(intervalID);
    intervalID = null;
  }
}