/* jshint esnext: true */
const chai = require('chai');
const co = require('co');

const chaiHttp = require('chai-http');

const assert = chai.assert;
const expect = chai.expect;
const sinon = require('sinon');

const initDb = require('../migrations/init-script/initdb.js');
const models = require('../models');
const createInitialData = require('../migrations/init-script/init');
const externalStorage = require(`${process.cwd()}/lib/externalStorage/externalStorage.oAuth`);
const uploader = require('../lib/uploader');
const bcrypt = require('bcrypt');
const checkMode = require('../lib/checkMode');
const appConfig = require('../config/app.config');

const oAuth = require(`${process.cwd()}/lib/oAuth/oAuth`);
const util = require(`${process.cwd()}/lib/rest-utils/util`);
const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);
const testFactory = require(`${process.cwd()}/test/factory`);

const SKIP_TEST_BLOCK = process.env.OAUTH_ENABLED != appConfig.oAuthEnabledTrueValue;



chai.use(chaiHttp);

describe('File - ExternalStorage - OAuth', function () {
  this.timeout(200000);

  const userData = testFactory.getUserData();
  const uploadData = testFactory.getUploadData()
  const testContent = testFactory.getTestContent()
  const testSigners = testFactory.getTestSigners()
  const testVerifiable = testFactory.getTestVerifiable()
  
  let _contractAddress, userAccountAddress, app;
  
  
  before(async function () {
    if(SKIP_TEST_BLOCK){
      this.skip();
    }

    app = require('../app');

    await createTestContract();

  });




  describe('post /bloc/file/upload', async function () {

    before(function(){
      if(SKIP_TEST_BLOCK){
        this.skip();
      }
    })

    beforeEach(function () {
      if(SKIP_TEST_BLOCK){
        this.skip();
      }

      sinon.stub(uploader, 'upload').resolves(uploadData); //todo - sinon intercepting call to uploader (here and below), should be ok like this? dont wnat to upload to s3 w/ every test
    });

    afterEach(function () {
      if(SKIP_TEST_BLOCK){
        this.skip();
      }

      uploader.upload.restore();
    })

    it('replies Bad Request without content', async function () {
      await assert.shouldThrowRest(
          async function () {
            chai.request(app)
                .post('/bloc/file/upload')
                .set('X-USER-UNIQUE-NAME',userData.userName)
                .set('X-USER-ID',userData.hash)
          }, RestStatus.BAD_REQUEST
      )
    });

    it('replies Bad Request without content', async function () {
      chai.request(app)
        .post('/bloc/file/upload')
          .set('X-USER-UNIQUE-NAME',userData.userName)
          .set('X-USER-ID',userData.hash)
        .attach('content', testContent.image)
        .catch((err) => {
          const res = err.response;
          assert.equal(res.status, RestStatus.BAD_REQUEST);
        });
    });

    it('replies OK with file uplaod and data entry', async function () {
      const username = userData.userName;
      const result = await chai.request(app)
        .post('/bloc/file/upload')
          .set('X-USER-UNIQUE-NAME',userData.userName)
          .set('X-USER-ID',userData.hash)
          .field('metadata', testContent.meta)
          .field('provider', testContent.provider)
          .attach('content', testContent.image)
          .type('form')

      expect(result).to.have.status(RestStatus.OK);
    });

    it('replies UNAUTHORIZED with invalid headers', async function () {
      await assert.shouldThrowRest(
          async function () {
            await chai.request(app)
                .post('/bloc/file/upload')
                .field('metadata', testContent.meta)
                .field('provider', testContent.provider)
                .attach('content', testContent.image)
                .type('form')
          }, RestStatus.INTERNAL_SERVER_ERROR
      )
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

      });

      afterEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }

      })

      it('throws INTERNAL_SERVER_ERROR', async function () {
        await assert.shouldThrowRest(
            async function () {
              await chai.request(app)
                  .post('/bloc/file/upload')
                  .set('X-USER-UNIQUE-NAME',userData.userName)
                  .set('X-USER-ID',userData.hash)
                  .field('metadata', testContent.meta)
                  .field('provider', testContent.provider)
                  .attach('content', testContent.image)
                  .type('form')
            }, RestStatus.INTERNAL_SERVER_ERROR
        )
      });

    });

  });

  describe('get /bloc/file/list', async function () {
    before(function(){
      if(SKIP_TEST_BLOCK){
        this.skip();
      }
    })

    it('replies OK with list of uploads', async function () {
      const res = await chai.request(app)
        .get('/bloc/file/list')
          .set('X-USER-UNIQUE-NAME',userData.userName)
          .set('X-USER-ID',userData.hash)

      assert.equal(res.status, RestStatus.OK);
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


      it('replies BAD_REQUEST with wrong query', async function () {
        await assert.shouldThrowRest(
            async function () {
              chai.request(app)
                  .get('/bloc/file/verify')
                  .set('X-USER-UNIQUE-NAME',userData.userName)
                  .set('X-USER-ID',userData.hash)
                  .query({
                    'contractAddress': null
                  })
                  .catch((err) => {
                    const res = err.response;
                    assert.equal(res.status, RestStatus.BAD_REQUEST);
                  });
            }, RestStatus.BAD_REQUEST
        )
      });

      it('replies BAD_REQUEST with no data exists', async function () {
        await assert.shouldThrowRest(
            async function () {
              chai.request(app)
                  .get('/bloc/file/verify')
                  .set('X-USER-UNIQUE-NAME',userData.userName)
                  .set('X-USER-ID',userData.hash)
                  .query({
                    'contractAddress': testSigners[0]
                  })
            }, RestStatus.BAD_REQUEST
        )
      });

      it('replies OK with data exists', async function () {
        const res = await chai.request(app)
          .get('/bloc/file/verify')
            .set('X-USER-UNIQUE-NAME',userData.userName)
            .set('X-USER-ID',userData.hash)
            .query({
              'contractAddress': _contractAddress
            })

        assert.equal(res.body.uri, uploadData.Location);
        assert.equal(res.status, RestStatus.OK);
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

      });

      afterEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }

      })

      it('throws INTERNAL_SERVER_ERROR', async function () {
        await assert.shouldThrowRest(
            async function () {
              await chai.request(app)
                  .get('/bloc/file/verify')
                  .set('X-USER-UNIQUE-NAME', userData.userName)
                  .set('X-USER-ID', userData.hash)
                  .query({
                    'contractAddress': _contractAddress
                  })
            }, RestStatus.INTERNAL_SERVER_ERROR
        )
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
          uri: testVerifiable.uri,
          timeStamp: testVerifiable.timestamp,
          signers: [
            testSigners[0]
          ]
        };

      });

      afterEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }

      })

      it('missing headers', async function () {
        chai.request(app)
          .post('/bloc/file/attest')
          .catch((err) => {
            const res = err.response;
            assert.equal(res.status, RestStatus.UNAUTHORIZED);
          });
      });

      it('replies BAD_REQUEST with no data exists', async function () {
        chai.request(app)
          .post('/bloc/file/attest')
            .set('X-USER-UNIQUE-NAME',userData.userName)
            .set('X-USER-ID',userData.hash)
            .send({
              contractAddress: 'a51f27e78aef85a06631f0725f380001e0a',
            })
            .catch((err) => {
              const res = err.response;
              assert(res.text.includes("Contract address not found"));
              assert.equal(res.status, RestStatus.BAD_REQUEST);
            });
      });

      it('replies OK with valid data', async function () {
        const username = util.uid(userData.userName)
        const { user } = await co.wrap(oAuth.createKey)({
          'X-USER-UNIQUE-NAME': username,
          'X-USER-ID': userData.hash
        })

        const res = await chai.request(app)
          .post('/bloc/file/attest')
            .set('X-USER-UNIQUE-NAME',username)
            .set('X-USER-ID',userData.hash)
            .send({
              contractAddress: _contractAddress,
            })


        assert.equal(res.status, RestStatus.OK);
        assert.equal(res.body.attested, true, 'should be attested')
        assert.include (res.body.signers, user.address, 'signers should include user')
      });

      it('replies 400 with signer already exists', async function () {
        await assert.shouldThrowRest(
            async function () {
              await chai.request(app)
                  .post('/bloc/file/attest')
                  .set('X-USER-UNIQUE-NAME',userData.userName)
                  .set('X-USER-ID',userData.hash)
                  .send({
                    contractAddress: _contractAddress,
                  })
            },
            RestStatus.BAD_REQUEST);
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

      });

      afterEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }

      })

      it('throws INTERNAL SERVER ERROR', async function () {
        await assert.shouldThrowRest(
            async function () {
              await chai.request(app)
                  .post('/bloc/file/attest')
                  .set('X-USER-UNIQUE-NAME',userData.userName)
                  .set('X-USER-ID',userData.hash)
                  .send({
                    contractAddress: _contractAddress,
                  })
            }, RestStatus.INTERNAL_SERVER_ERROR
        )
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
          uri: testVerifiable.uri,
          timeStamp: testVerifiable.timestamp,
          signers: [
            testSigners[0]
          ]
        };

      });

      afterEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }

      })

      it('replies BAD_REQUEST with wrong query', async function () {
        await assert.shouldThrowRest(
            async function () {
              await chai.request(app)
                  .get('/bloc/file/download')
                  .query({
                    'contractAddress': null
                  })
            }, RestStatus.BAD_REQUEST
        )
      });

      it('replies BAD_REQUEST with contractAddress not exists', async function () {
        await assert.shouldThrowRest(
            async function () {
              chai.request(app)
                  .get('/bloc/file/download')
                  .query({
                    'contractAddress': testSigners[0]
                  })
            }, RestStatus.BAD_REQUEST
        )
      });

      it('replies OK with data exists', async function () {
        const res = await chai.request(app)
          .get('/bloc/file/download')
          .query({
            'contractAddress': _contractAddress
          })

        assert.equal(res.status, RestStatus.OK);
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

      });

      afterEach(function () {
        if(SKIP_TEST_BLOCK){
          this.skip();
        }

      })

      it('throws INTERNAL SERVER ERROR', async function () {
        await assert.shouldThrowRest(
            async function () {
              await chai.request(app)
                  .get('/bloc/file/download')
                  .query({
                    'contractAddress': _contractAddress
                  })
            }, RestStatus.INTERNAL_SERVER_ERROR
        )
      });

    });

  });

  async function createTestContract(){

    sinon.stub(uploader, 'upload').resolves(uploadData); // so that s3 isnt hit every time

    const username = userData.userName;
    const uploadResult = await chai.request(app)
        .post('/bloc/file/upload')
        .set('X-USER-UNIQUE-NAME',userData.userName)
        .set('X-USER-ID',userData.hash)
        .field('metadata', testContent.meta)
        .field('provider', testContent.provider)
        .attach('content', testContent.image)
        .type('form')

    _contractAddress = uploadResult.body.contractAddress;

    uploader.upload.restore();

  }
});
