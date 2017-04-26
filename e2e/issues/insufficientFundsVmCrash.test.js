/*jshint esversion: 6 */
var common = require('../lib/common');
var bignum = common.BigNumber;
var consts = common.constants;
var config = common.config;
var itShould = common.itShould;
var rest = require("blockapps-rest").rest;
var Promise = require("bluebird");
var lib = require("blockapps-js");
var rp = require("request-promise");
var _ = require("lodash");


function getTxResult(hash) {
    return rp({uri: common.config.getStratoUrl(0) + '/eth/v1.2/transactionResult/' + hash, json: true})
            .then(function (json) {
                var message = "Unresolved!";
                if(json.length > 0){
                    message = json[0].message;
                    if(message.indexOf("Rejected") === 0) {
                        message = "Rejected!";
                    }
                }
                return {tx: hash, message: message};
            });
}

describe("Insufficient funds shouldn't crash vm", function() {
    this.timeout(config.timeout * 2);
    var userCreated = Promise.resolve(rest.setScope({})).then(rest.createUser("Alice", "x"));
    var userAddress = userCreated.get("users")
                                 .get("Alice")
                                 .get("address");
    var oldFunds = Promise.join(userCreated, userAddress, function(scope, uAddr) {
        return Promise.resolve(rest.getBalance(uAddr)(scope))
                      .get("balances")
                      .get(uAddr)
                      .get(0); // first balance requested
    });
    var sendTXs = Promise.join(oldFunds, function(_oldFunds) {
        var newFunds = _oldFunds.times(new bignum("0.55"));
        var sendTX = { toAddress: "0x1234", value: newFunds.dividedBy(consts.ETHER).toNumber() };
        return [sendTX, sendTX];
    });
    var fundsSent = Promise.join(userCreated, sendTXs, function(scope, sendTXs) {
        return rest.sendList("Alice", sendTXs, false)(scope).get("tx");
    }).then(rest.waitNextBlock());

    var txResults = Promise.resolve(Promise.join(fundsSent, function (scope) {
        var resultsThing = scope[0]["result"];
        var promises = _.map(resultsThing, getTxResult);
        return Promise.all(promises);
    }));

    var unresolveds = txResults.then(txr => _.filter(txr, x => x.message === "Unresolved").length);
    var successes   = txResults.then(txr => _.filter(txr, x => x.message === "Success!").length);
    var rejections  = txResults.then(txr => _.filter(txr, x => x.message === "Rejected!").length);

    itShould.checkAvailability();
    it("should create a new user", () => userAddress.should.be.fulfilled);
    it("resolves all the sent TXs", () => unresolveds.should.eventually.equal(0));
    it("has one transaction succeed", () => successes.should.eventually.equal(1));
    it("has one transaction get rejected", () => rejections.should.eventually.equal(1));
});