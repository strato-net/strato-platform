var init = require('./init.js'),
 cirrusServer = require('./cirrus.js'),
 events = require('./cirrusEvents.js'),
 consumer = require('./consumer.js');

// Global contract meta data mapping, used in both consumer and cirrus.js
global.contractMap = {};
var scope = {};

init(scope)
  .then(consumer.initKafkaConsumers())
  .then(events.setUpCirrusEventListener())
  .then(cirrusServer())
  .then(function(scope) {
    scope.cirrusEmitter.emit('init');
    return scope;
  })
  .catch(err => {
    console.log('Failed to launch cirrus', err)
    process.exit(1);
  })
