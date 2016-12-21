const common = require('../lib/common');
const config = common.config;
const constants = common.constants;
const api = common.api;
const assert = common.assert;
const should = common.should;
const util = common.util;
const itShould = common.itShould;
const User = common.model.User
const Contract = common.model.Contract;
const Call = common.model.Call;
const Tx = common.model.Tx;
const BigNumber = common.BigNumber;

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------
const expectedBalance = new BigNumber(1000).times(constants.ETHER);

describe('All services should be alive', function() {
  this.timeout(config.timeout);

  it('Strato should be alive', function(done) {
    return api.strato.home()
      .then(function(string) {
        assert(string.length > 0, 'home page empty');
        done();
      }).catch(done);
  });

  it('Explorer should be alive', function(done) {
    return api.explorer.home()
      .then(function(string) {
        assert(string.length > 0, 'home page empty');
        done();
      }).catch(done);
  });

  it('Bloc should be alive', function(done) {
    return api.bloc.home()
      .then(function(string) {
        assert(string === 'home page!', 'home page string not found');
        done();
      }).catch(done);
  });
});

describe('Get stuff', function() {
  this.timeout(config.timeout);

  it('should get a node list with one item', function(done) {
    return api.explorer.nodes()
      .then(function(nodeList) {
        assert.equal(nodeList.length, 1, 'node list should contains one item');
        done();
      }).catch(done);
  });

  it('should get block 0', function(done) {
    return api.strato.block(0)
      .then(function(blocks) {
        assert.equal(blocks.length, 1, 'block list should contains one item');
        assert.equal(blocks[0].blockData.number, 0, 'block number should be 0');
        done();
      }).catch(done);
  });
});

describe('Walk through', function() {
  this.timeout(config.timeout);

  it('should get block 0', function(done) {
    return api.strato.block(0)
      .then(function(blocks) {
        assert.equal(blocks.length, 1, 'block list should contains one item');
        assert.equal(blocks[0].blockData.number, 0, 'block number should be 0');
        done();
      }).catch(done);
  });

  it('should get all users', function(done) {
    return api.bloc.users()
      .then(function(userList) {
        done();
      }).catch(done);
  });

  const alice = new User(util.uid('Alice'));

  it('should create a new user', function(done) {
    return api.bloc.createUser({
        faucet: '1',
        password: config.password,
      }, alice.name)
      .then(function(address) {
        alice.address = address;
        done();
      }).catch(done);
  });

  it('should find the new user', function(done) {
    return api.bloc.users()
      .then(function(userList) {
        assert(userList.indexOf(alice.name) > -1, 'should include the new user name');
        done();
      }).catch(done);
  });

  it('should find the balance for the new user', function(done) {
    return api.strato.account(alice.address)
      .then(function(accounts) {
        const balance = new BigNumber(accounts[0].balance);
        balance.should.be.bignumber.equal(expectedBalance);
        done();
      }).catch(done);
  });
});

// note - chained promises are not really needed, since it() is chained
describe('Add new user - chained promises', function() {
  this.timeout(config.timeout);

  const alice = new User(util.uid('Alice'));

  it('should get block 0', function(done) {
    return api.strato.block(0)
      .then(function(blocks) {
        return api.bloc.users();
      })
      .then(function(userList) {
        return api.bloc.createUser({
          faucet: '1',
          password: config.password,
        }, alice.name);
      })
      .then(function(address) {
        return api.bloc.users();
      })
      .then(function(userList) {
        assert(userList.indexOf(alice.name) > -1, 'should include the new user name');
        done();
      })
      .catch(done);
  });
});

// describe('Walkthru - transaction', function() {
//   this.timeout(config.testTimeout);
//   beforeEach(timestamp(api, config.timestamp));
//
//   const alice = new User(util.uid('Alice'));
//   const bob = new User(util.uid('Bob'));
//
//   it('should create Alice & Bob, and send Alice-to-Bob', function(done) {
//     return api.bloc.createUser({
//         faucet: '1',
//         password: config.password,
//       }, alice.name)
//       .then(function(address) {
//         alice.address = address;
//         return api.bloc.createUser({
//           faucet: '1',
//           password: config.password,
//         }, bob.name)
//       })
//       .then(function(address) {
//         bob.address = address;
//         return api.bloc.send({
//           password: config.password,
//           toAddress: bob.address,
//           value: '1234',
//         }, alice.name, alice.address);
//       })
//       .then(function(address) {
//         console.log("tx address", address);
//         done();
//       })
//       .catch(done);
//   });
// });

