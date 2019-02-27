/* jshint esnext: true */
const chai = require('chai');
const chaiHttp = require('chai-http');
const assert = chai.assert;
const expect = chai.expect;
const sinon = require('sinon');

const initDb = require('../migrations/init-script/initdb.js');
const models = require('../models');
const createInitialData = require('../migrations/init-script/init');
const externalStorage = require('../lib/externalStorage/externalStorage');
const uploader = require('../lib/uploader');
const bcrypt = require('bcrypt');
const checkMode = require('../lib/checkMode');
const appConfig = require('../config/app.config');

const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);
const testFactory = require(`${process.cwd()}/test/factory`);

const SKIP_TEST_BLOCK = process.env.OAUTH_ENABLED != appConfig.oAuthEnabledTrueValue;

const waitFaucet = async function (address) { //fixme - function duplicated in multiple tests, move to util file 
  const res = await chai.request(process.env.stratoRoot)
    .post('/faucet')
    .field('address', address);
  assert.equal(res.status, RestStatus.OK);
  const sleep = function (ms) {
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

describe('File - ExternalStorage', function () {
  this.timeout(20000);

  const userData = testFactory.getUserData();
  
  let _contractAddress, userAccountAddress, app;
  
  
  before(async function () {//fixme - is this before block garuanteed to complete before the describe/it below? look into mocha promises

    if(SKIP_TEST_BLOCK){
      this.skip();
    }

    app = require('../app');

    //fixme - is there a way to clear all keys in db - in case test is run on non clean system?

    const user = await chai.request(app)
        .post('/login')
        .set('X-USER-UNIQUE-NAME',userData.userName)
        .set('X-USER-ID',userData.hash)
        .catch((err) => {
          const res = err.response;
          assert.equal(res.status, RestStatus.INTERNAL_SERVER_ERROR,'user not found');
        });

    if(user && user.status == RestStatus.OK){ //user found, yay
      return;
    }

    const result = await chai.request(app)
        .post('/users')
        .set('X-USER-UNIQUE-NAME',userData.userName)
        .set('X-USER-ID',userData.hash)
        .send();


    if(result.status == RestStatus.OK){ //user created, faucet em
      userAccountAddress = result.body.user.address;
      await waitFaucet(userAccountAddress);
    }

  });



  describe('post /bloc/file/upload', async function () {

    beforeEach(function () {
      let uploadData = {
        ETag: '"123b0b7aef8ba5d26ac7cab3438837f9"',
        Location: 'https://strato-external-storage.s3.amazonaws.com/1530596484075-Rie1vaW.png',
        key: '1530596484075-Rie1vaW.png',
        Key: '1530596484075-Rie1vaW.png',
        Bucket: 'strato-external-storage'
      };

      sinon.stub(uploader, 'upload').resolves(uploadData);
    });

    afterEach(function () {
      uploader.upload.restore();
    })

    it('replies Bad Request without content', async function () {
      chai.request(app)
        .post('/bloc/file/upload')
          .set('X-USER-UNIQUE-NAME',userData.userName)
          .set('X-USER-ID',userData.hash)
        .catch((err) => {
          const res = err.response;
          assert.equal(res.status, RestStatus.BAD_REQUEST);
        });
    });

    it('replies Bad Request without content', async function () {
      chai.request(app)
        .post('/bloc/file/upload')
          .set('X-USER-UNIQUE-NAME',userData.userName)
          .set('X-USER-ID',userData.hash)
        .attach('content', './test/testdata/testImage.png')
        .catch((err) => {
          const res = err.response;
          assert.equal(res.status, RestStatus.BAD_REQUEST);
        });
    });

    it('replies OK with file uplaod and data entry', async function () {
      console.log('=============')
      console.log('=============')
      console.log('=============')
      const username = userData.userName;
      const result = await chai.request(app)
        .post('/bloc/file/upload')
          .set('X-USER-UNIQUE-NAME',userData.userName)
          .set('X-USER-ID',userData.hash)
          //.field('username', username)
          //.field('address', accountAddress)
          //.field('password', 'password')
          .field('metadata', 'Nature Pics')
          .field('provider', 's3')
          .attach('content', './test/testdata/testImage.png')
          .type('form')

      expect(result).to.have.status(RestStatus.OK);
      // all the below testcases are dependent on contractAddress assigned here
      _contractAddress = result.body.contractAddress;
    });

    it('replies UNAUTHORIZED with invalid headers', async function () {
      await chai.request(app)
        .post('/bloc/file/upload')
          .field('metadata', 'Nature Pics')
          .field('provider', 's3')
          .attach('content', './test/testdata/testImage.png')
          .type('form').catch(error => {
            assert.equal(error.status, RestStatus.UNAUTHORIZED);
          })
    });

    describe('rejects', async function () {

      beforeEach(function () {
        sinon.stub(externalStorage, 'uploadContract').rejects('Internal server error');
      });

      afterEach(function () {
        externalStorage.uploadContract.restore();
      })

      it('throws 500', async function () {
        await chai.request(app)
          .post('/bloc/file/upload')
            .set('X-USER-UNIQUE-NAME',userData.userName)
            .set('X-USER-ID',userData.hash)
            .field('username', userData.userName)
            .field('address', accountAddress)
            .field('password', 'password')
            .field('metadata', 'Nature Pics')
            .field('provider', 's3')
            .attach('content', './test/testdata/testImage.png')
            .type('form')
            .catch((err) => {
              const res = err.response;
              assert.equal(res.status, '500');
            });
      });

    });

  });

  describe.skip('get /bloc/file/list', async function () {

    it('replies 200 with list of uploads', async function () {
      const res = await chai.request(app)
        .get('/bloc/file/list')
          .set('X-USER-UNIQUE-NAME',userData.userName)
          .set('X-USER-ID',userData.hash)

      assert.equal(res.status, '200');
    });

  });

  describe.skip('get /bloc/file/verify', async function () {

    describe('resolve', async function () {
      let storage;

      beforeEach(function () {
        storage = {
          uri: 'https://strato-external-storage.s3.amazonaws.com/1530511399877-widescreen.jpeg',
          timeStamp: 1530538131,
          signers: [
            "6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad"
          ]
        };

        sinon.stub(externalStorage, 'getExternalStorage').resolves(storage);
      });

      afterEach(function () {
        externalStorage.getExternalStorage.restore();
      })

      it('replies 400 with wrong query', async function () {
        chai.request(app)
          .get('/bloc/file/verify')
            .set('X-USER-UNIQUE-NAME',userData.userName)
            .set('X-USER-ID',userData.hash)
          .query({
            'contractAddress': null
          })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("wrong params"));
            assert.equal(res.status, '400');
          });
      });

      it('replies 400 with no data exists', async function () {
        chai.request(app)
          .get('/bloc/file/verify')
          .query({
            'contractAddress': '6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad'
          })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("wrong params"));
            assert.equal(res.status, '400');
          });
      });

      it('replies 200 with data exists', async function () {
        const res = await chai.request(app)
          .get('/bloc/file/verify')
          .query({
            'contractAddress': _contractAddress
          })

        assert.deepEqual(res.body, storage);
        assert.equal(res.status, '200');
      });
    });

    describe('rejects', async function () {

      beforeEach(function () {
        sinon.stub(externalStorage, 'getExternalStorage').rejects('Internal server error');
      });

      afterEach(function () {
        externalStorage.getExternalStorage.restore();
      })

      it('throws 500', async function () {
        await chai.request(app)
          .get('/bloc/file/verify')
          .query({
            'contractAddress': _contractAddress
          })
          .catch((err) => {
            const res = err.response;
            assert.equal(res.status, '500');
          });
      });

    });

  });

  describe.skip('post /bloc/file/attest', async function () {

    describe('resolve', async function () {
      let storage;

      beforeEach(function () {
        storage = {
          uri: 'https://strato-external-storage.s3.amazonaws.com/1530511399877-widescreen.jpeg',
          timeStamp: 1530538131,
          signers: [
            "6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad"
          ]
        };

        sinon.stub(externalStorage, 'getExternalStorage').resolves(storage);
        sinon.stub(externalStorage, 'attest').resolves([['6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad', 'a51f27e78aef85a06631f0725f380001e0ae9fb6']]);
      });

      afterEach(function () {
        externalStorage.getExternalStorage.restore();
        externalStorage.attest.restore();
      })

      it('replies Bad Request without username, address, password, contractAddress', async function () {
        chai.request(app)
          .post('/bloc/file/attest')
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("wrong params"));
            assert.equal(res.status, '400');
          });
      });

      it('replies 400 with no data exists', async function () {
        chai.request(app)
          .post('/bloc/file/attest')
          .send({
            contractAddress: 'a51f27e78aef85a06631f0725f380001e0a',
            username: 'test1@mailinator.com',
            password: 'password',
            address: 'a51f27e78aef85a06631f0725f380001e0ae9fb6'
          })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("Contract address not found"));
            assert.equal(res.status, '400');
          });
      });

      it('replies 200 with valid data', async function () {
        const res = await chai.request(app)
          .post('/bloc/file/attest')
          .send({
            contractAddress: _contractAddress,
            username: 'test1@mailinator.com',
            password: 'password',
            address: 'a51f27e78aef85a06631f0725f380001e0ae9fb6'
          })

        assert.deepEqual(
          { attested: true, signers: ['6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad', 'a51f27e78aef85a06631f0725f380001e0ae9fb6'] },
          res.body
        )
        assert.equal(res.status, '200');
      });

      it('replies 400 with signer already exists', async function () {
        await chai.request(app)
          .post('/bloc/file/attest')
          .send({
            contractAddress: _contractAddress,
            username: 'test1@mailinator.com',
            password: 'password',
            address: '6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad'
          })
          .catch((err) => {
            const res = err.response;
            assert.equal(res.status, '400');
          });
      });

    });

    describe('rejects', async function () {

      beforeEach(function () {
        sinon.stub(externalStorage, 'getExternalStorage').rejects('Internal server error');
      });

      afterEach(function () {
        externalStorage.getExternalStorage.restore();
      })

      it('throws 500', async function () {
        await chai.request(app)
          .post('/bloc/file/attest')
          .send({
            contractAddress: _contractAddress,
            username: 'test1@mailinator.com',
            password: 'password',
            address: 'a51f27e78aef85a06631f0725f380001e0ae9fb6'
          })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("Internal server error"));
            assert.equal(res.status, '500');
          });
      });

    });
  });

  describe.skip('get /bloc/file/download ', async function () {

    describe('resolve', async function () {
      let storage;

      beforeEach(function () {
        storage = {
          uri: 'https://strato-external-storage.s3.amazonaws.com/1530511399877-widescreen.jpeg',
          timeStamp: 1530538131,
          signers: [
            "6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad"
          ]
        };

        sinon.stub(externalStorage, 'getExternalStorage').resolves(storage);
      });

      afterEach(function () {
        externalStorage.getExternalStorage.restore();
      })

      it('replies 400 with wrong query', async function () {
        await chai.request(app)
          .get('/bloc/file/download')
          .query({
            'contractAddress': null
          })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("wrong params"));
            assert.equal(res.status, '400');
          });
      });

      it('replies 400 with contractAddress not exists', async function () {
        chai.request(app)
          .get('/bloc/file/download')
          .query({
            'contractAddress': '6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad'
          })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("wrong params"));
            assert.equal(res.status, '400');
          });
      });

      it('replies 200 with data exists', async function () {
        const res = await chai.request(app)
          .get('/bloc/file/download')
          .query({
            'contractAddress': _contractAddress
          })

        assert.equal(res.status, '200');
      });

    });

    describe('rejects', async function () {

      beforeEach(function () {
        sinon.stub(externalStorage, 'getExternalStorage').rejects('Internal server error');
      });

      afterEach(function () {
        externalStorage.getExternalStorage.restore();
      })

      it('throws 500', async function () {
        let res = await chai.request(app)
          .get('/bloc/file/download')
          .query({
            'contractAddress': _contractAddress
          })
          .catch((err) => {
            const res = err.response;
            assert(res.text.includes("Internal server error"));
            assert.equal(res.status, '500');
          });
      });

    });

  });

});
