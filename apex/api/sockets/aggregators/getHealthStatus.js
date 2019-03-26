const { GET_HEALTH, GET_NODE_UPTIME} = require('../rooms');
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker');
const rp = require('request-promise');
const models = require('../../models');
const config = require('../../config/app.config');
const moment = require('moment');
const momentDurationFormat = require('moment-duration-format');

let healthStatus, uptimeDur


async function getHealthStatus() {
    await models.CurrentHealth.findAll({
        attributes: [
            'processName',
            'latestHealthStatus',
            'latestCheckTimestamp',
            'lastFailureTimestamp'
        ]}).then(function (data) {
        if (data.length) {
            let isNotStalled, isHealthy;
            let failureTimeStalled, failureTimeHealth;
            data.forEach(function(element){
                if (element.processName == "HealthStat"){
                    isHealthy = element.latestHealthStatus;
                    failureTimeHealth = element.lastFailureTimestamp;

                } else if (element.processName == "StallStat"){
                    isNotStalled = element.latestHealthStatus;
                    failureTimeStalled = element.lastFailureTimestamp;
                }
            })

            healthStatus = isHealthy && isNotStalled;
            emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_HEALTH, healthStatus);

            const currentTime = Date.now();
            const ms = Math.min(currentTime - failureTimeStalled, current - failureTimeHealth);
            emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_NODE_UPTIME, ms/1000);

        }}).catch(function (err) {
        console.log("getHealthStatus Error:", err);
    });
}

getHealthStatus()
setInterval(getHealthStatus, config.webSockets.dbPollFrequency);

function initialHydrate(socket) {
    socket.emit(`PRELOAD_${GET_HEALTH}`, healthStatus);
    socket.emit(`PRELOAD_${GET_NODE_UPTIME}`, uptimeDur);
}

module.exports = {
    initialHydrate
}

