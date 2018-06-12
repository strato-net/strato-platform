const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common
const config = common.config;
const constants = common.constants;
const api = common.api;
const assert = common.assert;
const util = common.util;
const BigNumber = require('bignumber.js');
const Promise = common.Promise;

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------

function getBalances(nodes, usersAndNodes) {
  //get balances for all users from all nodes
  return function(scope) {
    return Promise.each(nodes, function(node, i){
        return Promise.each(usersAndNodes,function(uan){
          return rest.getBalance(scope.users[uan.user].address, i)(scope);
        })
    })
    .then(function(){
      return scope;
    });
  }
}

function getSyncTolerance(defaultTolerance) {
  const syncTolerance = util.getArgInt('--syncTolerance', defaultTolerance);
  console.log({syncTolerance});
  return syncTolerance;
}

describe('network', function() {
  this.timeout(config.timeout);
  const scope = {
    blocks: []
  };
  var usersAndNodes = [];

  config.nodes.forEach(function(node, i){
    usersAndNodes.push({
      node: i,
      user: util.uid('alice' + i)
    });
    usersAndNodes.push({
      node: i,
      user: util.uid('bob' + i)
    });
  });

  const faucetBalance = new BigNumber(1000).times(constants.ETHER);
  const aliceExpectedBalance = new BigNumber(1000 + 1).times(constants.ETHER);
  const syncTolerance = getSyncTolerance(config.nodes.length);

  //create users
  before(function(done){
    rest.setScope(scope)
      .then(function(scope){
        return Promise.each(usersAndNodes,function(uan, i){
          return rest.createUser(uan.user, config.password, uan.node)(scope)
        });
      })
      .then(function(){
        done();
      })
      .catch(done);
  });

  it('should check that the last block is in sync', function(done){
    //promise.all could potentially cause issues with api.setNode
    //hence we use syncTolerance to figure out what delta we are willing to accept
    Promise.each(config.nodes,function(node, i){
      return rest.getLastBlock(0, i)(scope)
    })
    .then(function(){
      var blocks = scope.blocks.splice(-3);
      var delta = blocks.map(function(block){
          return block[0].blockData.number;
        })
        .reduce(function(result, block, i, array){
          if(i == 0) return 0;
          return result + Math.abs(array[i] - array[i-1]);
        }, 0);

      delta.should.be.at.most(syncTolerance);
      done();
    })
    .catch(done);
  });

  it("should return the same balance for all nodes for alice and bob", function(done){
    rest.setScope(scope)
      .then(getBalances(config.nodes, usersAndNodes))
      .then(function(scope) {
        //balances for all alice and bob
        //should be equal to faucetBalance
        //from all three nodes
        var userBalances = [];

        usersAndNodes.forEach(function(uan){
          scope.balances[scope.users[uan.user].address].slice(-config.nodes.length).forEach(function(balance){
            userBalances.push(new BigNumber(balance));
          });
        });

        const userBalancesMatch = userBalances.reduce(function(result, balance) {
          return result && balance.eq(faucetBalance);
        }, true);

        assert.isTrue(userBalancesMatch, "All users should have faucet balance");
        done();
      })
      .catch(done);
  });

  it("should send from alice to bob from all nodes", function(done){
    rest.setScope(scope)
      .then(function(scope) {
        //send transactions to all nodes
        return Promise.each(usersAndNodes.filter(function(user, i){
          return i%2 == 1;
        }), function(uan, i){
          return rest.send(uan.user, usersAndNodes[i*2].user,1,uan.node)(scope);
        })
        .then(function(){
          return scope;
        })
      })
      .then(function(scope){
        //wait for transactions to confirm
        return Promise.each(config.nodes, function(node, i){
          return rest.waitNextBlock(undefined, i)(scope);
        })
        .then(function(){
          return scope;
        })
      })
      .then(getBalances(config.nodes, usersAndNodes.filter(function(uan, i) { return i % 2 == 0;})))
      .then(function(scope){
        var aliceBalances = [];

        usersAndNodes.filter(function(uan, i) { return i % 2 == 0;}).forEach(function(uan){
          scope.balances[scope.users[uan.user].address].slice(-config.nodes.length).forEach(function(balance){
            aliceBalances.push(new BigNumber(balance));
          });
        });

        const aliceBalancesMatch = aliceBalances.reduce(function(result, balance) {
          return result && balance.eq(aliceExpectedBalance);
        }, true);

        assert.isTrue(aliceBalancesMatch, "All Alices should have additional balance on all nodes");
        done();
      })
      .catch(done);
  });

});
