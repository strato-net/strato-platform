/* jshint esnext: true */
const chai = require('chai');
const chaiHttp = require('chai-http');
const assert = chai.assert;
const process = require('process');

const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);
const oAuth = require(`${process.cwd()}/lib/oAuth/oAuth`);

const waitFaucet = async function(address) {
  const res = await chai.request(process.env.stratoRoot)
      .post('/faucet')
      .field('address', address);
  assert.equal(res.status, RestStatus.OK);
  const sleep = function(ms) {
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

describe('OAuth tests', function () {
  this.timeout(10000);

  const username = 'test02@test.com'

  let app, userAccountAddress;

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

    if(result.status == RestStatus.OK){ //user created, faucet em
      userAccountAddress = result.user.address;
      await waitFaucet(userAccountAddress);
    }

    const user = await oAuth.getKey(_username)

    assert.equal(user.status,RestStatus.OK,'user found')
  });


});
