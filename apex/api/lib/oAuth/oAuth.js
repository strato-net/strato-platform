/* jshint esnext: true */
const bcrypt = require('bcrypt');
const blockappsRest = require('blockapps-rest').rest;
const co = require('co');
const moment = require('moment');
const rp = require('request-promise');
const querystring = require('querystring');

const ax = require(`${process.cwd()}/lib/rest-utils/axios-wrapper`);

const appConfig = require('../../config/app.config');
const authHandler = require('../../middlewares/authHandler.js');
const models = require('../../models/index');
const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);


function* createKey(userHeaders, userParams = null) {

    const username = userHeaders['X-USER-UNIQUE-NAME'];
    const hash = userHeaders['X-USER-ID'];

    if (!username || !hash) {
      let err = new Error("invalid header params, expected: {x-user-unique-name:username, x-user-id:hash}");
      err.status = RestStatus.BAD_REQUEST;
      throw err;
    }


    // Create blockchain user in bloc
    try {

      userParams = userParams == null ? {} : userParams;
      const userAccount = yield ax.post(process.env.VAULT_HOST, userParams, '/strato/v2.3/key', userHeaders);

      //faucet user so they can do stuff
      yield waitFaucet(userAccount.address)

      return {
        status: RestStatus.OK,
        user: userAccount
      };
    } catch (blocError) {
      console.log(blocError)
      let err = new Error('could not create bloc account: ', blocError); //fixme - see universalError in ht3
      throw err;
    }

}


function* getKey(userHeaders, userQuery = null) {
  const username = userHeaders['X-USER-UNIQUE-NAME'];
  const hash = userHeaders['X-USER-ID'];

  if (!username || !hash) {
    let err = new Error("invalid header params, expected: {x-user-unique-name:username, x-user-id:hash}");
    err.status = RestStatus.BAD_REQUEST;
    throw err;
  }

  try {
    const query = userQuery ? `?${querystring.stringify(userQuery)}` : '';

    const userAccount = yield ax.get(process.env.VAULT_HOST, `/strato/v2.3/key${query}`, {
      "x-user-unique-name": username,
      "x-user-id": hash
    });

    return {
      status: RestStatus.OK,
      user: userAccount
    };
  } catch (blocError) {
    let err = new Error('could not find bloc account: ', blocError); //fixme - see universalError in ht3
    throw err
  }

}

function* getOrCreateKey(userHeaders, userQuery = null){
  try {
    return yield getKey(userHeaders, userQuery)
  } catch (err) {
    return yield createKey(userHeaders, userQuery)
  }
}



//===================
// Helper functions
//===================

function* waitFaucet(address) { //fixme - function duplicated in multiple tests, move to util file
  const params = {
    address: address
  }

  //faucet
  yield ax.postue(process.env.stratoRoot, params, '/faucet')


  //wait for update
  const sleep = function (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  };

  let res = [];
  do {
    yield sleep(400);
    const query = `?${querystring.stringify(params)}`;

    res = yield ax.get(process.env.stratoRoot, `/account${query}`)

  } while (res.length < 1);

}


//===================


module.exports = {
  createKey,
  getKey,
  getOrCreateKey,
};
