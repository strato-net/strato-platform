const {TRANSACTIONS_TYPE} = require('../rooms');
const {emitter, ON_SOCKET_PUBLISH_EVENTS} = require('../eventBroker');
const config = require('../../config/app.config');
const Transaction = require('../../models/strato/eth/transaction');

const noTransactionsResponse = [{val: 0, type: "No Transactions"}];
let transactionTypes = noTransactionsResponse;
let previousTransactionTypesJSON;

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
    if (data.length) {
      let typesCounter = {"FunctionCall": 0, "Transfer": 0, "Contract": 0, "PrivateTX": 0};
      data.forEach(tx => {
        let txType;
        if (tx.to_address) {
          txType = tx.code_or_data.length ? 'FunctionCall' : 'Transfer';
        } else {
            txType = tx.code_or_data.length ? 'Contract' : 'PrivateTX';
        }
        typesCounter[txType] += 1;
      });
      transactionTypes = [];
      Object.keys(typesCounter).forEach(typeName => {
        if (typesCounter[typeName] > 0) {
          transactionTypes.push({val: typesCounter[typeName], type: typeName})
        }
      });
    }
    const transactionTypesJSON = JSON.stringify(transactionTypes);
    if (transactionTypesJSON !== previousTransactionTypesJSON) {
      emitter.emit(ON_SOCKET_PUBLISH_EVENTS, TRANSACTIONS_TYPE, transactionTypes);
      previousTransactionTypesJSON = transactionTypesJSON;
    }
  }).catch(function (err) {
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
