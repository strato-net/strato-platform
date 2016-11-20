var chalk = require('chalk')
var argv = require('minimist')(process.argv.slice(2));
var _ = require('lodash/fp');
var __ = require('lodash'); // not pretty but how else to use __.map((k,v) => {...}) ?
var kafka = require('kafka-node');

console.log("I'm " + chalk.red(argv.role))

var zookeeperHost = (process.env.ZOOKEEPER || 'zookeeper:2181');

switch (argv.role) {

  case 'vm':
    break;
  case 'bloc':
    break;
  case 'birrus':
    break;
  case 'cirrus':
    break;
  default:
    console.log("Not a real role");
    break;
}

