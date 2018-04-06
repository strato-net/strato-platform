var common = require('../lib/common');
var config = common.config;
var itShould = common.itShould;
var rest = require("blockapps-rest").rest;
var Promise = require("bluebird");
var lib = require("blockapps-js");
var Units = lib.ethbase.Units;
var Solidity = lib.Solidity;

describe("135722927_enum-array-batch", function() {
  this.timeout(config.timeout);
  itShould.checkAvailability();

  // sendList
  var userCreated = Promise.resolve(rest.setScope({})).
    then(rest.createUser("Alice", "x"));

  var userAddress = userCreated.
    get("users").
    get("Alice").
    get("address");

  it("should create a new user", function() {
    return userAddress.should.be.fulfilled;
  })

  var recipCreated = userCreated.
    then(rest.createUser("Bob", "x"));

  var recipAddress = recipCreated.
    get("users").
    get("Bob").
    get("address");

  var oldFunds = Promise.join(recipCreated, recipAddress, function(scope, addr) {
    return Promise.resolve(rest.getBalance(addr)(scope)).
      get("balances").
      get(addr).
      get(0); // first balance requested
  });
  var sendTXs = Promise.join(oldFunds, recipAddress, function(_, addr) {
    var sendTX = { toAddress: addr, value: 1 };
    return [sendTX, sendTX, sendTX];
  });
  var fundsSent = Promise.join(recipCreated, sendTXs, function(scope, sendTXs) {
    return rest.sendList("Alice", sendTXs, true)(scope);
  });
  var newFunds = Promise.join(fundsSent, recipAddress, function(scope, addr) {
    return Promise.resolve(rest.getBalance(addr)(scope)).
      get("balances").
      get(addr).
      get(1); // second balance requested
  });

  // uploadList
  var contractSpec = {
    contractName: "C",
    args: {}
  };
  var contractList = [contractSpec, contractSpec, contractSpec];
  var batchUpload = fundsSent.
    then(rest.uploadContractList("Alice", contractList, true)).
    get("tx").
    get(1). // second batch call in these tests
    get("result").
    map(function(x) { return Solidity.attach(x.contractJSON); });
    
  // callList
  function doCallListTest(t, i) {
    var hasName = this instanceof String;
    var theT = hasName ? "int" : t;
    var theName = hasName ? this : t;
    it("for " + theName + "[], should return the same as callMethod", function() {
      return fundsSent.
        then(rest.getContractString("C", "fixtures/SimpleArrayFunction.sol")).
        then(function(scope) {
          var cTemplate = scope.contracts.C.string;
          scope.contracts.C.string = cTemplate.replace(/%T/g, theT);
          return scope;
        }).
        then(rest.uploadContract("Alice", "x", "C", {}, {})).
        tap(function(scope) {
          scope.contracts.C.address.should.be.defined;
        }).
        then(rest.callMethod("Alice", "C", "get" + theName, {}, 0)).
        tap(function(scope) {
          scope.contracts.C.calls["get" + theName].should.be.defined;
        }).
        then(function(scope) {
          var txSpec = {
            contractName: "C",
            contractAddress:  scope.contracts.C.address,
            methodName: "get" + theName,
            value: 0,
            args: {},
          };
          return rest.callMethodList("Alice", [txSpec], true)(scope);
        }).
        then(function(scope) {
          // Three batch calls prior to this list
          var batchResult = scope.tx[4 + i].result[0].returnValue;
          var r = scope.contracts.C.calls["get" + theName];
          batchResult.should.deep.equal(r);
        });
    })
  }
  
  describe("sendList", function() {
    it("should create a recipient user", function() {
      return recipAddress.should.be.fulfilled;
    })

    it("should send funds from Alice using sendList", function() {
      return Promise.join(oldFunds, newFunds, function(oldFunds, newFunds) {
        return (newFunds - oldFunds).toString();
      }).should.eventually.equal(Units.ethValue(3).in("ether").toString());
    })
  })

  describe("uploadList", function() {
    it("should batch upload contracts", function() {
      return batchUpload.map(function(solObj) {
        solObj.account.address.should.be.defined;
      })
    })
  })

  describe("callList for functions returning arrays", function() {
    doCallListTest.call("Enum", "E", -2);
    doCallListTest.call("bool", "bool", -1);
    ["int", "uint", "address", "bytes32"].map(doCallListTest);
  })
})
 
