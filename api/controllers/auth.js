const bcrypt = require('bcrypt');
const blockappsRest = require('blockapps-rest').rest;
const co = require('co');
const moment = require('moment');

const appConfig = require('../config/app.config');
const authHandler = require('../middlewares/authHandler.js');
const models = require('../models');


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
      where: {username: username},
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
        bcrypt.compare(password, user['passwordHash'], function (err, passIsCorrect) {
          if (err) {
            return next(err);
          } else {
            if (!passIsCorrect) {
              let err = new Error(authErrorText);
              err.status = 401;
              return next(err);
            } else {
              let tokenData;
              try {
                tokenData = authHandler.issue(user);
              }
              catch(err) {
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
              res.status(200).json({user: user.toJson()});
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

  create: function(req, res, next) {
    co(function* () {
      const username = req.body.username;
      const password = req.body.password;

      if (!username || !password) {
        let err = new Error("wrong params, expected: {username, password}");
        err.status = 400;
        return next(err);
      }
      // TODO: basic validation for username/password

      // Create user in db if not exists
      try {
        const newUser = yield models.User.create({
          username: username,
          passwordHash: bcrypt.hashSync(password, appConfig.passwordSaltRounds),
        });

        // Find developer role
        const developerRole = yield models.Role.findOne({
          where: {
            name: 'developer'
          }
        });

        // Add developer role to new user
        yield newUser.addRole(developerRole);
      } catch (error) {
        if (error.name === "SequelizeUniqueConstraintError") {
          let err = new Error("user already exists");
          err.status = 409;
          return next(err);
        }
        throw error;
      }

      // Create blockchain user in bloc
      try {
        const blocUser = yield blockappsRest.createUser(username, password);
        // TODO: updateAccount address for user in db with value of blocUser.account
        res.status(200).json({
          message: 'user created'
        });
      } catch(blocError) {
        // TODO: remove user from db
        // TODO: check error type (some might be expected, not 500)
        let err = new Error('could not create bloc account: ', blocError);
        err.status = 500;
        return next(err);
      }
    })
  }
};