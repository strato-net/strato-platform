var init = require('./init.js'),
 expressApp = require('./cirrus.js'),
 consumer = require('./consumer.js');

global.contractMap = {};
var scope = {};

init(scope)
  .then(expressApp())
  .then(consumer())
  .catch(err => {
    console.log('Failed to launch cirrus', err)
  })
  // .then(consumer())
