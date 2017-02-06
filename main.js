var init = require('./init.js'),
 expressApp = require('./cirrus.js'),
 consumer = require('./consumer.js');

// Global contract meta data mapping, used in both consumer and cirrus.js
global.contractMap = {};
var scope = {};

init(scope)
  .then(expressApp())
  .then(consumer())
  .catch(err => {
    console.log('Failed to launch cirrus', err)
  })
