const yaml = require("js-yaml");
const common = require('../lib/common');
const config = common.config;
const constants = common.constants;
const api = common.api;
const util = common.util;
const expect = common.expect;
const itShould = common.itShould;
const User = common.model.User
const Contract = common.model.Contract;
const Call = common.model.Call;
const Promise = require("bluebird");
const fs = require("fs");

/*
 * This variable must be set to the file containing the genesis block passed as
 * the genesisBlock environment variable when the containers were started.
 */
const genesisFile = "/home/ryanr/silo/strato/strato-init/genesisBlocks/mixedGenesis.json"

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------

describe('134601553_genesisBlock-parameter', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  var genesisJSON;
  it("should read the provided genesis block file", function() {
    try {
      genesisJSON = fs.readFileSync(genesisFile, "utf8");
    } 
    catch (e) {
      throw new Error("Could not read the genesis file at the path " + genesisFile);
    }
  });

  var genesisBlock;
  it("should parse the genesis block as JSON", function() {
    try {
      genesisBlock = JSON.parse(genesisJSON) 
    }
    catch (e) {
      throw new Error("Could not parse the genesis block as a JSON-encoded string")
    }
  });

  it("should have the same genesis block in the database", function() {
    // axios doesn't use bluebird promises :(
    var chainGenesis = Promise.resolve(api.strato.block(0)).
      get(0).get("blockData");
    delete genesisBlock.accountInfo;
    delete genesisBlock.logBloom;
    return chainGenesis.should.eventually.deep.equal(genesisBlock);
  });
});
