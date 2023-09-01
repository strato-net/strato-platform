import { Kafka } from 'kafkajs';
import WebSocket, { WebSocketServer } from 'ws';

const kafka = new Kafka({
    clientId: 'newsie',
    brokers: ['kafka:9092']
})

const consumer = kafka.consumer({ groupId: 'newsies' })

async function bootstrapWebsocketToExpress(expressServer) {
    // create websocket server and add on to express server
    const websocketServer = new WebSocketServer({
        noServer: true,
        path: '/eventstream' // todo: better name?
    });

    expressServer.on('upgrade', (request, socket, head) => {
        websocketServer.handleUpgrade(request, socket, head,
            () => {
                console.log("established websocket connection with client")
            })
    })

    // set up kafka consumer
    await consumer.connect()
    await consumer.subscribe({topic: 'solidvmevents'})

    await consumer.run({
        eachMessage: async ({_topic, _partition, message}) => {
            websocketServer.clients.forEach((client) => {
                if (client.readyState == WebSocket.OPEN) {
                    client.send(message.value.toString());
                    console.log("Sent kafka msg to client");
                }
            })
            console.log("Received the following kafka msg ", message.value)
        }
    })


    return websocketServer;
}

export default bootstrapWebsocketToExpress