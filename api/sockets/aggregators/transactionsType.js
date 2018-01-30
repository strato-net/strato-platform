const _ = require('underscore');
const { TRANSACTIONS_TYPE } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
const config = require('../../config/app.config')
const Block= require('../models/eth/block')

let transactionsTypes

function getTransactionsType() {
  Block
    .findAll(
      {
        attributes: [
          'receipt_transactions'
        ],
        raw: true, 
        limit: 15, 
        order: [['id', 'DESC']] 
      }
    ).then(function (data) {

      let receiptTransactions = [];

      _.map(data, function (d) {
        receiptTransactions.push(d.receipt_transactions);
      })

      const currentTxType = extractTxTypes(receiptTransactions);
      if (!_.isEqual(currentTxType, transactionsTypes)) {
        transactionsTypes = currentTxType;
        emitter.emit(ON_SOCKET_PUBLISH_EVENTS, TRANSACTIONS_TYPE, transactionsTypes)
      }

    })
    .catch(function (err) {
      console.log("getTransactionsType Error:", err);
    });
}

function extractTxTypes(receiptTransactions) {
  let types = { "FunctionCall": 0, "Transfer": 0, "Contract": 0 };
  receiptTransactions.forEach(function (val) {
    let val2 = JSON.parse(val);
    val2.forEach(v => { types[parseTransactionType(v)]++ });
  })
  const filtered = _.keys(types)
    .filter((type)=>{
      return types[type] > 0
    })
    .map((type) => {
      return {
        val: types[type],
        type: type
      }
    });
  if(filtered.length === 0) {
    return [{
      val: 0,
      type: "No Transactions"
    }]
  }
  return filtered;
}

function parseTransactionType(v) {
  if(v.transactionTo == 0) {
	  return 2; // Contract Creation
  }
  else if(v.transactionData == "") {
	  return 1; // Transfer
  }
  else {
	  return 0; // Function Call
  }
}

getTransactionsType()
setInterval(getTransactionsType, config.webSockets.dbPollFrequency)

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${TRANSACTIONS_TYPE}`, transactionsTypes);
}

module.exports = {
  initialHydrate
}
