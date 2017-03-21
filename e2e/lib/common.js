const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(require('chai-bignumber')());
chai.use(chaiAsPromised);
exports.assert = chai.assert;
exports.expect = chai.expect;
exports.should = require('chai').should();

const BigNumber = require('bignumber.js');
exports.BigNumber = BigNumber;
const config = require('./config');
exports.config = config.configFile;
exports.constants = require('./constants');
const api = require('./api')(config.configFile);
api.setDebug(config.configFile.apiDebug); // can be modified at any time
exports.api = api;
const util = require('./util');
exports.util = util;
const fsutil = require('./fs-util');
exports.fsutil = fsutil;
exports.model = require('./model');
exports.itShould = require('./itShould.js')(api, config.configFile);

exports.importer = require('../lib/importer');
exports.eparser = require('../lib/eparser');

// assert improvements
exports.assert.address = function(address, message) {
  message = message || '';
  chai.assert.notEqual(address, 0, message + ' invalid address 0');
  chai.assert.ok(util.isAddress(address), message + ' invalid address');
}
