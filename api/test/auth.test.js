/* jshint esnext: true */
const chai = require('chai');
const chaiHttp = require('chai-http');
const assert = chai.assert;
const expect = chai.expect;
const fs = require('fs');

const initDb = require('../migrations/init-script/initdb.js');
const models = require('../models');
const createInitialData = require('../migrations/init-script/init');
const app = require('../app');


chai.use(chaiHttp);

describe('App', function() {
  this.timeout(10000);
  before(async function() {
    try {
      await initDb.dropdb();
    } catch (error) {
      // Ignore errors about dropping nonexistent dbs.
      if (error.name != 'invalid_catalog_name') {
        throw error;
      }
    }
    await initDb();
    await models.sequelize.sync();
    await createInitialData();
  });

  describe('post /login', function() {
    it('replies Bad Request without un/pw', function(done) {
      chai.request(app)
        .post('/login')
        .end(function(err, res) {
          assert(res.text.includes("wrong params"));
          assert.equal(res.status, '400');
          done();
        });
    });
    it('replies 401 with incorrect un/pw', function(done) {
      chai.request(app)
        .post('/login')
        .send({username: "me", password: "hunter2"})
        .end(function(err, res) {
          assert(res.text.includes("does not exist"));
          assert.equal(res.status, '401');
          done();
        });
     });
    it('creates accounts', function(done) {
      this.timeout(20000);
      chai.request(app)
       .post('/users')
       .send({username: "you", password: "hunter2"})
       .end(function(err, res) {
         assert.equal(res.status, '200');
         chai.request(app)
           .post('/login')
           .send({username: "you", password: "hunter2"})
           .end(function(err, res) {
             assert.equal(res.status, '200');
             done();
           });
       });
    });
    it('doesn\'t log out without creds', function(done) {
      chai.request(app)
        .post('/logout')
        .end(function(err, res) {
          assert.equal(res.status, '401');
          done();
        });
    });

    xit('400s when missing an arg', function(done) {
      chai.request(app)
          .post('/dapps')
          .send({username: "dev",
                 password: "hunter3",
                 address: "0x171717171"})
          .end(function(err, res) {
            assert.equal(res.status, '400');
            assert(res.text.includes("wrong params"));
            done();
          });
    });

    it('Accepts a working bundle', function(done) {
      this.timeout(60000);
      chai.request(app)
       .post('/users')
       .send({username: "dev", password: "hunter3"})
       .end(function(err, res) {
         assert.equal(res.status, '200');
         address = JSON.parse(res.text).user.accountAddress;
         assert.notEqual(address, undefined);
         chai.request("http://localhost")
           .post('/strato-api/eth/v1.2/faucet')
           .field('address', address)
           .end(function(err, res) {

             chai.request(app)
                 .post('/dapps')
                 .attach('file',
                         fs.readFileSync('./test/testdata/testdata.zip'),
                         'testdata.zip')
                 .field('username', 'dev')
                 .field('password', 'hunter3')
                 .field('address', address)
                 .end(function(err, res) {
                   assert.equal(res.status, 200);
                   assert(res.text.includes("\"url\""));
                   assert(res.text.includes("\"metadata\""));
                   assert(res.text.includes("\"nunya\""));
                   done();
                 });
           });
       });
    });

    it("parses initfile.json", function(done) {
      const got = parseInitfile('./test/testdata/');
      const want = {
        'storage': {
          'contractName': 'SimpleStorage',
          'contractFilename': 'contracts/SimpleStorage.sol',
          'args': {}
        }
      };
      expect(got).to.deep.equal(want);
      done();
    });

    it("can upload init contracts", function(done) {
      this.timeout(30000);
      chai.request(app)
       .post('/users')
       .send({username: "john_wayne",
              password: "hunter2"})
       .end(function(err, res) {

      const address = JSON.parse(res.text).user.accountAddress;
      chai.request("http://localhost")
       .post('/strato-api/eth/v1.2/faucet')
       .field('address', address)
       .end(async function(err, res) {

      const creds = {name: "john_wayne",
                    password: "hunter2",
                    address: address};
      const inits = {
        'storage': {
          'contractName': 'SimpleStorage',
          'contractFilename': 'contracts/SimpleStorage.sol',
          'args': {}
        }
      };
      let addrs = await uploadInitContracts('./test/testdata/', creds, inits);
      expect(addrs.storage).to.match(/[0-9A-Fa-f]{40}/g);
      done();

      });
      });
    });

    it("creates addresses.js", async function() {
      const addrs = {"storage": "deadbeefdeadbeef"};
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
