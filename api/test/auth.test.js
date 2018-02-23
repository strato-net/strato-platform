/* jshint esnext: true */
const chai = require('chai');
const chaiHttp = require('chai-http');
const assert = chai.assert;

const initDb = require('../migrations/init-script/initdb.js');
const models = require('../models');
const app = require('../app');


chai.use(chaiHttp);

describe('App', function() {
  before(async function() {
    await initDb();
    await models.sequelize.sync();
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
  });
});
