const _ = require('underscore');
const { GET_TRANSACTIONS } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
var rp = require('request-promise');
const config = require('../../config/app.config')

const options = {
  uri: `${process.env['stratoRoot']}/transaction/last/15`,
  json: true
}

let transactions

function getTransactions() {
  rp(options)
    .then(function (currentTransactions) {
      if (!_.isEqual(transactions, currentTransactions)) {
        transactions = currentTransactions;
        emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_TRANSACTIONS, currentTransactions)
      }
    })
    .catch(function (err) {
      console.log("err", err);
    });
}

getTransactions()
setInterval(getTransactions, config.webSockets.dbPollFrequency)

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${GET_TRANSACTIONS}`, transactions);
}

module.exports = {
  initialHydrate
}