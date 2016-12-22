function getBatchTx(contractName, contractAddress, batchIndex, size, identifier, sampleVersion) {
  var txs = [];
  for (var i = 0; i < size; i++) {
    txs.push({
      contractName: contractName,
      contractAddress: contractAddress,
      methodName: 'add',
      value: 0,
      args: createSample(i, identifier, batchIndex, sampleVersion),
      txParams: api_getTxParams(),
    });
  }
  return txs;
}

function api_getTxParams() {
  return {
    gasLimit: 100000000,
    gasPrice: 1
  };
}


function createSample(index, identifier, batchIndex, sampleVersion) {
  var sample = {
    wellname: 'wellname' + index,
    sampletype: 'sampletype' + index,
    currentlocationtype: identifier,
    currentvendor: 'currentvendor' + batchIndex,
    startdepthfeet: index * 100,
    enddepthfeet: index * 110,
    startdepthmeter: index * 100 / 3,
    enddepthmeter: index * 110 / 3
  }

  if(sampleVersion == 2) {
    sample.samplestate = 'New';
  }

  return sample;
}

// create a delay, before a promise. pass in args payload
function delayPromise(delay) {
  return function(scope) {
    return new Promise(function(resolve, reject) {
      setTimeout(function() {
        resolve(scope);
      }, delay);
    });
  }
}

module.exports = function() {
  return {
    api_getTxParams: api_getTxParams,
    delayPromise: delayPromise,
    getBatchTx: getBatchTx
  };
};
