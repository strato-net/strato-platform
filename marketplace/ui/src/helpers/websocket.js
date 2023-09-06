import { useWebSocket } from "react-use-websocket/dist/lib/use-websocket";

function constructEndpoint(){
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:" ;
    const port = window.location.port ? ":" + window.location.port : "" ;
    return wsProtocol + "//" + window.location.hostname + port + "/eventstream" ;
}

export function useEventStream(filterFunc = null) {
    console.log(constructEndpoint()); // todelete: for debugging
    // create pinger
    const { sendMessage } = useWebSocket(constructEndpoint(), {share: true});

    return useWebSocket(constructEndpoint(), {
        share: true,
        filter: filterFunc,
        shouldReconnect: (closeEvent) => {
            console.log("going to reconnect after closeEvent ", closeEvent);
            return true},
        onOpen: handleOpen.bind(this, sendMessage),
        onClose: handleClose,
        onError: (err) => console.log("websocket error: ", err)
    })
} //do i need a cleaning function?

let numWebsockets = 0;
let intervalID = null;
// as long as there is at least 1 frontend component using a websocket, 
// we need one in the background to send constant pings to keep the connection alive
function handleOpen(sendFunc) {
    numWebsockets++;
    console.log("websockets open: ", numWebsockets);
    if(intervalID === null) {
        console.log("about to set up pinger")
        intervalID = setInterval(sendPing, 120 * 1000, sendFunc); //change to 60 sec after test
    } 
}

function sendPing(sendFunc){
    console.log("ping");
    sendFunc("ping");
}

function handleClose() {
    if(numWebsockets > 0) {
        numWebsockets--;
    }
    console.log("closing websocket; left open: ", numWebsockets);
    if(numWebsockets === 0){
        clearInterval(intervalID); // no more pinging
        intervalID = null;
    }
}

