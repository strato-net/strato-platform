const _ = require('underscore');
const { TRANSACTIONS_TYPE } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker')
var rp = require('request-promise');
const config = require('../../config/app.config')

let transactionsTypes

const options = {
  uri: `${process.env['stratoRoot']}/block/last/15`,
  json: true
}

function getTransactionsType() {
  rp(options)
    .then(function (data) {

      let receiptTransactions = [];

      _.map(data, function (data) {
        receiptTransactions.push(data.receiptTransactions);
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
    val.forEach(v => { types[v.transactionType]++ });
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

getTransactionsType()
setInterval(getTransactionsType, config.webSockets.dbPollFrequency)

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${TRANSACTIONS_TYPE}`, transactionsTypes);
}

module.exports = {
  initialHydrate
}