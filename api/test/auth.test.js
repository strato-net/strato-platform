/* jshint esnext: true */
const chai = require('chai');
const chaiHttp = require('chai-http');
const assert = chai.assert;

const initDb = require('../migrations/init-script/initdb.js');
const models = require('../models');
const createInitialData = require('../migrations/init-script/init');
const app = require('../app');


chai.use(chaiHttp);

describe('App', function() {
  this.timeout(10000);
  before(async function() {
    await initDb.dropdb();
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

    it('400s when missing an arg', function(done) {
      chai.request(app)
          .post('/dapps')
          .send({username: "dev",
                password: "hunter3",
                address: "0x171717171"})
          .end(function(err, res) {
            assert.equal(res.status, '400');
            done();
          });
    });


  });
});
