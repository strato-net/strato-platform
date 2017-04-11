var common = require('../lib/common');
var bignum = common.BigNumber;
var consts = common.constants;
var config = common.config;
var itShould = common.itShould;
var rest = require("blockapps-rest").rest;
var Promise = require("bluebird");
var lib = require("blockapps-js");

describe("Insufficient funds crashes vm", function() {
    this.timeout(config.timeout);
    itShould.checkAvailability();

    // sendList
    var userCreated = Promise.resolve(rest.setScope({})).
    then(rest.createUser("Alice", "x"));

    var userAddress = userCreated.get("users")
                                 .get("Alice")
                                 .get("address");

    it("should create a new user", function() {
        return userAddress.should.be.fulfilled;
    });

    var recipCreated = userCreated.then(rest.createUser("Bob", "x"));

    var recipAddress = recipCreated.get("users")
                                   .get("Bob")
                                   .get("address");

    var oldFunds = Promise.join(recipCreated, recipAddress, function(scope, addr) {
        return Promise.resolve(rest.getBalance(addr)(scope))
                      .get("balances")
                      .get(addr)
                      .get(0); // first balance requested
    });

    var sendTXs = Promise.join(oldFunds, recipAddress, function(_oldFunds, addr) {
        var newFunds = _oldFunds.times(new bignum("0.55"));
        var sendTX = { toAddress: addr, value: newFunds.dividedBy(consts.ETHER).toNumber() };
        return [sendTX, sendTX];
    });

    var fundsSent = Promise.join(recipCreated, sendTXs, function(scope, sendTXs) {
        return rest.sendList("Alice", sendTXs, true)(scope);
    });

    var newFunds = Promise.join(fundsSent, recipAddress, function(scope, addr) {
        return Promise.resolve(rest.getBalance(addr)(scope).then(function (scope) { return rest.waitNextBlock()(scope); }))
                      .get("balances")
                      .get(addr)
                      .get(1); // second balance requested
    });

    it("gracefully handles sending 55% of the account balance twice", function () {
        return newFunds.should.be.fulfilled;
    });
});