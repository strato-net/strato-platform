const common = require('../lib/common');
const config = common.config;
const itShould = common.itShould;
const lib = require(config.siloDir + "/blockapps-js");
const Promise = require("bluebird");

lib.setProfile("strato-dev", config.nodes[0].stratoUrl);

describe('134750423_blockappsjs-typedefs', function() {
  this.timeout(config.timeout);

  function hasTypeBytes(varX, typeName) {
    return Promise.all([
      varX.should.eventually.have.property("type", typeName),
      varX.should.eventually.have.any.keys("bytes")
    ]);
  }

  it("should set type and bytes for typdef Array entries", function() {
    var contract = lib.Solidity("contract C{struct S{int i;} S[] x;}");
    var varX = contract.get("xabi").get("vars").get("x").get("entry");
    return hasTypeBytes(varX, "Struct");
  });
  it("should set type and bytes for contract Array entries", function() {
    var contract = lib.Solidity("contract C{D[] x;} contract D{}").get("src");
    var varX = contract.get("C").get("xabi").get("vars").get("x").get("entry");
    return hasTypeBytes(varX, "Contract");
  });
  it("should set type and bytes for typedef Mapping values", function() {
    var contract = lib.Solidity("contract C{struct S{int i;} mapping(int => S) x;}");
    var varX = contract.get("xabi").get("vars").get("x").get("value");
    return hasTypeBytes(varX, "Struct");
  });
  it("should set type and bytes for contract Mapping values", function() {
    var contract = lib.Solidity("contract C{mapping(int => D) x;} contract D{}").get("src");
    var varX = contract.get("C").get("xabi").get("vars").get("x").get("value");
    return hasTypeBytes(varX, "Contract");
  });
  it("should set type and bytes for typedef Struct fields", function() {
    var contract = lib.Solidity("contract C{struct S{T x;} struct T{int i;}}");
    var varX = contract.get("xabi").get("types").get("S").get("fields").get("x");
    return hasTypeBytes(varX, "Struct");
  });
  it("should set type and bytes for contract Struct fields", function() {
    var contract = lib.Solidity("contract C{struct S{D x;}} contract D{}").get("src");
    var varX = contract.get("C").get("xabi").get("types").get("S").get("fields").get("x");
    return hasTypeBytes(varX, "Contract");
  });
  it("should set type and bytes recursively", function() {
    var contract = lib.Solidity("contract C{struct S{mapping(int => D[]) x;}} contract D{}").get("src");
    var varX = contract.get("C").get("xabi").get("types").get("S").get("fields").get("x").get("value").get("entry");
    return hasTypeBytes(varX, "Contract");
  });
})
