/* jshint esnext: true */
const chai = require('chai');
const chaiHttp = require('chai-http');
const assert = chai.assert;

const app = require('../app');


chai.use(chaiHttp);

// TODO: write the tests

describe('App', function() {
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
  });
});
