/* jshint esnext: true */
const chai = require('chai');
const assert = chai.assert;
const process = require('process');

const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);
const oAuth = require(`${process.cwd()}/lib/oAuth/oAuth`);

describe('OAuth tests', function () {
  this.timeout(10000);

  const username = 'test02@test.com'

  let app;

    //need to add skip check to each describe block because of mocha bug.
    // technically beforeEach would work, but other beforeEach's still run
  before(function(){
    app = require('../app');
  })


  it('replies Bad Request without headers', async function () {
    let result;
    const status = RestStatus.BAD_REQUEST
    try {
      result = await oAuth.createKey()
    } catch (err) {
      assert.equal(err.status, status);
      return
    }
    // should not have succeeded
    assert(false, `Should have thrown error: ${status} instead got ${JSON.stringify(result)}`);
    
  });


  it('creates new user', async function () {
    const _username = username + new Date()
    const user = await oAuth.createKey(_username);

    assert.equal(user.status,RestStatus.OK,'user created')
  });


  it('finds existing user', async function () {
    const _username = username + new Date()
    const result = await oAuth.createKey(_username);

    if(result.status == RestStatus.OK){
      userAccountAddress = result.user.address;
    }

    const user = await oAuth.getKey(_username)

    assert.equal(user.status,RestStatus.OK,'user found')
  });


});
