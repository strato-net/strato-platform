const _ = require('underscore');
const { TRANSACTIONS_TYPE } = require('../rooms');
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroker');
const config = require('../../config/app.config');
const Block= require('../models/eth/block');

let transactionsTypes;

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
        const blockReceiptTxs = JSON.parse(d.receipt_transactions);
        _.map(blockReceiptTxs,function(rt){
          receiptTransactions.push(rt);
        });
      });

      const currentTxType = extractTxTypes(receiptTransactions);
      if (!_.isEqual(currentTxType, transactionsTypes)) {
        transactionsTypes = currentTxType;
        emitter.emit(ON_SOCKET_PUBLISH_EVENTS, TRANSACTIONS_TYPE, transactionsTypes);
      }

    })
    .catch(function (err) {
      console.log("getTransactionsType Error:", err);
    });
}

function extractTxTypes(receiptTransactions) {
  let types = { "FunctionCall": 0, "Transfer": 0, "Contract": 0 };
  receiptTransactions.forEach(v => { types[parseTransactionType(v)]++; });
  const filtered = _.keys(types)
    .filter((type)=>{
      return types[type] > 0;
    })
    .map((type) => {
      return {
        val: types[type],
        type: type
      };
    });
  if(filtered.length === 0) {
    return [{
      val: 0,
      type: "No Transactions"
    }];
  }
  return filtered;
}

// BEWARE :: The receipt transactions are stored as haskell types that
// were turned into strings. See haskell's `read` and `show` functions
// to understand why this works.
// Until the Block table is normalized (or at least until the receipts
// are stored as JSON) we regex the haskell type for the fields
// required.
function parseTransactionType(v) {
  const toMatched = v.match(/transactionTo = /);
  const noDataMatched = v.match(/transactionData = \"\"/);

  if (toMatched && noDataMatched) {
    // Found a `to` address and no data was attached
	  return "Transfer";
  } else if (toMatched) {
    // Found a `to` address and there was a payload
	  return "FunctionCall";
  } else {
    // No `to` address, therefore, contract creation
	  return "Contract";
  }
}

getTransactionsType();
setInterval(getTransactionsType, config.webSockets.dbPollFrequency);

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${TRANSACTIONS_TYPE}`, transactionsTypes);
}

module.exports = {
  initialHydrate
};
