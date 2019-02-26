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


module.exports = {
  // no check if the user is already logged in - always login with credentials provided
  getKey: function (req, res, next) {
    console.log('in oauth')

      const username = req.headers['x-user-unique-name'];
      const hash = req.headers['x-user-id'];

      if (!username || !hash) {
          let err = new Error("invalid header params, expected: {x-user-unique-name:username, x-user-id:hash}");
          err.status = 400;
          return next(err);
      }

      co(function* () {
          try {
              console.log("=======? finding blocUser", process.env.VAULT_HOST, req.headers)
              const query = req.body ? `?${querystring.stringify(req.body)}` : ''; //todo - do we need this atm?
              const blocUser = yield ax.get(process.env.VAULT_HOST, `/strato/v2.3/key${query}`, {
                  "x-user-unique-name": req.headers['x-user-unique-name'],
                  "x-user-id": req.headers['x-user-id']
              });
              console.log('BLOC USER FOUND')
              console.log(blocUser)
              res.status(200).json({user: blocUser});
          } catch (blocError) {
              // TODO: check error type (some of them might be expected - not 500) - see Bloc errors.
              let err = new Error('could not find bloc account: ', blocError);
              return next(err);
          }
      })

  },

  logout: function (req, res) {
    res.clearCookie(appConfig.jwtConfig.authCookieName);
    res.status(200).json({
      message: 'logout successful'
    });
  },

  createKey: function (req, res, next) {
    console.log('CREATION')
    co(function* () {

      //todo - separate out to a validation function - dupicate w/ login
      const username = req.headers['x-user-unique-name'];
      const hash = req.headers['x-user-id'];
      const password = req.body.password; //todo - does the call to create users expect this?

      if (!username || !hash) {
          let err = new Error("invalid header params, expected: {x-user-unique-name:username, x-user-id:hash}");
        err.status = 400;
        return next(err);
      }


      //todo - depending on oauth - put try catch block for blockUser or vaultWrapper CreateKey [155-167]
      // Create blockchain user in bloc
      try {
          console.log("=======! creatin blocUser")
          const blocUser = yield ax.post(process.env.VAULT_HOST, req.body, '/strato/v2.3/key', req.headers);
          console.log('BLOC USER CREATED')
          console.log(blocUser)
          res.status(200).json({ user: blocUser });
      } catch (blocError) {
          // TODO: check error type (some of them might be expected - not 500) - see Bloc errors.
          console.log(blocError)
          let err = new Error('could not create bloc account: ', blocError);
          //err.status = 500; //todo - why was this 500? should see actual error
          return next(err);
      }

    });
  },

  verifyEmail: function (req, res, next) {
    co(function* () {
      const email = req.body.email;
      if (!email) {
        let err = new Error("wrong params, expected: {email}");
        err.status = 400;
        return next(err);
      }

      const user = yield models.User.findOne({ where: { username: email } });
      if (user) {
        const authErrorText = "User account already exists. Please login with the valid credentials.";
        let err = new Error(authErrorText);
        err.status = 401;
        return next(err);
      }

      const options = {
        method: 'POST',
        uri: `${appConfig.signup}/verify-email`,
        body: {
          email,
          nodeIP: process.env.NODE_HOST
        },
        json: true
      };
      rp.post(options)
        .then(response => {
          if (!response.hash) {
            const authErrorText = "User not found. Register your account on signup.blockapps.net";
            let err = new Error(authErrorText);
            err.status = 401;
            return next(err);
          }
          return models.TempUser.create({ email: email, password: response.hash })
            .then(password => res.status(200).json({ exists: true }))
            .catch(error => {
              if (error.name === "SequelizeUniqueConstraintError") {
                return models.TempUser.update(
                  { password: response.hash, verified: false },
                  { where: { email } })
                  .then(password => res.status(200).json({ exists: true }))
                  .catch(updateError => { throw updateError })
              }
              throw error;
            })
        })
        .catch(error => {
          let err = new Error('Unexpected server error. Please try again after sometime.');
          err.status = 500;
          return next(err);
        })
    });
  },

  verifyTemporaryPassword: function (req, res, next) {
    co(function* () {
      const email = req.body.email;
      const password = req.body.tempPassword;

      if (!email || !password) {
        let err = new Error('wrong params, expected: {email, password}');
        err.status = 400;
        return next(err);
      }

      try {
        let user = yield models.TempUser.find({ where: { email: email } });

        if (user) {
          return bcrypt.compare(password, user.password, function (err, response) {
            if (err) {
              let err = new Error('Unexpected server error. Please try again after sometime.');
              err.status = 500;
              return next(err);
            }
            if (response) {
              return models.TempUser.update({ verified: true }, { where: { email } })
                .then(() => res.status(200).json({ success: true, error: null }))
                .catch(updateError => {
                  let err = new Error('Unexpected server error. Please try again after sometime.');
                  err.status = 500;
                  return next(err);
                })
            }

            let error = new Error('Your temporary password is incorrect');
            error.status = 401;
            return next(error);
          });
        }
        else {
          let err = new Error("Couldn't find user");
          err.status = 401;
          return next(err);
        }
      } catch (error) {
        let err = new Error('Unexpected server error. Please try again after sometime.');
        err.status = 500;
        return next(err);
      }
    });
  }
};
