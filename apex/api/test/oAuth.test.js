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

    const result = await chai.request(app)
        .post('/users')
        .set('X-USER-UNIQUE-NAME',userData.userName)
        .set('X-USER-ID',userData.hash)
        .send({
            username: userData.userName,
            password: userData.password
        });

    console.log('ME ME ME ME ME')
    console.log(result)

    userAccountAddress = JSON.parse(res1.text).user.accountAddress;
    await waitFaucet(accountAddress);
  });


  describe.skip('In public mode', function () {
    let app, checkModeStub;

    before(function(){
        if(SKIP_TEST_BLOCK){
            this.skip();
        }
    })

    beforeEach(function () {
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

    describe('post /verify-email', function () {
      let rpStub;

      before(function(){
          if(SKIP_TEST_BLOCK){
              this.skip();
          }

          rpStub = sinon.stub(rp, 'post');
          rpStub.onFirstCall().rejects();
          rpStub.onSecondCall().resolves({
              hash: null
          });
          rpStub.resolves({
              hash: bcrypt.hashSync('temporarypassword', appConfig.passwordSaltRounds)
          });

      })


      it('replies 400 when email is missing', async function () {
        chai.request(app)
          .post('/verify-email')
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("wrong params"));
            assert.equal(res.status, 400);
          });
      });

      it('replies 401 when user a/c is already created', async function () {
        await chai.request(app)
          .post('/verify-email')
          .send({
            email: "test@test.com"
          })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("User account already exists."));
            assert.equal(res.status, '401');
          });
      });

      it('replies 500 for server error', async function () {
        const email = "newuser@test.com";
        // First call to rpStub
        await chai.request(app)
          .post('/verify-email')
          .send({ email })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("Unexpected server error"));
            assert.equal(res.status, '500');
          })
      });

      it('replies 401 when user is unregistered on signup.blockapps.net', async function () {
        // Second call to rpStub
        await chai.request(app)
          .post('/verify-email')
          .send({
            email: "unregistered@test.com"
          })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("User not found"));
            assert.equal(res.status, '401');
          });
      });

      it('creates new record in TempUsers table for new users', async function () {
        const email = "newuser@test.com";
        const response = await chai.request(app)
          .post('/verify-email')
          .send({ email });
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { exists: true });
        const user = await models.TempUser.findOne({ where: { email } });
        should.exist(user);
      });

      it('replies 500 for database error on create', async function () {
        const createStub = sinon.stub(models.TempUser, 'create');
        createStub.rejects({ name: "Error" });
        const email = "anothernewuser@test.com";
        await chai.request(app)
          .post('/verify-email')
          .send({ email })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("Unexpected server error"));
            assert.equal(res.status, 500);
          });
        models.TempUser.create.restore();
      });

      it('updates verified & password fields in TempUsers for existing record', async function () {
        const email = "verifieduser@test.com";
        const response = await chai.request(app)
          .post('/verify-email')
          .send({ email });
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { exists: true });
        const user = await models.TempUser.findOne({ where: { email } });
        should.exist(user);
        expect(user.verified).to.be.false;
        const isPasswordMatching = await bcrypt.compare('temporarypassword', user.password);
        expect(isPasswordMatching).to.be.true;
      });

      it('replies 500 for database error on update', async function () {
        const updateStub = sinon.stub(models.TempUser, 'update');
        updateStub.rejects();
        const email = "verifieduser@test.com";
        await chai.request(app)
          .post('/verify-email')
          .send({ email })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("Unexpected server error"));
            assert.equal(res.status, 500);
          });
        models.TempUser.update.restore();
      });
    });

    describe('post /verify-temporary-password', function () {

      before(function(){
          if(SKIP_TEST_BLOCK){
              this.skip();
          }
      })

      it('replies 400 when arguments are missing', async function () {
        chai.request(app)
          .post('/verify-temporary-password')
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("wrong params"));
            assert.equal(res.status, 400);
          });
      });

      it('replies 401 when entered password is wrong', async function () {
        await chai.request(app)
          .post('/verify-temporary-password')
          .send({
            email: "test1@test.com",
            tempPassword: "wrongpassword"
          })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("temporary password is incorrect"));
            assert.equal(res.status, 401);
          });
      });

      it('replies 401 when user does not exist', async function () {
        await chai.request(app)
          .post('/verify-temporary-password')
          .send({
            email: "doesnotexist@test.com",
            tempPassword: "password"
          })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("Couldn't find user"));
            assert.equal(res.status, 401);
          });
      });

      it('replies 200 for correct credentials', async function () {
        const res = await chai.request(app)
          .post('/verify-temporary-password')
          .send({
            email: "test1@test.com",
            tempPassword: "password"
          });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, {
          success: true,
          error: null
        })
      });

      it('replies 500 for database error on find', async function () {
        const findStub = sinon.stub(models.TempUser, 'find');
        findStub.rejects();

        await chai.request(app)
          .post('/verify-temporary-password')
          .send({
            email: "test@test.com",
            tempPassword: "password"
          })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("Unexpected server error"));
            assert.equal(res.status, 500);
          });
        models.TempUser.find.restore();
      });

      it('replies 500 for database error on update', async function () {
        const updateStub = sinon.stub(models.TempUser, 'update');
        updateStub.rejects();

        await chai.request(app)
          .post('/verify-temporary-password')
          .send({
            email: "test1@test.com",
            tempPassword: "password"
          })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("Unexpected server error"));
            assert.equal(res.status, 500);
          });
        models.TempUser.update.restore();
      });

      it('replies 500 for bcrypt compare error', async function () {
        const compareStub = sinon.stub(bcrypt, 'compare');
        compareStub.callsArgWith(2, 'error');

        await chai.request(app)
          .post('/verify-temporary-password')
          .send({
            email: "test1@test.com",
            tempPassword: "password"
          })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("Unexpected server error"));
            assert.equal(res.status, 500);
          });
        bcrypt.compare.restore();
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

    it('calls next() for public mode', () => {
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
