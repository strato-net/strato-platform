import { Kafka } from 'kafkajs';
import WebSocket, { WebSocketServer } from 'ws';

const kafka = new Kafka({
  clientId: 'newsie',
  brokers: ['kafka:9092'],
});

const consumer = kafka.consumer({ groupId: 'newsies' });

async function bootstrapWebsocketToExpress(expressServer) {
  // create websocket server and add on to express server
  const websocketServer = new WebSocketServer({
    noServer: true,
    path: '/eventstream', // todo: better name?
  });

  expressServer.on('upgrade', (request, socket, head) => {
    websocketServer.handleUpgrade(request, socket, head, (websocket) =>
      websocketServer.emit('connection', websocket, request)
    );
  });

  websocketServer.on('connection', function handleConnection(wsConnection) {
    wsConnection.on('message', (msg) => {
      if (msg.toString() === 'ping') {
        wsConnection.send('pong');
      }
    });
  });

  try {
    // set up kafka consumer
    await consumer.connect();
    await consumer.subscribe({ topic: 'solidvmevents' });

    await consumer.run({
      eachMessage: async ({ message }) => {
        websocketServer.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message.value.toString());
          }
        });
      },
    });
  } catch (err) {
    console.log('Error while trying to set up or run kafka consumer: ', err);
  }

  return websocketServer;
}

export default bootstrapWebsocketToExpress;
