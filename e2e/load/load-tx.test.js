const common = require('../lib/common');
const config = common.config;
const constants = common.constants;
const api = common.api;
const assert = common.assert;
const util = common.util;
const timestamp = util.timestamp;
const User = common.model.User;

console.log("config:", config);
api.setDebug(config.apiDebug); // can be modified at any time

// describe('Load test', function() {
//   this.timeout(160 * 1000);
//   beforeEach(timestamp(api));
//
//   for (var i = 0; i < 50; i++)
//     it('should create a new user ' + i, function(done) {
//       const alice = new User(util.uid('Alice'));
//       return api.bloc.createUser({
//           faucet: '1',
//           password: config.password,
//         }, alice.name)
//         .then(function(address) {
//           done();
//         }).catch(done);
//     });
// });

describe('Load - transaction', function() {
  this.timeout(config.timeout);

  const alice = new User(util.uid('Alice'));
  const bob = new User(util.uid('Bob'));
  const value = 0.2; // ETHER

  it('should create Alice', function(done) {
    return api.bloc.createUser({
        faucet: '1',
        password: config.password,
      }, alice.name)
      .then(function(address) {
        alice.address = address;
        done();
      }).catch(done);
  });

  it('should create Bob', function(done) {
    return api.bloc.createUser({
        faucet: '1',
        password: config.password,
      }, bob.name)
      .then(function(address) {
        bob.address = address;
        done();
      }).catch(done);
  });

  for(var i = 0; i < 20; i++) {
  it('should send Alice-to-Bob', function(done) {
    return api.bloc.send({
        password: config.password,
        toAddress: bob.address,
        value: value,
      }, alice.name, alice.address)
      .then(function(tx) {
        alice.fee = tx.gasLimit * tx.gasPrice;
        // console.log("tx", tx);
        done();
      })
      .catch(done);
  });
}

});
