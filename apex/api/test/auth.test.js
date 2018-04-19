/* jshint esnext: true */
const chai = require('chai');
const chaiHttp = require('chai-http');
const assert = chai.assert;
const expect = chai.expect;
const fs = require('fs');
const process = require('process');

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
    it('replies Bad Request without un/pw', async function() {
      chai.request(app)
        .post('/login')
        .catch((err) => {
          const res = err.response;
          assert(res.text.includes("wrong params"));
          assert.equal(res.status, '400');
        });
    });
    it('replies 401 with incorrect un/pw', async function() {
      chai.request(app)
        .post('/login')
        .send({username: "me", password: "hunter2"})
        .catch((err) => {
          const res = err.response;
          assert(res.text.includes("does not exist"));
          assert.equal(res.status, '401');
        });
     });
    // TODO: Reenable with signup.blockapps.net working
    xit('creates accounts', async function() {
      this.timeout(20000);
      const res1 = await chai.request(app)
          .post('/users')
          .send({username: "you", password: "hunter2"})
      assert.equal(res1.status, '200');
      const res2 = await chai.request(app)
           .post('/login')
           .send({username: "you", password: "hunter2"})
      assert.equal(res2.status, '200');
    });
    it('doesn\'t log out without creds', async function() {
      await chai.request(app)
        .post('/logout')
        .catch((err) => {
            assert.equal(err.status, '401');
        });
    });

    it('400s when missing an arg', async function() {
      await chai.request(app)
          .post('/dapps')
          .send({username: "dev",
                 password: "hunter3",
                 address: "0x171717171"})
          .catch((err) => {
              const res = err.response;
              assert.equal(res.status, '400');
              assert(res.text.includes("wrong params"));
          });
    });

    // TODO: Reenable with signup.blockapps.net working
    xit('Accepts a working bundle', async function() {
      this.timeout(60000);
      const res1 = await chai.request(app)
         .post('/users')
         .send({username: "dev", password: "hunter3"})
      assert.equal(res1.status, '200');
      const address = JSON.parse(res1.text).user.accountAddress;
      assert.notEqual(address, undefined);


      const res2 = await chai.request(process.env.stratoRoot)
         .post('/faucet')
         .field('address', address)
      assert.equal(res2.status, '200');

      let text = "[]";
      do {
        let res = await chai.request(process.env.stratoRoot)
          .get('/account')
          .query({'address': address})
          .catch((err) => {
             throw err;
          });
        text = res.text;
      } while (text === "[]");

      const res3 = await chai.request(app)
         .post('/dapps')
         .attach('file',
                 fs.readFileSync('./test/testdata/testdata.zip'),
                 'testdata.zip')
         .field('username', 'dev')
         .field('password', 'hunter3')
         .field('address', address)
       assert.equal(res3.status, 200);
       assert(res3.text.includes("\"url\""));
       assert(res3.text.includes("\"metadata\""));
       assert(res3.text.includes("\"nunya\""));
    });

    it("parses initfile.json", async function() {
      const got = await parseInitfile('./test/testdata/');
      const want = {
        'storage': {
          'contractName': 'SimpleStorage',
          'contractFilename': 'contracts/SimpleStorage.sol',
          'args': {}
        }
      };
      expect(got).to.deep.equal(want);
    });

    // TODO: Reenable with signup.blockapps.net working
    xit("can upload init contracts", async function() {
      this.timeout(30000);
      console.log("about to create user");
      const res1 = await chai.request(app)
       .post('/users')
       .send({username: "john_wayne",
              password: "hunter2"});
      assert.equal(res1.status, '200');

      const address = JSON.parse(res1.text).user.accountAddress;
      console.log("about to faucet user");
      const res2 = await chai.request(process.env.stratoRoot)
       .post('/faucet')
       .field('address', address);
      assert.equal(res2.status, '200');

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
      console.log("about it uploadInitContracts");
      const addrs = await uploadInitContracts('./test/testdata/', creds, inits);
      expect(addrs.storage).to.match(/[0-9A-Fa-f]{40}/g);

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
