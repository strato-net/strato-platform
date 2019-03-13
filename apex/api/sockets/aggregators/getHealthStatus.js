
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker');
const rp = require('request-promise');
const config = require('../config/app.config');

let healthStatus


async function getHealthStatus() {
    // todo
    emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_HEALTH, healthStatus)

}

getHealthStatus()
setInterval(getHealthStatus, config.webSockets.dbPollFrequency);

function initialHydrate(socket) {
    socket.emit(`PRELOAD_${GET_HEALTH}`, healthStatus);
}

module.exports = {
    initialHydrate
}

