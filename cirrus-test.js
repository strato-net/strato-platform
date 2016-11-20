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

switch (argv.role) {

  case 'vm':
    km = new kafka.KeyedMessage('key', 'message'),
    payloads = [{ topic: 'stateDiff', messages: 'hi3', partition: 0 }];
    
    producer.on('ready', function () {
      producer.createTopics(['stateDiff'], console.log);

      // for when partitionerType = 3
      //client.refreshMetadata(); // see https://github.com/SOHU-Co/kafka-node/issues/354
      
      producer.send(payloads, console.log);
    });
    
    producer.on('error', function (err) {})
 
    break;
  
  case 'bloc':
    break;
  case 'cirrus':
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
    .call('on', 'message', console.log)
    .call('on', 'error', console.log); 

    break;
  default:
    console.log("Not a real role");
    break;
}

