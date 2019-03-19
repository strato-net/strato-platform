const { GET_HEALTH, GET_NODE_UPTIME} = require('../rooms');
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker');
const rp = require('request-promise');
const models = require('../../models');
const config = require('../../config/app.config');
const moment = require('moment');
const momentDurationFormat = require('moment-duration-format');

let healthStatus, uptimeDur


async function getHealthStatus() {
    // todo
    await models.Stat.findAll({ attributes: ['processName', 'latestHealthStatus', 'latestCheckTimestamp','lastFailureTimestamp']}).then(function (data) {
        if (data.length) {
            let ifStalled, ifHealthy;
            let failureTimeStalled, failureTimeHealth;
            data.forEach(function(element){
                if (element.processName == "Overall"){
                    ifHealthy = element.latestHealthStatus;
                    failureTimeHealth = element.lastFailureTimestamp;

                } else if (element.processName == "Uptime"){
                    ifStalled = element.latestHealthStatus;
                    failureTimeStalled = element.lastFailureTimestamp;
                }
            })

            healthStatus = ifHealthy && ifStalled;
            emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_HEALTH, healthStatus);

            const currentTime = moment();

            const ms = currentTime.diff(moment.max([moment(failureTimeHealth), moment(failureTimeStalled)]))
            uptimeDur = moment.duration(ms).format("YYYY-MM-DD hh:mm:ss")
            emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_NODE_UPTIME, uptimeDur);

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

