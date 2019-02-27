/* jshint esnext: true */
const bcrypt = require('bcrypt');
const blockappsRest = require('blockapps-rest').rest;
const co = require('co');
const moment = require('moment');
const rp = require('request-promise');
const querystring = require('querystring');

const ax = require(`${process.cwd()}/lib/rest-utils/axios-wrapper`);

const appConfig = require('../config/app.config');
const authHandler = require('../middlewares/authHandler.js');
const models = require('../models');
const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);


function createKey(req, res, next) {
  co(function* () {

    //todo - separate out to a validation function - dupicate w/ login
    const username = req.headers['x-user-unique-name'];
    const hash = req.headers['x-user-id'];

    if (!username || !hash) {
      let err = new Error("invalid header params, expected: {x-user-unique-name:username, x-user-id:hash}");
      err.status = RestStatus.BAD_REQUEST;
      return next(err);
    }


    //todo - depending on oauth - put try catch block for blockUser or vaultWrapper CreateKey [155-167]
    // Create blockchain user in bloc
    try {
      console.log("=======! creatin blocUser")

      const blocUser = yield ax.post(process.env.VAULT_HOST, req.body, '/strato/v2.3/key', req.headers);

      console.log('BLOC USER CREATED')
      console.log(blocUser)

      res.status(RestStatus.OK).json({ user: blocUser });
    } catch (blocError) {
      let err = new Error('could not create bloc account: ', blocError); //fixme - see universalError in ht3
      return next(err);
    }

  });
}


function getKey(req, res, next) {
  const username = req.headers['x-user-unique-name'];
  const hash = req.headers['x-user-id'];

  if (!username || !hash) {
    let err = new Error("invalid header params, expected: {x-user-unique-name:username, x-user-id:hash}");
    err.status = RestStatus.BAD_REQUEST;
    return next(err);
  }

  co(function* () {
    try {
      console.log("=======? finding blocUser")

      const query = req.body ? `?${querystring.stringify(req.body)}` : ''; //todo - do we need this atm?

      const blocUser = yield ax.get(process.env.VAULT_HOST, `/strato/v2.3/key${query}`, {
        "x-user-unique-name": req.headers['x-user-unique-name'],
        "x-user-id": req.headers['x-user-id']
      });

      console.log('BLOC USER FOUND')
      console.log(blocUser)

      res.status(RestStatus.OK).json({user: blocUser});
    } catch (blocError) {
      let err = new Error('could not find bloc account: ', blocError); //fixme - see universalError in ht3
      return next(err);
    }
  })

}

module.exports = {
  createKey,
  getKey,
};
