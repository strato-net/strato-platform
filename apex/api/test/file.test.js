/* jshint esnext: true */
const chai = require('chai');
const chaiHttp = require('chai-http');
const assert = chai.assert;
const expect = chai.expect;
const sinon = require('sinon');

const models = require('../models');
const externalStorage = require('../lib/externalStorage/externalStorage');
const uploader = require('../lib/uploader');
const bcrypt = require('bcrypt');
const checkMode = require('../lib/checkMode');
const appConfig = require('../config/app.config');

const SKIP_TEST_BLOCK = process.env.OAUTH_ENABLED == appConfig.oAuthEnabledTrueValue;

const waitFaucet = async function (address) {
  const res = await chai.request(process.env.stratoRoot)
    .post('/faucet')
    .field('address', address);
  assert.equal(res.status, '200');
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

describe('File - ExternalStorage - non-OAuth/Public', function () {
  this.timeout(20000);
  let _contractAddress, accountAddress, app;

  before(async function () {
    if(SKIP_TEST_BLOCK){
      this.skip();
    }

    checkModeStub = sinon.stub(checkMode, 'checkMode').callsFake(function (req, res, next) {
      return next();
    });

    app = require('../app');

    await models.TempUser.create({
      email: 'test01@test.com',
      password: bcrypt.hashSync('password', appConfig.passwordSaltRounds),
      verified: true
    });
    const res1 = await chai.request(app)
      .post('/users')
      .send({
        username: "test01@test.com",
        password: "password"
      });

    accountAddress = JSON.parse(res1.text).user.accountAddress;
    await waitFaucet(accountAddress);
  });

  after(function () {
    if(SKIP_TEST_BLOCK){
      this.skip();
    }

    checkMode.checkMode.restore();
  })


  describe('post /bloc/file/upload', async function () {

    beforeEach(function () {
      if(SKIP_TEST_BLOCK){
        this.skip();
      }

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
      if(SKIP_TEST_BLOCK){
        this.skip();
      }

      uploader.upload.restore();
    })

    it('replies Bad Request without content, username, address, password, provider, metadata', async function () {
      chai.request(app)
        .post('/bloc/file/upload')
        .catch((err) => {
          const res = err.response;
          assert(res.text.includes("wrong params"));
          assert.equal(res.status, '400');
        });
    });

    it('replies Bad Request without username, address, password, provider, metadata', async function () {
      chai.request(app)
        .post('/bloc/file/upload')
        .attach('content', './test/testdata/testImage.png')
        .catch((err) => {
          const res = err.response;
          assert(res.text.includes("wrong params"));
          assert.equal(res.status, '400');
        });
    });

    it('replies 200 with file uplaod and data entry', async function () {
      const result = await chai.request(app)
        .post('/bloc/file/upload')
        .field('username', 'test01@test.com')
        .field('address', accountAddress)
        .field('password', 'password')
        .field('metadata', 'Nature Pics')
        .field('provider', 's3')
        .attach('content', './test/testdata/testImage.png')
        .type('form')

      expect(result).to.have.status(200);
      // all the below testcases are dependent on contractAddress assigned here
      _contractAddress = result.body.contractAddress;
    });

    it('replies 400 with incorrect password', async function () {
      await chai.request(app)
        .post('/bloc/file/upload')
        .field('username', 'test01@test.com')
        .field('address', accountAddress)
        .field('password', 'passwo')
        .field('metadata', 'Nature Pics')
        .field('provider', 's3')
        .attach('content', './test/testdata/testImage.png')
        .type('form').catch(error => {
          assert.equal(error.status, '400');
        })
    });

    describe('rejects', async function () {

      before(function(){
        if(SKIP_TEST_BLOCK){
          this.skip();
        }
      })

      beforeEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }

        sinon.stub(externalStorage, 'uploadContract').rejects('Internal server error');
      });

      afterEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }

        externalStorage.uploadContract.restore();
      })

      it('throws 500', async function () {
        await chai.request(app)
          .post('/bloc/file/upload')
          .field('username', 'test01@test.com')
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

  describe('get /bloc/file/list', async function () {
    before(function(){
      if(SKIP_TEST_BLOCK){
        this.skip();
      }
    })

    it('replies 200 with list of uploads', async function () {
      const res = await chai.request(app)
        .get('/bloc/file/list')

      assert.equal(res.status, '200');
    });

  });

  describe('get /bloc/file/verify', async function () {
    before(function(){
      if(SKIP_TEST_BLOCK){
        this.skip();
      }
    })

    describe('resolve', async function () {
      let storage;

      before(function(){
        if(SKIP_TEST_BLOCK){
          this.skip();
        }
      })

      beforeEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }

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

      before(function(){
        if(SKIP_TEST_BLOCK){
          this.skip();
        }
      })


      beforeEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }

        sinon.stub(externalStorage, 'getExternalStorage').rejects('Internal server error');
      });

      afterEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }

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

  describe('post /bloc/file/attest', async function () {

    before(function(){
      if(SKIP_TEST_BLOCK){
        this.skip();
      }
    })

    describe('resolve', async function () {
      let storage;

      before(function(){
        if(SKIP_TEST_BLOCK){
          this.skip();
        }
      })


      beforeEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }

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
        if(SKIP_TEST_BLOCK){
          this.skip();
        }

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

      before(function(){
        if(SKIP_TEST_BLOCK){
          this.skip();
        }
      })


      beforeEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }
        sinon.stub(externalStorage, 'getExternalStorage').rejects('Internal server error');
      });

      afterEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }
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

  describe('get /bloc/file/download ', async function () {

    before(function(){
      if(SKIP_TEST_BLOCK){
        this.skip();
      }
    })


    describe('resolve', async function () {
      let storage;

      before(function(){
        if(SKIP_TEST_BLOCK){
          this.skip();
        }
      })

      beforeEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }
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
        if(SKIP_TEST_BLOCK){
          this.skip();
        }
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

      before(function(){
        if(SKIP_TEST_BLOCK){
          this.skip();
        }
      })


      beforeEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }

        sinon.stub(externalStorage, 'getExternalStorage').rejects('Internal server error');
      });

      afterEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }

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