describe('Walkthru - transaction', function() {
  this.timeout(config.timeout);

  const alice = new User(util.uid('Alice'));
  const bob = new User(util.uid('Bob'));
  const value = 20; // ETHER
  const valueWei = new BigNumber(20).times(constants.ETHER);

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

  it('should find the balance', function(done) {
    return api.strato.account(alice.address)
      .then(function(accounts) {
        // console.log(alice.name, accounts[0].balance);
        alice.balance = new BigNumber(accounts[0].balance);
        alice.balance.should.be.bignumber.equal(expectedBalance);
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

  it('should find the balance', function(done) {
    return api.strato.account(bob.address)
      .then(function(accounts) {
        bob.balance = new BigNumber(accounts[0].balance);
        bob.balance.should.be.bignumber.equal(expectedBalance);
        done();
      }).catch(done);
  });

  it('should send Alice-to-Bob', function(done) {
    return api.bloc.send({
        password: config.password,
        toAddress: bob.address,
        value: value,
      }, alice.name, alice.address)
      .then(function(tx) {
        alice.fee = new BigNumber(tx.gasLimit).times(new BigNumber(tx.gasPrice));
        console.log("tx", tx);
        done();
      })
      .catch(done);
  });

  it('post tx balance should be original - value - fee ', function(done) {
    return api.strato.account(alice.address)
      .then(function(accounts) {
        alice.newBalance = new BigNumber(accounts[0].balance);
        alice.diff = alice.balance.minus(alice.newBalance);
        alice.diff.should.be.bignumber.equal(valueWei.plus(alice.fee));
        done();
      }).catch(done);
  });

  it('post tx balance should be original + value', function(done) {
    return api.strato.account(bob.address)
      .then(function(accounts) {
        // console.log(bob.name, accounts[0].balance);
        bob.newBalance = new BigNumber(accounts[0].balance);
        bob.diff = bob.newBalance.minus(bob.balance);
        bob.diff.should.be.bignumber.equal(valueWei);
        done();
      }).catch(done);
  });
});

describe('Walkthru - upload a contract', function() {
  this.timeout(config.timeout);

  const alice = new User(util.uid('Alice'));
  const src = 'contract SimpleStorage { uint storedData; function set(uint x) { storedData = x; } function get() returns (uint retVal) { return storedData; } }';

  // const contractName = 'contracts/Migrations.sol';
  // var contractBuffer;
  //
  // it('should read a contract', function(done) {
  //   return util.readFile(contractName)
  //     .then(function(buffer) {
  //       contractBuffer = buffer;
  //       done();
  //     })
  //     .catch(done);
  // });

  it('should upload the contract', function(done) {
    return api.bloc.createUser({
        faucet: '1',
        password: config.password,
      }, alice.name)
      .then(function(address) {
        alice.address = address;
        return api.bloc.contract({
          password: config.password,
          src: src,
        }, alice.name, alice.address);
      })
      .then(function(address) {
        // console.log("contract address", address);
        done();
      })
      .catch(done);
  });
});

describe.skip('Faucet', function() {

  const alice = new User(util.uid('Alice'));
  const expectedBalance = new BigNumber(1000).times(constants.ETHER);

  itShould.createUser(alice);
  itShould.getBalance(alice);
  it('should have balance of ' + expectedBalance, function(done) {
    alice.balance.should.be.bignumber.equal(expectedBalance);
    done();
  });

 itShould.faucet(alice);
  // it('should have balance of ' + expectedBalance, function(done) {
  //   alice.balance.should.be.bignumber.equal(expectedBalance);
  //   done();
  // });

});
