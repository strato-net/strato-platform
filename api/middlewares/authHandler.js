const jwt = require('jwt-simple');
const appConfig = require('../config/app.config');
const moment = require('moment');


/**
 * Check if token is valid and not expired
 * @param token
 * @returns {boolean}
 */
function isTokenValid(token) {
  return (token)
    && (token.exp)
    && (token.user)
    && (token.user.id.toString())
    && (token.user.email)
    && (moment(token.exp).isValid())
    && (!moment().isSameOrAfter(token.exp))
}

const authHandler = {

  /**
   * Issue the JWT for the user
   * @param user
   * @param next
   * @returns {{token: String, expireDate: string}}
   */
  issue: function(user) {
    const expireDate = moment().add(appConfig.jwtConfig.jwtValidity, 'days').toISOString();
    const rawToken = {
      exp: expireDate,
      user: {
        id: user.id,
        email: user.email,
      },
    };

    if(!isTokenValid(rawToken)) {
      throw new Error('Unable to generate valid token');
    }

    const token = jwt.encode(rawToken, appConfig.jwtConfig.jwtSecret, appConfig.jwtConfig.jwtAlgorithm);

    return {
      token,
      expireDate
    };
  },

  /**
   * Get token payload
   * @param token
   * @returns {Object}
   */
  getTokenPayload: function(token) {
    return jwt.decode(token, appConfig.jwtConfig.jwtSecret, true, appConfig.jwtConfig.jwtAlgorithm);
  },

  /**
   * Request guard controller, validate if JWT is valid and not expired
   * @param req
   * @param res
   * @param next
   * @returns {Function}
   */
  validateRequest:  function(req, res, next) {
    return function(req, res, next) {
      const token = req['cookies'][appConfig.jwtConfig.authCookieName];
      if(!token) {
        return unauthorized();
      }
      let decodedToken;
      try {
        decodedToken = jwt.decode(token, appConfig.jwtConfig.jwtSecret, true, appConfig.jwtConfig.jwtAlgorithm);
      }
      catch(err) {
        return unauthorized();
      }
      if(!isTokenValid(decodedToken)) {
        unauthorized();
      }
      req.user = decodedToken.user;

      return next();

      function unauthorized() {
        let err = new Error('unauthorized');
        err.status = 401;
        return next(err);
      }
    }
  },
};

module.exports = authHandler;
