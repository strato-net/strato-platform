const _ = require('underscore');
const { TRANSACTIONS_TYPE } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroaker')
var rp = require('request-promise');

let transactionsTypes

const options = {
  uri: 'http://localhost/strato-api/eth/v1.2/block/last/15',
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
  return _.keys(types).map((type) => {
    return {
      val: types[type],
      type: type
    }
  });
}

getTransactionsType()
setInterval(getTransactionsType, 3000)

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${TRANSACTIONS_TYPE}`, transactionsTypes);
}

module.exports = {
  initialHydrate
}