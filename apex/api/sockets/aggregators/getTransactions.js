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
      // No recipient address
      if(t.code) {
	        return "Contract";  // Contract creation (has code)
      } else {
	        return "PrivateTX";  // No code, no recipient
      }
  }
  else if(t.func_name || t.code) {
	  return "FunctionCall";  // Calling a function or sending code to existing contract
  }
  else {
	  return "Transfer";  // Simple value transfer
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
