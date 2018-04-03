/* jshint esnext: true */
const bcrypt = require('bcrypt');
const blockappsRest = require('blockapps-rest').rest;
const co = require('co');
const moment = require('moment');
var rp = require('request-promise');

const appConfig = require('../config/app.config');
const authHandler = require('../middlewares/authHandler.js');
const models = require('../models');


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
        let err = new Error(authErrorText);
        err.status = 401;
        return next(err);
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

  create: function (req, res, next) {
    co(function* () {
      const username = req.body.username;
      const password = req.body.password;

      if (!username || !password) {
        let err = new Error("wrong params, expected: {username, password}");
        err.status = 400;
        return next(err);
      }

      if (username.length < 2 || username.length > 15) {
        let err = new Error("Username must be at least 2 characters and 15 characters max");
        err.status = 400;
        return next(err);
      }
      if (password.length < 6) {
        let err = new Error("Password must be at least 6 characters");
        err.status = 400;
        return next(err);
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

      // Set the account address to user in db
      newUser.accountAddress = blocUser.address;
      yield newUser.save({ fields: ['accountAddress'] });

      sendLoginResponse(res, newUser);
    });
  },

  verify: function (req, res, next) {
    co(function* () {
      const email = req.body.email;
      if (!email) {
        let err = new Error("wrong params, expected: {email, nodeIP}");
        err.status = 400;
        return next(err);
      }

      const user = yield models.User.findOne({ where: { username: email } });
      if (user) {
        const authErrorText = "User already exists";
        let err = new Error(authErrorText);
        err.status = 401;
        return next(err);
      }

      const options = {
        method: 'POST',
        uri: `${appConfig.signup}/verify-email`,
        body: {
          email,
          nodeIP: 'test' //TODO: get node IP
        },
        json: true
      };
      rp(options)
        .then(response => {
          let newOTP;
          if (!response.hash) {
            const authErrorText = "The email does not exist";
            let err = new Error(authErrorText);
            err.status = 401;
            return next(err);
          }
          return models.Otp.create({ email: email, otp: response.hash })
            .then(otp => res.status(200).json({ exists: true }))
            .catch(error => {
              if (error.name === "SequelizeUniqueConstraintError") {
                return models.Otp.update({ opt: response.hash }, { where: { email } })
                  .then(otp => res.status(200).json({ exists: true }))
                  .catch(updateError => { throw updateError })
              }
              throw error;
            })
        })
        .catch(error => {
          let err = new Error('Could not verify user');
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
        res.status(400).json({ success: false, error: 'wrong params, expected: {email, password}' });
      }

      try {
        let user = yield models.temp_user.find({ where: { email: email, password: password } });

        if (user) {
          res.status(200).json({ success: true, error: null });
        }
        else {
          res.status(200).json({ success: false, error: 'Your temporary password is incorrect' });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: 'Your temporary password is incorrect' });
      }
    });
  }
};
