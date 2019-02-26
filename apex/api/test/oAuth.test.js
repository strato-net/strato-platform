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

const initDb = require('../migrations/init-script/initdb.js');
const models = require('../models');
const createInitialData = require('../migrations/init-script/init');
const appConfig = require('../config/app.config');
const checkMode = require('../lib/checkMode');

const testFactory = require(`${process.cwd()}/test/factory`);
const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);

const waitFaucet = async function(address) {
    const res = await chai.request(process.env.stratoRoot)
      .post('/faucet')
      .field('address', address);
    assert.equal(res.status, '200');
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

const SKIP_TEST_BLOCK = process.env.OAUTH_ENABLED != appConfig.oAuthEnabledTrueValue;

describe('OAuth tests', function () {
  this.timeout(10000);

  let app, userAccountAddress;
  const userData = testFactory.getUserData();

    //need to add skip check to each describe block because of mocha bug.
    // technically beforeEach would work, but other beforeEach's still run
  before(function(){

      if(SKIP_TEST_BLOCK){
          this.skip();
      }
  })

  before(async function () {

    if(SKIP_TEST_BLOCK){
      this.skip();
    }

    console.log('ohohoh',process.env.OAUTH_ENABLED)
    app = require('../app');

    const user = await chai.request(app)
        .post('/login')
        .set('X-USER-UNIQUE-NAME',userData.userName)
        .set('X-USER-ID',userData.hash)
        .catch((err) => {
            const res = err.response;
            assert.equal(res.status, RestStatus.INTERNAL_SERVER_ERROR); //todo - pull rest-SIMILAR-to from ba-sol or ht3
     });

     if(user && user.status == RestStatus.OK){ //user found, yay
         return;
     }

    const result = await chai.request(app)
        .post('/users')
        .set('X-USER-UNIQUE-NAME',userData.userName)
        .set('X-USER-ID',userData.hash)
        .send({
            username: userData.userName,
            password: userData.password
        });


      if(result.status == RestStatus.OK){ //user created, faucet em
          userAccountAddress = result.body.user.address;
          await waitFaucet(userAccountAddress);
      }


  });


  describe.skip('In public mode', function () {
    let app, checkModeStub;

    before(function(){
        if(SKIP_TEST_BLOCK){
            this.skip();
        }
    })

    beforeEach(function () {
        console.log('whyo')
      checkModeStub = sinon.stub(checkMode, 'checkMode').callsFake(function (req, res, next) {
        return next();
      });
      app = require('../app');
    });
    afterEach(function () {
      checkMode.checkMode.restore();
    })

    describe('post /login', function () {

      before(function(){
          if(SKIP_TEST_BLOCK){
              this.skip();
          }
      })

      it('replies Bad Request without headers', async function () {
        chai.request(app)
          .post('/login')
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("wrong params"));
            assert.equal(res.status, '400');
          });
      });


      it("can upload init contracts", async function () {
        this.timeout(30000);
        console.log("about to create user");
        await models.TempUser.create({
          email: 'john_wayne@test.com',
          password: bcrypt.hashSync('hunter2', appConfig.passwordSaltRounds),
          verified: true
        });
        const res1 = await chai.request(app)
          .post('/users')
          .send({
            username: "john_wayne@test.com",
            password: "hunter2"
          });
        assert.equal(res1.status, '200');

        const address = JSON.parse(res1.text).user.accountAddress;
        console.log("about to faucet user");
        await waitFaucet(address);
        console.log("faucet successful.");

        const creds = {
          name: "john_wayne@test.com",
          password: "hunter2",
          address: address
        };
        const inits = {
          'storage': {
            'contractName': 'SimpleStorage',
            'contractFilename': 'contracts/SimpleStorage.sol',
            'args': {}
          }
        };
        console.log("about it uploadInitContracts");
        const addrs = await uploadInitContracts('./test/testdata/', creds, inits);
        expect(addrs.storage).to.match(/[0-9A-Fa-f]{40}/g);

      });

      it("creates addresses.js", async function () {
        const addrs = {
          "storage": "deadbeefdeadbeef"
        };
        const name = await injectAddressesJs('./test/testdata', addrs);
        assert.equal(name, 'test/testdata/addresses.js');
        const want =
          `const addresses = {
  storage: "deadbeefdeadbeef",
};
`;
        const got = fs.readFileSync(name, 'utf8');
        assert.equal(got, want);
      });
    });




  });

  describe('Checkmode middleware', function () {
    const rewiredCheckMode = rewire('../lib/checkMode');
    let mockReq, mockRes, mockNext, status, json, nextCalled;

    before(function(){
        if(SKIP_TEST_BLOCK){
            this.skip();
        }
    })

    beforeEach(function () {
      mockReq = {
        headers: {}
      }
      status = undefined;
      json = undefined;
      mockRes = {
        json: function (responseJson) {
          json = responseJson;
        },
        status: function (responseStatus) {
          status = responseStatus
          return this;
        }
      }
      nextCalled = false;
      mockNext = function () { nextCalled = true }
    })

    it('calls next() for public mode', () => { //todo - public and ouath incompattible, do check for process.env instead
      rewiredCheckMode.__set__("appConfig", { SMD_MODE: 'public' });
      rewiredCheckMode.checkMode(mockReq, mockRes, mockNext)
      expect(nextCalled).to.be.true;
    })

    it('replies 404 for enterprise mode', () => {
      rewiredCheckMode.__set__("appConfig", { SMD_MODE: 'enterprise' });
      rewiredCheckMode.checkMode(mockReq, mockRes, mockNext)
      expect(nextCalled).to.be.false;
      assert.deepEqual(json, { message: 'Not found' })
      assert.equal(status, 404);
    })
  })
});
