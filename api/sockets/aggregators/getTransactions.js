const _ = require('underscore');
const { GET_TRANSACTIONS } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
var rp = require('request-promise');
const config = require('../../config/app.config')
const Transaction= require('../models/eth/transaction')

let transactions

function getTransactions() {
  Transaction
    .findAll(
      {
        raw: true, 
        limit: 15, 
        order: [['id', 'DESC']] 
      }
    ).then(function (currentTransactions) {
      console.log(currentTransactions);
      currentTransactions.forEach(t => { t.hash = t.tx_hash });
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
