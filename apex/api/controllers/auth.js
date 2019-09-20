/* jshint esnext: true */
const bcrypt = require('bcrypt');
const blockappsRest = require('blockapps-rest').rest;
const co = require('co');
const moment = require('moment');
var rp = require('request-promise');

const appConfig = require('../config/app.config');
const authHandler = require('../middlewares/authHandler.js');
const models = require('../models');
const ax = require(`${process.cwd()}/lib/rest-utils/axios-wrapper`);
const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);
const { getOrCreateKey } = require(`${process.cwd()}/lib/oAuth/oAuth`);

const sendLoginResponse = function (res, user) {
  let tokenData;
  try {
    tokenData = authHandler.issue(user);
  }
  catch (err) {
    return next(err);
  }

  res.cookie(
    appConfig.jwtConfig.authCookieName,
    tokenData.token,
    {
      domain: appConfig.jwtConfig.authCookieDomain,
      httpOnly: true,
      secure: appConfig.jwtConfig.authCookieSecure,
      expire: moment(tokenData.expireDate).toDate()
    }
  );

  res.status(200).json({ user: user.toJson() });
};

module.exports = {
  // no check if the user is already logged in - always login with credentials provided
  login: function (req, res, next) {
    const username = req.body.username;
    const password = req.body.password;

    if (!username || !password) {
      let err = new Error("wrong params, expected: {username, password}");
      err.status = 400;
      return next(err);
    }

    // Check if password provided for the user is correct
    models.User.findOne({
      where: { username: username },
      include: [{
        model: models.Role,
      }]
    }).then(user => {
      const authErrorText = "user does not exist or wrong user-password pair provided";
      if (!user) {
        models.TempUser.findOne({ where: { email: username } }).then(tempUser => {
          let err;
          if (tempUser) {
            err = new Error('Please link your account to STRATO Testnet');
            err.status = 401;
            return next(err);
          }
          err = new Error(authErrorText);
          err.status = 401;
          return next(err);
        })
      } else {
        bcrypt.compare(password, user.passwordHash, function (err, passIsCorrect) {
          if (err) {
            return next(err);
          } else {
            if (!passIsCorrect) {
              let err2 = new Error(authErrorText);
              err2.status = 401;
              return next(err2);
            } else {
              sendLoginResponse(res, user);
            }
          }
        });
      }
    }).catch(err => next(err));
  },

  logout: function (req, res) {
    res.clearCookie(appConfig.jwtConfig.authCookieName);
    res.status(200).json({
      message: 'logout successful'
    });
  },

  createUser: function (req, res, next) {
    co(function* () {
      const username = req.headers['x-user-unique-name'];

      if (!username) {
        let err = new Error("invalid param, expected username to be a non-empty string");
        err.status = RestStatus.BAD_REQUEST;
        return next(err);
      }

      try {
        const user = yield getOrCreateKey(username);
        res.status(200).json(user);
      } catch (error) {
        let err = new Error('could not create bloc account: ' + error);
        console.error(err);
        return next(err);
      }
    });
  },

  create: function (req, res, next) {
    co(function* () {
      const username = req.body.username;
      const password = req.body.password;

      if (!username || !password) {
        let err = new Error("wrong params, expected: {username, password}");
        err.status = 400;
        return next(err);
      }

      if (username.length < 2 || username.length > 320) {
        let err = new Error("Username must be at least 2 characters and 320 characters max");
        err.status = 400;
        return next(err);
      }
      if (password.length < 6) {
        let err = new Error("Password must be at least 6 characters");
        err.status = 400;
        return next(err);
      }

      const user = yield models.TempUser.findOne({ where: { email: username } });
      if (!user) {
        let err = new Error("User not found.");
        err.status = 401;
        return next(err);
      }

      if (!user.verified) {
        let error = new Error('User not verified.');
        error.status = 401;
        return next(error);
      }

      // Create user in db if does not exist
      let newUser;
      try {
        newUser = yield models.User.create({
          username: username,
          passwordHash: bcrypt.hashSync(password, appConfig.passwordSaltRounds),
        });
      } catch (error) {
        if (error.name === "SequelizeUniqueConstraintError") {
          let err = new Error("user already exists");
          err.status = 409;
          return next(err);
        }
        throw error;
      }

      // Find developer role
      const developerRole = yield models.Role.findOne({
        where: {
          name: 'developer'
        }
      });

      // Add developer role to new user
      yield newUser.addRole(developerRole);
      newUser.Roles = [developerRole]; // dirty trick to prevent .toJson() error; todo: refactor

      // Create blockchain user in bloc
      let blocUser;
      try {
        blocUser = yield blockappsRest.createUser(username, password, true);
      } catch (blocError) {
        newUser.destroy();
        // TODO: check error type (some of them might be expected - not 500) - see Bloc errors.
        let err = new Error('could not create bloc account: ', blocError);
        err.status = 500;
        return next(err);
      }
      user.destroy();
      // Set the account address to user in db
      newUser.accountAddress = blocUser.address;
      yield newUser.save({ fields: ['accountAddress'] });

      sendLoginResponse(res, newUser);
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
