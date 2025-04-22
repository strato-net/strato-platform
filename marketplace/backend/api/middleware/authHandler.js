import RestStatus from 'http-status-codes';
import oauthHelper from '../../helpers/oauthHelper';
import { oauthUtil, rest } from 'blockapps-rest';
import jwtDecode from 'jwt-decode';
import config from '/load.config';
import axios from 'axios';

/**
 * Attempts to retrieve the access token from cookies.
 * If a token exists, it tries to validate and refresh it using the OAuth helper.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<string|null>} The access token if found and valid/refreshed, otherwise null.
 */
const getTokenFromCookie = async (req, res) => {
  const tokenName = req.app.oauth.getCookieNameAccessToken();
  if (req.cookies[tokenName]) {
    try {
      await req.app.oauth.validateAndGetNewToken(req, res);
      return req.cookies[tokenName]; // the cookie may have the updated value here after validateAndGetNewToken()
    } catch (err) {
      console.log(
        'Access token is either invalid or expired and could not been refreshed'
      );
    }
  }
  return null;
};

/**
 * Attempts to retrieve the access token from request headers ('x-user-access-token' or 'Authorization: Bearer').
 * @param {import('express').Request} req - The Express request object.
 * @returns {Promise<string|null>} The access token if found in headers, otherwise null.
 */
const getTokenFromHeader = async (req) => {
  if (req.headers['x-user-access-token'])
    return req.headers['x-user-access-token'];

  if (req.headers['authorization']) {
    const [bearer, token] = req.headers['authorization'].split(' ');
    if (bearer !== 'Bearer') return null;
    return token;
  }
  return null;
};

/**
 * Determines the appropriate login URL based on the environment configuration.
 * @param {import('express').Request} req - The Express request object.
 * @returns {string} The login URL.
 */
const getLoginUrl = (req) =>
  config.dockerized ? '/login/' : req.app.oauth.getSigninURL();

/**
 * Provides middleware handlers for authentication and authorization using OAuth.
 */
class AuthHandler {
  /**
   * Creates an Express middleware function to authorize incoming requests.
   * It checks for a valid JWT access token in cookies or headers.
   * If a valid token is found, it decodes it, retrieves or creates the corresponding user address
   * using blockapps-rest, and attaches user information (`address`, `accessToken`, `decodedToken`, `username`)
   * to the `req` object.
   * If `allowAnonAccess` is true, it attempts to get a service token for anonymous access.
   * If no valid token is found and anonymous access is not allowed, it checks server health.
   * If the server is healthy, it responds with UNAUTHORIZED and the login URL.
   * If the server is unhealthy, it responds with INTERNAL_SERVER_ERROR.
   *
   * @param {boolean} [allowAnonAccess=false] - Whether to allow anonymous access using a service token.
   * @returns {import('express').RequestHandler} An Express middleware function.
   */
  static authorizeRequest(allowAnonAccess = false) {
    return async function (req, res, next) {
      try {
        let token = await getTokenFromCookie(req, res);
        let address;
        if (!token) {
          token = await getTokenFromHeader(req);
        }
        let isServiceUser = false;
        if (!token && allowAnonAccess === true) {
          token = await oauthHelper.getServiceToken(req);
          isServiceUser = true;
        }

        if (token) {
          console.log('Got token');
          let decodedToken;
          try {
            decodedToken = jwtDecode(token);
          } catch (err) {
            rest.response.status(
              RestStatus.BAD_REQUEST,
              res,
              'Access token is not a valid JWT'
            );
            return next(err);
          }
          try {
            address = await rest.createOrGetKey(
              { username: decodedToken.preferred_username, token },
              { config }
            );
          } catch (e) {
            console.error('STRATO API is unreachable or unhealthy. Error: ', e);
            return rest.response.status(
              RestStatus.INTERNAL_SERVER_ERROR,
              res,
              'Internal Server Error 101'
            );
          }
          req.address = address;
          req.accessToken = { token };
          req.decodedToken = decodedToken;
          req.username =
            isServiceUser === true
              ? 'serviceUser'
              : decodedToken.preferred_username;
          console.log('Authorization success, moving on...');
          return next();
        }
      } catch (err) {
        return next(err);
      }

      res.clearCookie(req.app.oauth.getCookieNameAccessToken());
      res.clearCookie(req.app.oauth.getCookieNameAccessTokenExpiry());
      res.clearCookie(req.app.oauth.getCookieNameRefreshToken());

      let health = true;
      try {
        const response = await axios.get(`${config.serverHost}/health`);
        health = response.data.health;
      } catch (error) {
        console.log('error', error);
      }

      // Here, we're checking the server's health. If it's determined to be false,
      // we'll throw an Internal Server Error along with a message to indicate the issue.
      if (health) {
        rest.response.status(RestStatus.UNAUTHORIZED, res, {
          loginUrl: getLoginUrl(req),
        });
        return next(new Error('Authorization required'));
      } else {
        return rest.response.status(
          RestStatus.INTERNAL_SERVER_ERROR,
          res,
          'Internal Server Error 101'
        );
      }
    };
  }

