/* jshint esnext: true */
const chai = require('chai');
const chaiHttp = require('chai-http');
const assert = chai.assert;
const expect = chai.expect;
const should = chai.should();
const fs = require('fs');
const process = require('process');
const bcrypt = require('bcrypt');
const sinon = require('sinon');
const rp = require('request-promise');
const rewire = require('rewire');
const co = require('co');

const initDb = require('../migrations/init-script/initdb.js');
const models = require('../models');
const createInitialData = require('../migrations/init-script/init');
const appConfig = require('../config/app.config');
const checkMode = require('../lib/checkMode');

const testFactory = require(`${process.cwd()}/test/factory`);
const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);
const util = require(`${process.cwd()}/lib/rest-utils/util`);
const oAuth = require(`${process.cwd()}/lib/oAuth/oAuth`);

const SKIP_TEST_BLOCK = process.env.OAUTH_ENABLED != appConfig.oAuthEnabledTrueValue;

const waitFaucet = async function(address) {
  const res = await chai.request(process.env.stratoRoot)
      .post('/faucet')
      .field('address', address);
  assert.equal(res.status, RestStatus.OK);
  const sleep = function(ms) {
      return new Promise(resolve => setTimeout(resolve, ms))
    };
  let text = "[]";
  do {
      await sleep(400);
      let res = await chai.request(process.env.stratoRoot)
        .get('/account')
        .query({
          'address': address
        })
        .catch((err) => {
          throw err;
        });
      text = res.text;
    } while (text === "[]");

}

chai.use(chaiHttp);

describe('OAuth tests', function () {
  this.timeout(10000);

  const userData = testFactory.getUserData();

  let app, userAccountAddress;

    //need to add skip check to each describe block because of mocha bug.
    // technically beforeEach would work, but other beforeEach's still run
  before(function(){

      if(SKIP_TEST_BLOCK){
          this.skip();
      }

    app = require('../app');

  })


  it('replies Bad Request without headers', async function () {
    await assert.shouldThrowRest(
        async function () {
          await co.wrap(oAuth.createKey);
        }, RestStatus.BAD_REQUEST
    )

  });


  it('creates new user', async function () {
    const username = util.uid(userData.userName); //fixme - small chance of collision if not run w/ fresh system, should clear db in before block

    const user = await co.wrap(oAuth.createKey)(username);

    assert.equal(user.status,RestStatus.OK,'user created')
  });


  it('finds existing user', async function () {
    const username = util.uid(userData.userName); //fixme - small chance of collision if not run w/ fresh system, should clear db in before block

    const result = await co.wrap(oAuth.createKey)(username);

    if(result.status == RestStatus.OK){ //user created, faucet em
      userAccountAddress = result.user.address;
      await waitFaucet(userAccountAddress);
    }

    const user = await co.wrap(oAuth.getKey)(username)

    assert.equal(user.status,RestStatus.OK,'user found')
  });


});
