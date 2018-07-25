const {TRANSACTIONS_TYPE} = require('../rooms');
const {emitter, ON_SOCKET_PUBLISH_EVENTS} = require('../eventBroker');
const config = require('../../config/app.config');
const Transaction = require('../../models/strato/eth/transaction');

let transactionTypes;

function getTransactionsType() {
  Transaction.findAll(
      {
        attributes: [
          'to_address',
          'code_or_data',
        ],
        raw: true,
        limit: 15,
        order: [['id', 'DESC']]
      }
  ).then(function (data) {
    if (!data.length) {
      transactionTypes = [{val: 0, type: "No Transactions"}];
    } else {
      let typesCounter = {"FunctionCall": 0, "Transfer": 0, "Contract": 0};
      data.forEach(tx => {
        let txType;
        if (tx.to_address) {
          txType = tx.code_or_data.length ? 'FunctionCall' : 'Transfer';
        } else {
          txType = 'Contract';
        }
        typesCounter[txType] += 1;
      });
      transactionTypes = Object.keys(typesCounter).map(typeName => {
        return {
          val: typesCounter[typeName],
          type: typeName,
        }
      });
    }
    emitter.emit(ON_SOCKET_PUBLISH_EVENTS, TRANSACTIONS_TYPE, transactionTypes);
  })
      .catch(function (err) {
        console.log("getTransactionsType Error:", err);
      });
}

getTransactionsType();
setInterval(getTransactionsType, config.webSockets.dbPollFrequency);

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${TRANSACTIONS_TYPE}`, transactionTypes);
}

module.exports = {
  initialHydrate
};
