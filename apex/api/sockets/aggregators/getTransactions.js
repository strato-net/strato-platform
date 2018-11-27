const _ = require('underscore');
const { GET_TRANSACTIONS } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
var rp = require('request-promise');
const config = require('../../config/app.config')
const Transaction= require('../../models/strato/eth/transaction');

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
      currentTransactions.forEach(t => { t.hash = t.tx_hash; t.transactionType = parseTransactionType(t); });
      if (!_.isEqual(transactions, currentTransactions)) {
        transactions = currentTransactions;
        emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_TRANSACTIONS, currentTransactions)
      }
    })
    .catch(function (err) {
      console.log("err", err);
    });
}

function parseTransactionType(t) {
  if(t.to_address == null) {
      if(t.code_or_data.length == 0) {
	        return "PrivateTX";
      } else {
	        return "Contract";
      }
  }
  else if(t.code_or_data.length == 0) {
	  return "Transfer";
  }
  else {
	  return "FunctionCall";
  }
}

getTransactions()
setInterval(getTransactions, config.webSockets.dbPollFrequency)

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${GET_TRANSACTIONS}`, transactions);
}

module.exports = {
  initialHydrate
}
