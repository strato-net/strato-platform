import { useWebSocket } from 'react-use-websocket/dist/lib/use-websocket';

function constructEndpoint() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const port = window.location.port ? ':' + window.location.port : '';
  return wsProtocol + '//' + window.location.hostname + port + '/eventstream';
}

export function useEventStream(filterFunc = null) {
  // console.log(constructEndpoint()); // todelete: for debugging
  // create pinger
  const { sendMessage } = useWebSocket(constructEndpoint(), { share: true });

  return useWebSocket(constructEndpoint(), {
    share: true,
    filter: filterPongs.bind(this, filterFunc),
    retryOnError: true,
    onOpen: handleOpen.bind(this, sendMessage),
    onClose: handleClose,
  });
}

let numWebsockets = 0;
let intervalID = null;
// as long as there is at least 1 frontend component using a websocket,
// we need one in the background to send constant pings to keep the connection alive
function handleOpen(sendFunc) {
  numWebsockets++;
  if (intervalID === null) {
    intervalID = setInterval(sendPing, 50 * 1000, sendFunc);
  }
}

function sendPing(sendFunc) {
  sendFunc('ping');
}

function handleClose() {
  if (numWebsockets > 0) {
    numWebsockets--;
  }
  if (numWebsockets === 0) {
    clearInterval(intervalID); // no more pinging
    intervalID = null;
  }
}

function filterPongs(otherFilterFunc, msg) {
  return msg.data !== 'pong' && otherFilterFunc(msg);
}
