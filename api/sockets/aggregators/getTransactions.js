const _ = require('underscore');
const { GET_TRANSACTIONS } = require('../rooms')
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require('../eventBroaker')
var rp = require('request-promise');

const options = {
  uri: 'http://localhost/strato-api/eth/v1.2/transaction/last/15',
  json: true
}

function getTransactions() {
  rp(options)
    .then(function (data) {
      let transactions = data;
      if (!_.isEqual(data, transactions)) {
        emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_TRANSACTIONS, transactions)
      }
    })
    .catch(function (err) {
      console.log("err", err);
    });
}

getTransactions()
setInterval(getTransactions, 3000)

function initialHydrate(socket) {
  socket.emit(`PRELOAD_${GET_TRANSACTIONS}`, transactions);
}

module.exports = {
  initialHydrate
}