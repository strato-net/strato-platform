const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const config = common.config;
const util = common.util;
const fsutil = common.fsutil;
const should = common.should;
const assert = common.assert;
const expect = common.expect;
const BigNumber = common.BigNumber;
const verbose = rest.verbose;

function factoryCreateContract(contractName, count) {
  return function(scope) {
    verbose('factoryCreateContract', {
      contractName,
      count
    });
    var array = [];
    const address = scope.contracts[contractName].address;
    for (var i = 0; i < count; i++) {
      array.push({
        'contractName': contractName,
        'contractAddress': address,
        'methodName': 'set',
        'value': 1,
        'args': {
          x: i
        }
      });
    }
    scope.contracts[contractName].calls = array;
    return scope;
  }
}

function addBank(adminName, contractName, _bank, _name, _certificate) {
  return function(scope) {
    verbose('addBank', {
      _bank,
      _name,
      _certificate
    });
    // function addBank (address _bank, string _name, string _certificate) onlyOwner returns (uint) {
    const method = 'addBank';
    const args = {
      _bank: _bank,
      _name: _name,
      _certificate: _certificate,
    };
    return rest.callMethod(adminName, contractName, method, args)(scope)
      .then(function(scope) {
        // uint
        const result = scope.contracts[contractName].calls[method];
        return scope;
      });
  }
}

function createTransaction(adminName, contractName, _rcptBank, _transactionEncryptedData) {
  return function(scope) {
    verbose('createTransaction', {
      _rcptBank,
      _transactionEncryptedData,
    });
    //function createTransaction(address _rcptBank, string _transactionEncryptedData) onlyIfAllowed {
    const method = 'createTransaction';
    const args = {
      _rcptBank: _rcptBank,
      _transactionEncryptedData: _transactionEncryptedData,
    };
    return rest.callMethod(adminName, contractName, method, args)(scope)
      .then(function(scope) {
        return scope;
      });
  }
}

function createTransactionList(contractName, count) {
  return function(scope) {
    verbose('createTransactionList', {
      contractName,
      count
    });
    var array = [];
    const address = scope.contracts[contractName].address;
    for (var i = 0; i < count; i++) {
      array.push({
        'contractName': contractName,
        'contractAddress': address,
        'methodName': 'createTransaction',
        'value': 1,
        'args': {
          _rcptBank: getBankName(i),
          _transactionEncryptedData: '12345678',
        }
      });
    }
    scope.contracts[contractName].calls = array;
    return scope;
  }

  function getBankName(index) {
    return ['1111', '2222', '3333'][index % 3];
  }
}




describe('Bloc - List Upload', function() {
  this.timeout(6666 * 1000);

  const scope = {};
  var adminName = util.uid('Admin');
  const adminPassword = '1234';
  const contractName = 'BlockchainRTGSv3';
  const contractFilename = './fixtures/SALT3.sol';
  const count = 300;

  before(function(done) {
    rest.setScope(scope)
      .then(rest.createUser(adminName, adminPassword))
      .then(rest.getContractString(contractName, contractFilename))
      .then(rest.uploadContract(adminName, adminPassword, contractName))
      .then(createTransactionList(contractName, count))
      .then(function(scope) {
        done();
      }).catch(done);
  });

  // test-scripts · 132922485_transaction-batching± ⟩ curl -X POST -H "Content-type: application/json" -d '{"password": "1234", "txs": [{"contractName":"SimpleStorage", "contractAddress":"7b10b7f518e4890de0151beb86cc24cd08cbbd54", "methodName":"set", "value":"4", "args":{"x":"1"}}, {"contractName":"SimpleStorage", "contractAddress":"7b10b7f518e4890de0151beb86cc24cd08cbbd54", "methodName":"set", "value":"5", "args":{"x":"2"}}], "resolve":"false"}' 40.84.53.181:8001/users/Alice_3955_87442142/cfe2a8e6fb47628989bccbaf021c59df2dbbf307/callList -s | json_pp
  // [
  //    "c5917420d970ea60880c9e1e343678c717b4cf93cf915bf0a8ae25e3ba83aa21",
  //    "d8a2e88ee3b999733c3679b58e7962102cf246a1cefd67ff0e6a48882638a1ee"
  // ]

  it('should work in a sequence', function(done) {
    const txresolve = false;
    const calls = scope.contracts[contractName].calls;
    rest.setScope(scope)
      .then(addBank(adminName, contractName, '1111', 'bank1', '11111111'))
      .then(addBank(adminName, contractName, '2222', 'bank2', '11111111'))
      .then(addBank(adminName, contractName, '3333', 'bank3', '11111111'))
      .then(createTransaction(adminName, contractName, '1111', 'AAAAAAAA'))
      .then(createTransaction(adminName, contractName, '2222', 'BBBBBBBB'))
      .then(createTransaction(adminName, contractName, '3333', 'CCCCCCCC'))
      .then(function(scope) {
        done();
      }).catch(done);
  });

  it('should send list of calls - with resolve. count ' + count, function(done) {
    console.log('sending ' + count);
    const txresolve = true;
    const calls = scope.contracts[contractName].calls;

    rest.setScope(scope)
      .then(rest.callMethodList(adminName, calls, txresolve))
      .then(function(scope) {
        done();
      }).catch(done);
  });


});
