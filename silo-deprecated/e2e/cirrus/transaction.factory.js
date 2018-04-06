
const ba = require('blockapps-rest');
const common = ba.common;
const api = common.api;

module.exports = {
  getTxs: function(contractName, contractAddress, methodName, value, batchIndex, size, identifier, generator) {
    var txs = [];
    for (var i = 0; i < size; i++) {
      txs.push({
        contractName: contractName,
        contractAddress: contractAddress,
        methodName: methodName,
        value: value,
        args: generator(i, identifier, batchIndex),
        txParams: api.getTxParams(),
      });
    }
    console.log("=== TXS ===", txs);
    return txs;
  },
  getSampleVersion1: function(index, identifier, batchIndex) {
    return {
      wellname: 'wellname' + index,
      sampletype: 'sampletype' + index,
      currentlocationtype: identifier,
      currentvendor: 'currentvendor' + batchIndex,
      startdepthfeet: index * 100,
      enddepthfeet: index * 110,
      startdepthmeter: index * 100 / 3,
      enddepthmeter: index * 110 / 3
    };
  },
  getSampleVersion2: function(index, identifier, batchIndex) {
    return {
      wellname: 'wellname' + index,
      sampletype: 'sampletype' + index,
      currentlocationtype: identifier,
      currentvendor: 'currentvendor' + batchIndex,
      startdepthfeet: index * 100,
      enddepthfeet: index * 110,
      startdepthmeter: index * 100 / 3,
      enddepthmeter: index * 110 / 3,
      samplestate: 'New'
    };
  }
}
