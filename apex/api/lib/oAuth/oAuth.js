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


function* createKey(userHeaders, userParams = {}) {

    const username = userHeaders['X-USER-UNIQUE-NAME'];
    const hash = userHeaders['X-USER-ID'];

    if (!username || !hash) {
      let err = new Error("invalid header params, expected: {x-user-unique-name:username, x-user-id:hash}");
      err.status = RestStatus.BAD_REQUEST;
      throw err;
    }


    // Create blockchain user in bloc
    try {

      const userAccount = yield ax.post(process.env.VAULT_HOST, userParams, '/strato/v2.3/key', userHeaders);

      return {
        status: RestStatus.OK,
        user: userAccount
      };
    } catch (blocError) {
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

module.exports = {
  createKey,
  getKey,
};
