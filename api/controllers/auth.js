const bcrypt = require('bcrypt');
const fs = require('fs');
const moment = require('moment');

const appConfig = require('../config/app.config');
const authHandler = require('../middlewares/authHandler.js');
const models = require('../models');


module.exports = {
  // Login can be executed by logged-in users and re-logins with new credentials provided
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
    const key = req.body.key;
    const username = req.body.username;
    const password = req.body.password;

    if (!key || !username || !password) {
      let err = new Error("wrong params, expected: {key, username, password}");
      err.status = 400;
      return next(err);
    }

    fs.readFile('USERKEY', 'utf8', function (err,data) {
      if (err) {
        let err = new Error('USERKEY file does not exist - initial user is already created');
        err.status = 403;
        return next(err);
      }
      if (data === key) {
        // Create user
        models.User.create(
          {
            username: username,
            passwordHash: bcrypt.hashSync(password, appConfig.passwordSaltRounds),
          }
        ).then(function (newUser) {
          models.Role.findOne({
            where: {
              name: 'admin'
            }
          }).then(function (adminRole) {
            newUser.addRole(adminRole).then(() => {
              fs.unlink('USERKEY', function () {
                res.status(200).json({
                  message: 'user created'
                });
              });
            })
          });
        }).catch(err => next(err));
      } else {
        let err = new Error('wrong key provided');
        err.status = 403;
        return next(err);
      }
    });
  },

};