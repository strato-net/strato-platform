const Contracts = require('../block22/contracts');
const io = require('../connect/sockets');
const { CONTRACTS_COUNT } = require('../constants')

function getContractsCount() {
  Contracts.findAndCountAll({ raw: true }).then(contracts => {
    console.log("contracts.count", contracts.count);
    io.in(`ROOM_${CONTRACTS_COUNT}`).emit(`EVENT_${CONTRACTS_COUNT}`, contracts.count);

  })
}

setTimeout(getContractsCount, 3000)