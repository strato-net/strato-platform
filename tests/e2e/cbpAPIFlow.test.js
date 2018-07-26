const ba = require('blockapps-rest');
const co = require('co');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const api = common.api;
const config = common.config;
const util = common.util;
const assert = common.assert;
const nodes = config.nodes;
const moment = require('moment');
const constants = common.constants;
const path = require('path');

const titleManagerJs = require(`./titleManager`);
const contractName = 'Title';

const adminName = util.uid('Admin');
const adminPassword = '1234';

describe("/'contract metadata (parsed via API)-> Bloc -> Postgres/' flow test", function() {

  let admin;

  before(function * () {
  console.log(`Creating admin user`);
  admin = yield rest.createUser(adminName, adminPassword);
  console.log(admin);
  });

  it('should upload a contract and should verify that all fields of metadata is correct', function* () {
    this.timeout(config.timeout);
    const uid = util.uid();
    const username = 'User' + uid;
    // create user
    const isAsync = true;
    const user = yield rest.createUser(username, password, isAsync);
    assert.isDefined(user, "should exist");
    assert.isDefined(user.address, "should be defined");
    assert.notEqual(user.address, 0, "should be a nonzero address");
  });


});
