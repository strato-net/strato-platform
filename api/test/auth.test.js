const chai = require('chai');
const chaiHttp = require('chai-http');
const assert = chai.assert;

const app = require('../app');


chai.use(chaiHttp);

// TODO: write the tests

describe('App', function() {
  describe('post /login', function() {
    it('responds with status 401', function(done) {
      chai.request(app)
        .post('/login')
        .end(function(err, res) {
          assert.equal(res.status, '401');
          done();
        });
    });
  });
});
