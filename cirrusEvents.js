var Promise = require("bluebird");
var retry = require('bluebird-retry');
var rp = require("request-promise");
var yaml = require('yaml-parser');
var child_process = require("child_process");
var bajs = require('blockapps-js');
var util = require('./lib/util');
var cleanState = util.cleanState;
var stateToBody = util.stateToBody;
var traverse = require('traverse');
var consumer = require('./consumer.js');
var chalk = require('chalk');


// Load the fp build.
var _ = require('lodash/fp');
var __ = require('lodash'); // not pretty but how else to use __.map((k,v) => {...}) ?

var kafka = require('kafka-node');

function setUpCirrusEventListener() {
  return function(scope) {
    return new Promise(function(resolve) {
      // scope.cirrusEmitter.on('newContract', function(contractMap) {
      //   startConsumer(scope.topic, 0, contractMap);
      // })

      scope.cirrusEmitter.on('init', function() {
        console.log('scope.topic', scope.kafkaTopic);
        consumer.startConsumer(scope.kafkaTopic, scope.consumerAllContracts, contractMap, 0);
      })
      resolve(scope);
    });
  }
}

module.exports = {
  setUpCirrusEventListener: setUpCirrusEventListener,
};