  /**
   * Initializes the OAuth utility based on the configuration.
   * Logs an error and exits the process if initialization fails.
   * @returns {Promise<object>} The initialized OAuth utility object.
   * @throws {Error} If OAuth initialization fails.
   */
  static async initOauth() {
    let oauth;
    try {
      oauth = await oauthUtil.init(config.nodes[0].oauth);
    } catch (err) {
      console.log('Error initializing oauth handlers');
      process.exit(1);
    }
    return oauth;
  }

  /**
   * Creates an Express middleware function specifically for webhook authentication.
   * It attempts to obtain a token for a predefined global admin user using environment variables.
   * If successful, it validates the token, retrieves the admin's address, and attaches
   * user information (`address`, `accessToken`, `decodedToken`, `username`) to the `req` object.
   * It handles potential errors gracefully by calling `next()`, allowing subsequent middleware or route handlers
   * to manage the response if authentication fails (e.g., logging an error but not blocking the request).
   * This middleware is intended for internal use cases where a webhook needs to act with admin privileges.
   *
   * @returns {import('express').RequestHandler} An Express middleware function.
   */
  static getDeployersTokenForWebhook() {
    return async function (req, res, next) {
      try {
        let globalAdminToken = await oauthHelper.getUserToken(
          `${process.env.GLOBAL_ADMIN_NAME}`,
          `${process.env.GLOBAL_ADMIN_PASSWORD}`
        );
        let address;

        if (globalAdminToken) {
          console.log('Got token');
          let decodedToken;
          try {
            decodedToken = jwtDecode(globalAdminToken);
          } catch (err) {
            rest.response.status(
              RestStatus.BAD_REQUEST,
              res,
              'Access token is not a valid JWT'
            );
            return next();
          }
          try {
            address = await rest.getKey(
              {
                username: decodedToken.preferred_username,
                token: globalAdminToken,
              },
              { config }
            );
          } catch (e) {
            // user isn't created in STRATO
            if (e.response && e.response.status === RestStatus.BAD_REQUEST) {
              console.log('User not created in STRATO!');
              return next(e);
            }
          }
          req.address = address;
          req.accessToken = { token: globalAdminToken };
          req.decodedToken = decodedToken;
          req.username = decodedToken.preferred_username;
          console.log('Authorization success, moving on...');
          return next();
        }
      } catch (err) {
        rest.response.status(
          RestStatus.INTERNAL_SERVER_ERROR,
          res,
          'Internal Server Error'
        );
        return next();
      }

      rest.response.status(RestStatus.UNAUTHORIZED, res, {
        loginUrl: getLoginUrl(req),
      });
      return next();
    };
  }
}

export default AuthHandler;
