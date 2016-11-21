var Promise = require("bluebird");
var chalk = require('chalk')
var argv = require('minimist')(process.argv.slice(2));
var _ = require('lodash/fp');
var __ = require('lodash'); // not pretty but how else to use __.map((k,v) => {...}) ?
var kafka = Promise.promisifyAll(require('kafka-node'));

console.log("I'm " + chalk.red(argv.role))

var zookeeperHost = (process.env.ZOOKEEPER || 'zookeeper:2181');
var client = new kafka.Client(zookeeperHost);
var producer = new kafka.HighLevelProducer(client, {partitionerType: 0}); 
var offsetter = new kafka.Offset(client); 

function callNTimes(n, time, fn) {
  var i = n;
  function callFn() {
    if (--n < 0) return;
      fn(-(n-i));
      setTimeout(callFn, time);
    }
  setTimeout(callFn, time);
}

switch (argv.role) {

  case 'vm':
    km = new kafka.KeyedMessage('key', 'message'),
    
    producer.on('ready', function () {
      producer.createTopics(['stateDiff'], console.log);

      // for when partitionerType = 3
      //client.refreshMetadata(); // see https://github.com/SOHU-Co/kafka-node/issues/354
      
      callNTimes(9999999999, 1000, n => {
        producer.send([{ topic: 'stateDiff', messages: 'stateDiff_'+n, partition: 0 }], console.log)
      });
    });
    
    producer.on('error', console.log)
 
    break;
  
  case 'bloc':
    break;
  case 'cirrus':
    offsetter
      .fetchLatestOffsetsAsync(['fullState'])
      .get('fullState')
      .get(0)
      .then(offset => {
        console.log("offset is: " + offset);
        return new kafka.Consumer(
          client,
          [{
            topic: 'fullState',
            offset: 0, // offset
            partition: 0
          }],
          {fromOffset: true}
        );
      })
    .call('on', 'message', m => {
      console.log("m:" + JSON.stringify(m));
    })
    .call('on', 'error', console.log);

   break;

  case 'birrus':
    offsetter
      .fetchLatestOffsetsAsync(['stateDiff'])
      .get('stateDiff')
      .get(0)
      .then(offset => {
        console.log("offset is: " + offset);
        return new kafka.Consumer(
          client,
          [{
            topic: 'stateDiff', 
            offset: 0, // offset
            partition: 0
          }],
          {fromOffset: true}
        );
      })
    .call('on', 'message', m => {
      console.log("m:" + JSON.stringify(m));
      //producer.on('ready', function () {
        producer.createTopics(['fullState'], console.log);
        producer.send([{ topic: 'fullState', messages: 'fullState_', partition: 0 }], console.log)
      //})
    })
    .call('on', 'error', console.log); 

    break;
  default:
    console.log("Not a real role");
    break;
}

