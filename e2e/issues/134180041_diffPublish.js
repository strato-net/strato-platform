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
const exec = Promise.promisify(require("child_process").exec, {multiArgs: true});

const lib = require("blockapps-js");

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------

describe('134180041_diffPublish', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  var ethConf;
  it("should get the peer ID of the strato node", function() {
    var ethConfString;
    return exec("docker exec silo_strato_1 cat /var/lib/strato/.ethereumH/ethconf.yaml").
      get(0).
      then(yaml.safeLoad).
      tap(function(x) {ethConf = x;}).
      should.eventually.not.be.empty;
  });

  var diffP;
  var EXIT_TIMEOUT = 1500;
  it("should connect to kafka to listen for state diffs", function() {
    var peerID = ethConf.ethUniqueId.peerId;
    var topic = "statediff_" + peerID;
    diffP = exec("docker exec silo_kafka_1 /usr/lib/kafka/bin/kafka-console-consumer.sh --zookeeper zookeeper:2181 --max-messages 1 --topic " + topic);
    return diffP.catch(function() {}).timeout(EXIT_TIMEOUT).
      catch(function() {throw new Error("Connection to Kafka failed or closed early.")}).
      should.be.rejected;
  })

  var user = new User(util.uid('Alice'));
  itShould.createUser(user);

  var DIFF_TIMEOUT = 1500;
  it("should receive the correct state diff for that user", function() {
    var address = user.address;
    return diffP.get(0).then(JSON.parse).timeout(DIFF_TIMEOUT).
      catch(function() {throw new Error("Kafka did not publish any state diff within " + DIFF_TIMEOUT + "ms");}).
      should.eventually.have.deep.property("createdAccounts." + address + ".balance", 1000000000000000000000);
  });
});
